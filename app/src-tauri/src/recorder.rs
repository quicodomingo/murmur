//! Saves the meeting audio as Ogg/Opus at 16 kHz: mono at 16 kbps (≈ 7 MB/h) or stereo — one
//! channel per source, mic left and system right — at 24 kbps (≈ 11 MB/h).
//!
//! "Continua" records into the same file: `resume` copies what's there as one stream (without
//! its end mark) and carries on after it, so the meeting stays one recording on one timeline.

use crate::i18n::tr;
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;

use anyhow::{Context, Result, anyhow};
use ogg::reading::PacketReader;
use ogg::writing::{PacketWriteEndInfo, PacketWriter};
use opus::{Application, Bitrate, Channels, Encoder};

use crate::engine::SAMPLE_RATE;

/// 20 ms frames, the usual choice for speech.
const FRAME: usize = SAMPLE_RATE / 50;
/// Ogg granule positions always count 48 kHz samples, whatever the input rate.
const GRANULE_PER_SAMPLE: u64 = (48_000 / SAMPLE_RATE) as u64;
const SERIAL: u32 = 0x5452_4e53; // "TRNS"

pub struct Recorder {
    encoder: Encoder,
    writer: PacketWriter<'static, BufWriter<File>>,
    channels: usize,
    /// Interleaved samples waiting for a full frame.
    pending: Vec<f32>,
    packet: Vec<u8>,
    samples_written: u64,
    pre_skip: u64,
    frames_in_page: u32,
}

impl Recorder {
    pub fn create(path: &Path, channels: usize) -> Result<Self> {
        let (layout, bitrate) = match channels {
            1 => (Channels::Mono, 16_000),
            2 => (Channels::Stereo, 24_000),
            n => return Err(anyhow!("Opus: {n} canals no suportats")),
        };
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).context(tr!("recordings_dir_failed"))?;
        }
        let file = File::create(path).context(tr!("audio_file_create_failed"))?;
        let mut encoder = Encoder::new(SAMPLE_RATE as u32, layout, Application::Voip)
            .map_err(|e| anyhow!("Opus: {e}"))?;
        encoder
            .set_bitrate(Bitrate::Bits(bitrate))
            .map_err(|e| anyhow!("Opus: {e}"))?;
        let pre_skip =
            encoder.get_lookahead().map_err(|e| anyhow!("Opus: {e}"))? as u64 * GRANULE_PER_SAMPLE;

        let mut writer = PacketWriter::new(BufWriter::new(file));
        // RFC 7845 identification header.
        let mut head = b"OpusHead".to_vec();
        head.push(1); // version
        head.push(channels as u8);
        head.extend((pre_skip as u16).to_le_bytes());
        head.extend((SAMPLE_RATE as u32).to_le_bytes());
        head.extend(0i16.to_le_bytes()); // output gain
        head.push(0); // mapping family
        writer.write_packet(head, SERIAL, PacketWriteEndInfo::EndPage, 0)?;
        // Comment header.
        let vendor = b"Murmur";
        let mut tags = b"OpusTags".to_vec();
        tags.extend((vendor.len() as u32).to_le_bytes());
        tags.extend(vendor);
        tags.extend(0u32.to_le_bytes()); // no user comments
        writer.write_packet(tags, SERIAL, PacketWriteEndInfo::EndPage, 0)?;

        Ok(Self {
            encoder,
            writer,
            channels,
            pending: Vec::with_capacity(FRAME * channels * 2),
            packet: vec![0; 4000],
            samples_written: 0,
            pre_skip,
            frames_in_page: 0,
        })
    }

    /// Carries on the recording at `path` (made by `create` with as many channels): its packets are
    /// copied into a new file, which then replaces it, and new audio follows them.
    pub fn resume(path: &Path, channels: usize) -> Result<Self> {
        let mut reader = PacketReader::new(BufReader::new(File::open(path).context(tr!("meeting_audio_missing"))?));
        let head = reader.read_packet()?.ok_or_else(|| anyhow!(tr!("audio_empty")))?;
        if !head.data.starts_with(b"OpusHead") || head.data.len() < 19 {
            return Err(anyhow!(tr!("audio_not_opus")));
        }
        if head.data[9] as usize != channels {
            return Err(anyhow!(tr!("audio_channels_changed")));
        }
        let pre_skip = u16::from_le_bytes([head.data[10], head.data[11]]) as u64;
        // The comment header: `create` writes its own.
        reader.read_packet()?;

        let mut new = Self::create(&path.with_extension("ogg.part"), channels)?;
        new.pre_skip = pre_skip;
        let mut last = pre_skip;
        let mut pending: Option<(Vec<u8>, u64, bool)> = None;
        while let Some(packet) = reader.read_packet()? {
            if let Some((data, granule, end_page)) = pending.take() {
                let end = if end_page { PacketWriteEndInfo::EndPage } else { PacketWriteEndInfo::NormalPacket };
                new.writer.write_packet(data, SERIAL, end, granule).context(tr!("audio_write_failed"))?;
            }
            last = packet.absgp_page();
            pending = Some((packet.data.clone(), packet.absgp_page(), packet.last_in_page()));
        }
        // The last packet closed the stream: now it only closes a page.
        if let Some((data, granule, _)) = pending {
            new.writer.write_packet(data, SERIAL, PacketWriteEndInfo::EndPage, granule).context(tr!("audio_write_failed"))?;
        }
        use std::io::Write;
        new.writer.inner_mut().flush()?;
        std::fs::rename(path.with_extension("ogg.part"), path).context(tr!("audio_write_failed"))?;
        new.samples_written = last.saturating_sub(pre_skip) / GRANULE_PER_SAMPLE;
        Ok(new)
    }

    /// Seconds of audio in the file so far, as it plays back (after the encoder's delay).
    pub fn seconds(&self) -> f32 {
        (self.samples_written as f32 - self.pre_skip as f32 / GRANULE_PER_SAMPLE as f32).max(0.0) / SAMPLE_RATE as f32
    }

    /// `samples` are interleaved when recording more than one channel.
    pub fn push(&mut self, samples: &[f32]) -> Result<()> {
        self.pending.extend_from_slice(samples);
        let frame_len = FRAME * self.channels;
        while self.pending.len() >= frame_len {
            let frame: Vec<f32> = self.pending.drain(..frame_len).collect();
            self.write_frame(&frame, false)?;
        }
        Ok(())
    }

    /// Pads the last frame with silence and closes the stream.
    pub fn finish(mut self) -> Result<()> {
        let mut frame = std::mem::take(&mut self.pending);
        frame.resize(FRAME * self.channels, 0.0);
        self.write_frame(&frame, true)?;
        self.writer.inner_mut().get_mut().sync_all().ok();
        Ok(())
    }

    fn write_frame(&mut self, frame: &[f32], last: bool) -> Result<()> {
        let n = self
            .encoder
            .encode_float(frame, &mut self.packet)
            .map_err(|e| anyhow!("Opus: {e}"))?;
        self.samples_written += FRAME as u64;
        self.frames_in_page += 1;
        // ~1 s pages keep the file seekable and limit loss if the app is killed.
        let end = if last {
            PacketWriteEndInfo::EndStream
        } else if self.frames_in_page >= 50 {
            self.frames_in_page = 0;
            PacketWriteEndInfo::EndPage
        } else {
            PacketWriteEndInfo::NormalPacket
        };
        let granule = self.samples_written * GRANULE_PER_SAMPLE + self.pre_skip;
        self.writer
            .write_packet(self.packet[..n].to_vec(), SERIAL, end, granule)
            .context(tr!("audio_write_failed"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(seconds: f32, channels: usize, freq: f32) -> Vec<f32> {
        let n = (seconds * SAMPLE_RATE as f32) as usize;
        (0..n).flat_map(|i| std::iter::repeat_n((i as f32 * freq * std::f32::consts::TAU / SAMPLE_RATE as f32).sin() * 0.3, channels)).collect()
    }

    #[test]
    fn resume_carries_on_in_the_same_stream() {
        let dir = std::env::temp_dir().join(format!("murmur-recorder-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("meeting.ogg");
        for channels in [1, 2] {
            let mut rec = Recorder::create(&path, channels).unwrap();
            rec.push(&tone(2.0, channels, 440.0)).unwrap();
            rec.finish().unwrap();
            let first = crate::playback::decode_channels(&path).unwrap()[0].len();

            let mut rec = Recorder::resume(&path, channels).unwrap();
            assert_eq!((rec.seconds() * SAMPLE_RATE as f32).round() as usize, first);
            rec.push(&tone(3.0, channels, 220.0)).unwrap();
            rec.finish().unwrap();

            let both = crate::playback::decode_channels(&path).unwrap();
            assert_eq!(both.len(), channels);
            // The first part, then the second, and the closing frame of padding (up to 20 ms).
            let added = both[0].len() - first;
            assert!((3 * SAMPLE_RATE..=3 * SAMPLE_RATE + FRAME).contains(&added), "{added}");
            assert!(!path.with_extension("ogg.part").exists());
            // A recording with other sources can't go on.
            assert!(Recorder::resume(&path, 3 - channels).is_err());
        }
        std::fs::remove_dir_all(&dir).ok();
    }
}
