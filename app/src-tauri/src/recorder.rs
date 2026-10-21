//! Saves the meeting audio as Ogg/Opus at 16 kHz: mono at 16 kbps (≈ 7 MB/h) or stereo — one
//! channel per source, mic left and system right — at 24 kbps (≈ 11 MB/h).

use crate::i18n::tr;
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

use anyhow::{Context, Result, anyhow};
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
