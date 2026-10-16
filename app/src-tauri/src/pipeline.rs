//! Per-recording audio pipeline. The two sources are never mixed:
//!
//! - **System audio** (the other side of a call) is clean: it goes straight to its own session and
//!   is also the echo canceller's reference signal.
//! - **Microphone** frames are echo-cancelled against the system audio first, then transcribed by
//!   a second session. A mic frame is only processed once the system audio for the same instant
//!   has been seen, so the canceller always has its reference.
//! - Sources that stop delivering (ScreenCaptureKit is silent while nothing plays) are padded
//!   with silence by wall clock, so both channels keep the same timeline.
//! - Mic sentences that repeat what the system channel just said (leaked echo) are dropped.

use std::collections::VecDeque;
use std::time::Instant;

use anyhow::Result;

use crate::aec::{EchoCanceller, FRAME};
use crate::audio::Source;
use crate::engine::{Channel, Event, LiveSession, Models, SAMPLE_RATE};
use crate::recorder::Recorder;

/// A source further behind the wall clock than this is padded with silence.
const PAD_AFTER: usize = SAMPLE_RATE * 3 / 10;
/// Recent system sentences kept to recognise echo that leaked into the mic.
const RECENT_SYSTEM: usize = 12;
const ECHO_OVERLAP: f32 = 0.6;

struct Heard {
    start: f32,
    end: f32,
    words: Vec<String>,
}

fn words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| {
            w.trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|w| !w.is_empty())
        .collect()
}

pub struct Pipeline<'m> {
    mic: Option<LiveSession<'m>>,
    system: Option<LiveSession<'m>>,
    aec: Option<EchoCanceller>,
    mic_queue: VecDeque<f32>,
    system_queue: VecDeque<f32>,
    /// Samples received (or padded) per source since the start.
    mic_received: usize,
    system_received: usize,
    /// System samples already given to the echo canceller.
    system_done: usize,
    mic_done: usize,
    /// Set by `finish`: process the remaining mic audio without waiting for its reference.
    draining: bool,
    started: Instant,
    recent: VecDeque<Heard>,
    recorder: Option<Recorder>,
    record_mic: Vec<f32>,
    record_system: Vec<f32>,
}

impl<'m> Pipeline<'m> {
    pub fn new(
        models: &'m Models,
        mic: bool,
        system: bool,
        max_speakers: usize,
        threshold: f32,
        recorder: Option<Recorder>,
    ) -> Result<Self> {
        Ok(Self {
            mic: if mic {
                Some(LiveSession::new(
                    models,
                    Channel::Mic,
                    max_speakers,
                    threshold,
                )?)
            } else {
                None
            },
            system: if system {
                Some(LiveSession::new(
                    models,
                    Channel::System,
                    max_speakers,
                    threshold,
                )?)
            } else {
                None
            },
            aec: (mic && system).then(EchoCanceller::new),
            mic_queue: VecDeque::new(),
            system_queue: VecDeque::new(),
            mic_received: 0,
            system_received: 0,
            system_done: 0,
            mic_done: 0,
            draining: false,
            started: Instant::now(),
            recent: VecDeque::new(),
            recorder,
            record_mic: vec![],
            record_system: vec![],
        })
    }

    /// Number of channels the recorder should be created with.
    pub fn record_channels(mic: bool, system: bool) -> usize {
        if mic && system { 2 } else { 1 }
    }

    pub fn push(&mut self, source: Source, samples: &[f32]) -> Vec<Event> {
        match source {
            Source::Mic if self.mic.is_some() => {
                self.mic_queue.extend(samples);
                self.mic_received += samples.len();
            }
            Source::System if self.system.is_some() => {
                self.system_queue.extend(samples);
                self.system_received += samples.len();
            }
            _ => return vec![],
        }
        self.process()
    }

    /// Call regularly (e.g. every 100–250 ms): pads stalled sources with silence.
    pub fn tick(&mut self) -> Vec<Event> {
        let expected = (self.started.elapsed().as_secs_f32() * SAMPLE_RATE as f32) as usize;
        let mut events = vec![];
        for source in [Source::Mic, Source::System] {
            let received = match source {
                Source::Mic if self.mic.is_some() => self.mic_received,
                Source::System if self.system.is_some() => self.system_received,
                _ => continue,
            };
            if received + PAD_AFTER < expected {
                let silence = vec![0.0; expected - received - FRAME * 5];
                events.extend(self.push(source, &silence));
            }
        }
        events
    }

    pub fn finish(mut self) -> Result<Vec<Event>> {
        self.draining = true;
        let mut events = self.process();
        if let Some(s) = self.system.as_mut() {
            events.extend(s.finish());
        }
        if let Some(s) = self.mic.as_mut() {
            events.extend(s.finish());
        }
        let events = self.filter(events);
        if let Some(rec) = self.recorder.take() {
            let (m, s) = (
                std::mem::take(&mut self.record_mic),
                std::mem::take(&mut self.record_system),
            );
            let mut rec = rec;
            Self::write_record(
                &mut rec,
                m,
                s,
                self.mic.is_some(),
                self.system.is_some(),
                true,
            )?;
            rec.finish()?;
        }
        Ok(events)
    }

    fn process(&mut self) -> Vec<Event> {
        let mut events = vec![];
        // System first: it is the echo canceller's reference for the mic frames that follow.
        while self.system_queue.len() >= FRAME {
            let frame: Vec<f32> = self.system_queue.drain(..FRAME).collect();
            if let Some(aec) = self.aec.as_mut() {
                aec.render(&frame);
            }
            self.system_done += FRAME;
            if let Some(s) = self.system.as_mut() {
                events.extend(s.accept(&frame));
            }
            self.record_system.extend_from_slice(&frame);
        }
        while self.mic_queue.len() >= FRAME
            && (self.aec.is_none() || self.draining || self.mic_done + FRAME <= self.system_done)
        {
            let mut frame: Vec<f32> = self.mic_queue.drain(..FRAME).collect();
            if let Some(aec) = self.aec.as_mut() {
                aec.capture(&mut frame);
            }
            self.mic_done += FRAME;
            if let Some(s) = self.mic.as_mut() {
                events.extend(s.accept(&frame));
            }
            self.record_mic.extend_from_slice(&frame);
        }
        self.flush_record();
        self.filter(events)
    }

    /// Drops mic sentences that repeat a system sentence spoken at about the same time.
    fn filter(&mut self, events: Vec<Event>) -> Vec<Event> {
        let mut out = Vec::with_capacity(events.len());
        for event in events {
            if let Event::Final {
                channel,
                start,
                end,
                ref text,
                ..
            } = event
            {
                let w = words(text);
                match channel {
                    Channel::System => {
                        self.recent.push_back(Heard {
                            start,
                            end,
                            words: w,
                        });
                        if self.recent.len() > RECENT_SYSTEM {
                            self.recent.pop_front();
                        }
                    }
                    Channel::Mic if w.len() >= 3 => {
                        let echoed = self.recent.iter().any(|h| {
                            h.start < end + 2.0 && start < h.end + 2.0 && {
                                let shared = w.iter().filter(|x| h.words.contains(x)).count();
                                shared as f32 / w.len() as f32 >= ECHO_OVERLAP
                            }
                        });
                        if echoed {
                            log::info!("dropped mic echo: {text}");
                            continue;
                        }
                    }
                    Channel::Mic => {}
                }
            }
            out.push(event);
        }
        out
    }

    fn flush_record(&mut self) {
        let Some(mut rec) = self.recorder.take() else {
            self.record_mic.clear();
            self.record_system.clear();
            return;
        };
        let (mic, system) = (self.mic.is_some(), self.system.is_some());
        let n = match (mic, system) {
            (true, true) => self.record_mic.len().min(self.record_system.len()),
            (true, false) => self.record_mic.len(),
            _ => self.record_system.len(),
        };
        let m: Vec<f32> = self
            .record_mic
            .drain(..n.min(self.record_mic.len()))
            .collect();
        let s: Vec<f32> = self
            .record_system
            .drain(..n.min(self.record_system.len()))
            .collect();
        match Self::write_record(&mut rec, m, s, mic, system, false) {
            Ok(()) => self.recorder = Some(rec),
            Err(e) => log::error!("recording stopped: {e:#}"),
        }
    }

    fn write_record(
        rec: &mut Recorder,
        m: Vec<f32>,
        s: Vec<f32>,
        mic: bool,
        system: bool,
        last: bool,
    ) -> Result<()> {
        if mic && system {
            let mut n = m.len().min(s.len());
            if last {
                n = m.len().max(s.len());
            }
            let at = |v: &Vec<f32>, i: usize| v.get(i).copied().unwrap_or(0.0);
            let interleaved: Vec<f32> = (0..n).flat_map(|i| [at(&m, i), at(&s, i)]).collect();
            rec.push(&interleaved)
        } else if mic {
            rec.push(&m)
        } else {
            rec.push(&s)
        }
    }
}
