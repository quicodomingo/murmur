//! Echo cancellation for the microphone, using the system audio (what the speakers play) as the
//! reference. WebRTC AEC3 via `sonora`, a pure-Rust port.

use sonora::config::{EchoCanceller as Aec3, NoiseSuppression};
use sonora::{AudioProcessing, Config, StreamConfig};

use crate::engine::SAMPLE_RATE;

/// WebRTC processes 10 ms frames.
pub const FRAME: usize = SAMPLE_RATE / 100;

pub struct EchoCanceller {
    apm: AudioProcessing,
    out: Vec<f32>,
}

impl EchoCanceller {
    pub fn new() -> Self {
        let config = Config {
            echo_canceller: Some(Aec3::default()),
            // Light denoising helps the residual-echo suppressor; keep AGC off so levels stay
            // comparable between channels.
            noise_suppression: Some(NoiseSuppression::default()),
            ..Default::default()
        };
        let stream = StreamConfig::new(SAMPLE_RATE as u32, 1);
        let apm = AudioProcessing::builder()
            .config(config)
            .capture_config(stream)
            .render_config(stream)
            .build();
        Self {
            apm,
            out: vec![0.0; FRAME],
        }
    }

    /// Feeds one 10 ms frame of the far-end signal (system audio).
    pub fn render(&mut self, frame: &[f32]) {
        debug_assert_eq!(frame.len(), FRAME);
        let _ = self.apm.process_render_f32(&[frame], &mut [&mut self.out]);
    }

    /// Cleans one 10 ms frame of microphone audio in place.
    pub fn capture(&mut self, frame: &mut [f32]) {
        debug_assert_eq!(frame.len(), FRAME);
        if self
            .apm
            .process_capture_f32(&[frame], &mut [&mut self.out])
            .is_ok()
        {
            frame.copy_from_slice(&self.out);
        }
    }
}

impl Default for EchoCanceller {
    fn default() -> Self {
        Self::new()
    }
}
