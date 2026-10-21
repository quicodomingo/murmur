//! Listening to a meeting: the saved Ogg/Opus (one channel per source, recorder.rs) mixed to mono
//! and encoded as AAC (.m4a) with macOS's own encoder. Any player can open it (QuickTime, the
//! iPhone, Windows, WhatsApp), and so can the app's webview. Mono, because in the recording your
//! voice is on the left and the rest of the call on the right.

use crate::i18n::tr;
use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::path::Path;

use anyhow::{Context, Result, anyhow};
use ogg::reading::PacketReader;
use opus::{Channels, Decoder};

const RATE: u32 = 16_000;
/// AAC bit rate: about 22 MB per hour of meeting, clear for speech.
const BITRATE: u32 = 48_000;

/// The recording as mono samples at 16 kHz.
pub fn decode(path: &Path) -> Result<Vec<f32>> {
    let mut reader = PacketReader::new(BufReader::new(File::open(path).context(tr!("meeting_audio_missing"))?));
    let head = reader.read_packet()?.ok_or_else(|| anyhow!(tr!("audio_empty")))?;
    if !head.data.starts_with(b"OpusHead") || head.data.len() < 19 {
        return Err(anyhow!(tr!("audio_not_opus")));
    }
    let channels = head.data[9] as usize;
    // Pre-skip counts 48 kHz samples.
    let pre_skip = u16::from_le_bytes([head.data[10], head.data[11]]) as usize * RATE as usize / 48_000;
    let layout = match channels {
        1 => Channels::Mono,
        2 => Channels::Stereo,
        n => return Err(anyhow!("Opus: {n} canals no suportats")),
    };
    let mut decoder = Decoder::new(RATE, layout).map_err(|e| anyhow!("Opus: {e}"))?;
    // The comment header comes next.
    reader.read_packet()?;
    let mut mono = vec![];
    // Up to 120 ms per packet.
    let mut frame = vec![0f32; RATE as usize / 1000 * 120 * channels];
    while let Some(packet) = reader.read_packet()? {
        let n = decoder.decode_float(&packet.data, &mut frame, false).map_err(|e| anyhow!("Opus: {e}"))?;
        for s in frame[..n * channels].chunks(channels) {
            // Both sources at a little under full level, so two voices at once don't clip.
            mono.push((s.iter().sum::<f32>() * if channels == 2 { 0.7 } else { 1.0 }).clamp(-1.0, 1.0));
        }
    }
    Ok(mono.split_off(pre_skip.min(mono.len())))
}

/// Writes `samples` as an .m4a at `out` (through a temporary WAV and macOS's `afconvert`).
pub fn write_m4a(samples: &[f32], out: &Path) -> Result<()> {
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let wav = out.with_extension("wav");
    {
        let mut w = BufWriter::new(File::create(&wav)?);
        let data = (samples.len() * 2) as u32;
        w.write_all(b"RIFF")?;
        w.write_all(&(36 + data).to_le_bytes())?;
        w.write_all(b"WAVEfmt ")?;
        w.write_all(&16u32.to_le_bytes())?;
        w.write_all(&1u16.to_le_bytes())?; // PCM
        w.write_all(&1u16.to_le_bytes())?; // mono
        w.write_all(&RATE.to_le_bytes())?;
        w.write_all(&(RATE * 2).to_le_bytes())?;
        w.write_all(&2u16.to_le_bytes())?;
        w.write_all(&16u16.to_le_bytes())?;
        w.write_all(b"data")?;
        w.write_all(&data.to_le_bytes())?;
        for s in samples {
            w.write_all(&((s * 32767.0) as i16).to_le_bytes())?;
        }
        w.flush()?;
    }
    let partial = out.with_extension("m4a.part");
    let status = std::process::Command::new("/usr/bin/afconvert")
        .args(["-f", "m4af", "-d", "aac", "-b", &BITRATE.to_string()])
        .arg(&wav)
        .arg(&partial)
        .status();
    let _ = std::fs::remove_file(&wav);
    if !status.map(|s| s.success()).unwrap_or(false) {
        let _ = std::fs::remove_file(&partial);
        return Err(anyhow!(tr!("audio_convert_failed")));
    }
    std::fs::rename(&partial, out)?;
    Ok(())
}

/// The .m4a for `ogg` at `out`, made only if it's missing or older than the recording.
pub fn ensure_m4a(ogg: &Path, out: &Path) -> Result<()> {
    let modified = |p: &Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
    if let (Some(made), Some(source)) = (modified(out), modified(ogg)) {
        if made >= source {
            return Ok(());
        }
    }
    write_m4a(&decode(ogg)?, out)
}
