//! System audio (the other side of a call) with a Core Audio process tap (macOS 14.2+): a mono
//! tap of everything the Mac plays except Murmur itself, read through a private aggregate device.
//! Unlike ScreenCaptureKit it asks only for "System audio recording" (not the screen) and costs
//! WindowServer nothing. Without the permission macOS gives the tap silence, not an error.

use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use anyhow::{Result, anyhow};
use core_foundation::array::CFArray;
use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use crossbeam_channel::Sender;
use objc2::AnyThread;
use objc2_core_audio::{
    AudioDeviceCreateIOProcID, AudioDeviceDestroyIOProcID, AudioObjectAddPropertyListener, AudioObjectRemovePropertyListener,
    kAudioDevicePropertyNominalSampleRate, AudioDeviceIOProcID, AudioDeviceStart, AudioDeviceStop,
    AudioHardwareCreateAggregateDevice, AudioHardwareCreateProcessTap, AudioHardwareDestroyAggregateDevice,
    AudioHardwareDestroyProcessTap, AudioObjectGetPropertyData, AudioObjectID, AudioObjectPropertyAddress, CATapDescription,
    kAudioDevicePropertyDeviceUID, kAudioHardwarePropertyDefaultSystemOutputDevice,
    kAudioHardwarePropertyTranslatePIDToProcessObject, kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal,
    kAudioObjectSystemObject, kAudioTapPropertyFormat, kAudioTapPropertyUID,
};
use objc2_core_audio_types::{AudioBuffer, AudioBufferList, AudioStreamBasicDescription, AudioTimeStamp};
use objc2_foundation::{NSArray, NSNumber, NSString};

use crate::audio::{Frame, Resampler, Source};

/// What the IO callback needs, on Core Audio's real-time thread.
struct State {
    tx: Sender<Frame>,
    /// The device's sample rate. It can change mid-recording: when a call app turns on macOS's
    /// voice processing, the output drops to 24 kHz, and converting as if it were still 48 kHz
    /// sped the other side up ×2 (unrecognisable).
    rate: AtomicU32,
    /// The resampler and the rate it was made for.
    resampler: Mutex<(u32, Resampler)>,
    /// Checking the rate against the clock: last callback, seconds and frames counted.
    measured: Mutex<Measure>,
}

/// The rate that frames actually arrive at, checked every few seconds: if it's far from the
/// device's (a change macOS didn't report), the nearest standard rate is used instead.
const CHECK_EVERY_S: f64 = 4.0;
/// A longer wait between callbacks is a pause (nothing playing), left out of the count.
const GAP_S: f64 = 0.1;

struct Measure {
    last: Option<std::time::Instant>,
    seconds: f64,
    frames: u64,
}
const RATES: [u32; 8] = [8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 96_000];

/// A running tap. Dropping it stops the capture and removes the tap and its device.
pub struct SystemTap {
    tap: AudioObjectID,
    device: AudioObjectID,
    proc_id: AudioDeviceIOProcID,
    state: *mut State,
}

// The ids are plain numbers and `state` is only freed in Drop, after the device has stopped.
unsafe impl Send for SystemTap {}

fn address(selector: u32) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    }
}

/// Reads a fixed-size property (`T` must match its type).
unsafe fn get<T: Copy>(object: AudioObjectID, selector: u32, qualifier: Option<&u32>) -> Result<T> {
    let mut value = std::mem::MaybeUninit::<T>::zeroed();
    let mut size = std::mem::size_of::<T>() as u32;
    let mut addr = address(selector);
    let (q_size, q_ptr) = qualifier.map_or((0, std::ptr::null()), |q| (4, q as *const u32 as *const c_void));
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&mut addr),
            q_size,
            q_ptr,
            NonNull::from(&mut size),
            NonNull::new_unchecked(value.as_mut_ptr() as *mut c_void),
        )
    };
    if status != 0 {
        return Err(anyhow!("Core Audio {selector:#x}: error {status}"));
    }
    Ok(unsafe { value.assume_init() })
}

/// A CFString property (UIDs), returned owned.
unsafe fn get_string(object: AudioObjectID, selector: u32) -> Result<CFString> {
    let raw: *const c_void = unsafe { get(object, selector, None)? };
    if raw.is_null() {
        return Err(anyhow!("Core Audio {selector:#x}: buit"));
    }
    Ok(unsafe { CFString::wrap_under_create_rule(raw as _) })
}

fn check(status: i32, what: &str) -> Result<()> {
    if status == 0 { Ok(()) } else { Err(anyhow!("No s'ha pogut {what} (Core Audio {status})")) }
}

pub fn start(tx: Sender<Frame>) -> Result<SystemTap> {
    unsafe {
        // Everything the Mac plays except Murmur (its own player, the alerts).
        let me: Option<AudioObjectID> =
            get(kAudioObjectSystemObject as u32, kAudioHardwarePropertyTranslatePIDToProcessObject, Some(&std::process::id())).ok();
        let excluded: Vec<_> = me.filter(|id| *id != 0).map(NSNumber::numberWithUnsignedInt).into_iter().collect();
        let description = CATapDescription::initMonoGlobalTapButExcludeProcesses(CATapDescription::alloc(), &NSArray::from_retained_slice(&excluded));
        description.setName(&NSString::from_str("Murmur"));
        description.setPrivate(true);

        let mut tap: AudioObjectID = 0;
        check(AudioHardwareCreateProcessTap(Some(&description), &mut tap), "crear la captura de l'àudio del sistema")?;
        let built = (|| -> Result<SystemTap> {
            let tap_uid = get_string(tap, kAudioTapPropertyUID)?;
            let format: AudioStreamBasicDescription = get(tap, kAudioTapPropertyFormat, None)?;
            // The aggregate device runs on the clock of the current output device.
            let output: AudioObjectID = get(kAudioObjectSystemObject as u32, kAudioHardwarePropertyDefaultSystemOutputDevice, None)?;
            let output_uid = get_string(output, kAudioDevicePropertyDeviceUID)?;

            let pair = |k: &str, v: CFType| (CFString::new(k), v);
            let sub_device = CFDictionary::from_CFType_pairs(&[pair("uid", output_uid.as_CFType())]);
            let sub_tap = CFDictionary::from_CFType_pairs(&[pair("uid", tap_uid.as_CFType()), pair("drift", CFBoolean::true_value().as_CFType())]);
            let uid = format!("com.quicodomingo.murmur.tap.{}", std::process::id());
            let description = CFDictionary::from_CFType_pairs(&[
                pair("name", CFString::new("Murmur").as_CFType()),
                pair("uid", CFString::new(&uid).as_CFType()),
                pair("private", CFBoolean::true_value().as_CFType()),
                pair("stacked", CFBoolean::false_value().as_CFType()),
                pair("tapautostart", CFBoolean::true_value().as_CFType()),
                pair("master", output_uid.as_CFType()),
                pair("subdevices", CFArray::from_CFTypes(&[sub_device]).as_CFType()),
                pair("taps", CFArray::from_CFTypes(&[sub_tap]).as_CFType()),
            ]);
            let mut device: AudioObjectID = 0;
            check(
                AudioHardwareCreateAggregateDevice(
                    &*(description.as_concrete_TypeRef() as *const objc2_core_foundation::CFDictionary),
                    NonNull::from(&mut device),
                ),
                "preparar l'àudio del sistema",
            )?;

            // The audio arrives at the device's rate (the tap is drift-compensated to it).
            let nominal: f64 = get(device, kAudioDevicePropertyNominalSampleRate, None).unwrap_or(format.mSampleRate);
            if std::env::var_os("MURMUR_DEBUG_TAP").is_some() {
                eprintln!(
                    "tap format: {} Hz, {} ch, flags {:#x}, {} bits · aggregate nominal {nominal} Hz",
                    format.mSampleRate, format.mChannelsPerFrame, format.mFormatFlags, format.mBitsPerChannel
                );
            }
            let rate = nominal.round() as u32;
            let state = Box::into_raw(Box::new(State {
                tx,
                rate: AtomicU32::new(rate),
                resampler: Mutex::new((rate, Resampler::new(rate))),
                measured: Mutex::new(Measure { last: None, seconds: 0.0, frames: 0 }),
            }));
            let mut addr = address(kAudioDevicePropertyNominalSampleRate);
            AudioObjectAddPropertyListener(device, NonNull::from(&mut addr), Some(rate_changed), state as *mut c_void);
            let mut proc_id: AudioDeviceIOProcID = None;
            let started = check(AudioDeviceCreateIOProcID(device, Some(io_proc), state as *mut c_void, NonNull::from(&mut proc_id)), "llegir l'àudio del sistema")
                .and_then(|_| check(AudioDeviceStart(device, proc_id), "començar l'àudio del sistema"));
            let running = SystemTap { tap: 0, device, proc_id, state };
            started?;
            Ok(running)
        })();
        match built {
            Ok(mut running) => {
                running.tap = tap;
                Ok(running)
            }
            Err(e) => {
                AudioHardwareDestroyProcessTap(tap);
                Err(e)
            }
        }
    }
}

/// The device changed its sample rate (see `State::rate`).
unsafe extern "C-unwind" fn rate_changed(device: AudioObjectID, _count: u32, _addresses: NonNull<AudioObjectPropertyAddress>, client: *mut c_void) -> i32 {
    let state = unsafe { &*(client as *const State) };
    if let Ok(rate) = unsafe { get::<f64>(device, kAudioDevicePropertyNominalSampleRate, None) } {
        if std::env::var_os("MURMUR_DEBUG_TAP").is_some() {
            eprintln!("tap: device rate now {rate} Hz");
        }
        state.rate.store(rate.round() as u32, Ordering::Relaxed);
    }
    0
}

/// Core Audio's real-time callback: f32 samples from the tap → mono → 16 kHz → the pipeline.
unsafe extern "C-unwind" fn io_proc(
    _device: AudioObjectID,
    _now: NonNull<AudioTimeStamp>,
    input: NonNull<AudioBufferList>,
    _input_time: NonNull<AudioTimeStamp>,
    _output: NonNull<AudioBufferList>,
    _output_time: NonNull<AudioTimeStamp>,
    client: *mut c_void,
) -> i32 {
    let state = unsafe { &*(client as *const State) };
    let list = unsafe { input.as_ref() };
    let buffers: &[AudioBuffer] = unsafe { std::slice::from_raw_parts(list.mBuffers.as_ptr(), list.mNumberBuffers as usize) };
    // The tap's stream comes after any input of the output device (a headset's mic): the last.
    let Some(first) = buffers.last().filter(|b| !b.mData.is_null()) else { return 0 };
    let channels = (first.mNumberChannels as usize).max(1);
    let samples = unsafe { std::slice::from_raw_parts(first.mData as *const f32, first.mDataByteSize as usize / 4) };
    let mono: Vec<f32> = samples.chunks(channels).map(|c| c.iter().sum::<f32>() / c.len() as f32).collect();
    if std::env::var_os("MURMUR_DEBUG_TAP").is_some() {
        use std::sync::atomic::{AtomicU64, Ordering};
        static FRAMES: AtomicU64 = AtomicU64::new(0);
        static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
        let start = START.get_or_init(std::time::Instant::now);
        let total = FRAMES.fetch_add(mono.len() as u64, Ordering::Relaxed) + mono.len() as u64;
        if total % 48_000 < mono.len() as u64 {
            eprintln!("tap: {} buffers × {} ch, {:.0} frames/s", buffers.len(), first.mNumberChannels, total as f64 / start.elapsed().as_secs_f64());
        }
    }
    if let Ok(mut measured) = state.measured.lock() {
        // Count the frames of each callback against the time since the previous one, skipping
        // pauses, so silence without callbacks doesn't look like a slower rate.
        let now = std::time::Instant::now();
        if let Some(gap) = measured.last.map(|t| now.duration_since(t).as_secs_f64()).filter(|g| *g < GAP_S) {
            measured.seconds += gap;
            measured.frames += mono.len() as u64;
        }
        measured.last = Some(now);
        if measured.seconds >= CHECK_EVERY_S {
            let real = measured.frames as f64 / measured.seconds;
            let expected = state.rate.load(Ordering::Relaxed) as f64;
            // Only a real stream (not a burst after a pause): close to a standard rate.
            let nearest = RATES.iter().copied().min_by_key(|r| (*r as f64 - real).abs() as u64).unwrap_or(48_000);
            if (real - expected).abs() > expected * 0.15 && (real - nearest as f64).abs() < nearest as f64 * 0.05 {
                if std::env::var_os("MURMUR_DEBUG_TAP").is_some() {
                    eprintln!("tap: frames arrive at {real:.0}/s, not {expected}: using {nearest} Hz");
                }
                state.rate.store(nearest, Ordering::Relaxed);
            }
            measured.seconds = 0.0;
            measured.frames = 0;
        }
    }
    let mut out = Vec::with_capacity(mono.len() / 2);
    if let Ok(mut current) = state.resampler.lock() {
        let rate = state.rate.load(Ordering::Relaxed);
        if current.0 != rate && rate > 0 {
            *current = (rate, Resampler::new(rate));
        }
        current.1.process(&mono, &mut out);
    }
    if !out.is_empty() {
        let _ = state.tx.send((Source::System, out));
    }
    0
}

impl Drop for SystemTap {
    fn drop(&mut self) {
        unsafe {
            let mut addr = address(kAudioDevicePropertyNominalSampleRate);
            AudioObjectRemovePropertyListener(self.device, NonNull::from(&mut addr), Some(rate_changed), self.state as *mut c_void);
            AudioDeviceStop(self.device, self.proc_id);
            AudioDeviceDestroyIOProcID(self.device, self.proc_id);
            AudioHardwareDestroyAggregateDevice(self.device);
            if self.tap != 0 {
                AudioHardwareDestroyProcessTap(self.tap);
            }
            drop(Box::from_raw(self.state));
        }
    }
}
