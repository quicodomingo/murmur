//! Audio capture: microphone (cpal) + system audio (a Core Audio process tap on macOS, systap.rs),
//! each sent as 16 kHz mono f32 frames tagged with their source.

use crate::i18n::tr;
use anyhow::{Context, Result, anyhow};
use cpal::SampleFormat;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossbeam_channel::Sender;

use crate::engine::SAMPLE_RATE;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Mic = 0,
    System = 1,
}

/// 100 ms: block size used by the WAV simulator.
const SIM_CHUNK: usize = SAMPLE_RATE / 10;

/// Audio from one source, already 16 kHz mono. Sources are never mixed: the pipeline processes
/// each one separately (echo cancellation, its own transcription session).
pub type Frame = (Source, Vec<f32>);

/// Linear-interpolation resampler that keeps its phase across callbacks.
pub(crate) struct Resampler {
    ratio: f64,
    t: f64,
    prev: f32,
}

impl Resampler {
    pub(crate) fn new(input_rate: u32) -> Self {
        Self {
            ratio: input_rate as f64 / SAMPLE_RATE as f64,
            t: 0.0,
            prev: 0.0,
        }
    }

    pub(crate) fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if input.is_empty() {
            return;
        }
        // Interpolate over [prev, ...input] so consecutive callbacks join seamlessly.
        let at = |i: usize| if i == 0 { self.prev } else { input[i - 1] };
        let len = input.len() + 1;
        let mut t = self.t;
        while t + 1.0 < len as f64 {
            let i = t.floor() as usize;
            let f = (t - i as f64) as f32;
            out.push(at(i) * (1.0 - f) + at(i + 1) * f);
            t += self.ratio;
        }
        self.t = t - (len - 1) as f64;
        self.prev = input[input.len() - 1];
    }
}

/// Live capture streams. Not `Send` on macOS: keep it on the thread that created it; dropping it
/// stops capture.
pub struct Capture {
    _mic: Option<cpal::Stream>,
    #[cfg(target_os = "macos")]
    _system: Option<crate::systap::SystemTap>,
}

/// `mic_device`: input device name from `list_microphones`; `None` (or not found) = system default.
pub fn start_capture(
    mic: bool,
    mic_device: Option<&str>,
    system: bool,
    tx: Sender<Frame>,
) -> Result<Capture> {
    if !mic && !system {
        return Err(anyhow!(tr!("no_audio_source")));
    }
    // Start system audio first: if its permission is missing we fail before opening the mic.
    #[cfg(target_os = "macos")]
    let system_stream = if system {
        Some(crate::systap::start(tx.clone())?)
    } else {
        None
    };
    #[cfg(not(target_os = "macos"))]
    if system {
        return Err(anyhow!(tr!("system_audio_unsupported")));
    }
    let mic_stream = if mic {
        Some(start_mic(mic_device, tx)?)
    } else {
        None
    };
    Ok(Capture {
        _mic: mic_stream,
        #[cfg(target_os = "macos")]
        _system: system_stream,
    })
}

/// Names of the available input devices, default first.
pub fn list_microphones() -> Vec<String> {
    let host = cpal::default_host();
    let default = host.default_input_device().and_then(|d| d.name().ok());
    let mut names: Vec<String> = host
        .input_devices()
        .map(|devices| devices.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default();
    names.sort_by_key(|n| Some(n) != default.as_ref());
    names.dedup();
    names
}

fn start_mic(name: Option<&str>, tx: Sender<Frame>) -> Result<cpal::Stream> {
    let host = cpal::default_host();
    let chosen = name.and_then(|name| {
        host.input_devices()
            .ok()?
            .find(|d| d.name().is_ok_and(|n| n == name))
    });
    // A device that was unplugged since it was chosen falls back to the system default.
    let device = chosen
        .or_else(|| host.default_input_device())
        .ok_or_else(|| anyhow!(tr!("no_microphone")))?;
    let supported = device
        .default_input_config()
        .context(tr!("mic_unavailable"))?;
    let channels = supported.channels() as usize;
    let mut resampler = Resampler::new(supported.sample_rate().0);
    let format = supported.sample_format();
    let config = supported.into();

    let err = |e| log::error!("audio stream error: {e}");
    macro_rules! build {
        ($t:ty, $to_f32:expr) => {
            device.build_input_stream(
                &config,
                move |data: &[$t], _| {
                    let mono: Vec<f32> = data
                        .chunks(channels)
                        .map(|frame| {
                            frame.iter().map(|&s| $to_f32(s)).sum::<f32>() / channels as f32
                        })
                        .collect();
                    let mut out = Vec::with_capacity(mono.len() / 2);
                    resampler.process(&mono, &mut out);
                    let _ = tx.send((Source::Mic, out));
                },
                err,
                None,
            )
        };
    }
    let stream = match format {
        SampleFormat::F32 => build!(f32, |s: f32| s),
        SampleFormat::I16 => build!(i16, |s: i16| s as f32 / i16::MAX as f32),
        SampleFormat::I32 => build!(i32, |s: i32| s as f32 / i32::MAX as f32),
        other => return Err(anyhow!(tr!("audio_format_unsupported", format = format!("{other:?}")))),
    }
    .context(tr!("mic_open_failed"))?;
    stream.play().context(tr!("record_start_failed"))?;
    Ok(stream)
}

/// Dev aid: stream a 16 kHz mono WAV at real-time pace as if it were the system audio of a call
/// (`TRANSCRIPTOR_SIMULATE=path.wav`). Returns when `stop` fires or the file ends.
pub fn simulate_from_file(
    path: &str,
    tx: Sender<Frame>,
    stop: crossbeam_channel::Receiver<()>,
) -> Result<()> {
    let wave =
        sherpa_onnx::Wave::read(path).ok_or_else(|| anyhow!("No s'ha pogut llegir {path}"))?;
    if wave.sample_rate() as usize != SAMPLE_RATE {
        return Err(anyhow!("{path} ha de ser de 16 kHz"));
    }
    for samples in wave.samples().chunks(SIM_CHUNK) {
        if tx.send((Source::System, samples.to_vec())).is_err() {
            break;
        }
        if stop
            .recv_timeout(std::time::Duration::from_millis(100))
            .is_ok()
        {
            break;
        }
    }
    Ok(())
}
