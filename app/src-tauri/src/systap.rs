//! System audio (the other side of a call) with a Core Audio process tap (macOS 14.2+): a mono
//! tap of everything the Mac plays except Murmur itself, read through a private aggregate device.
//! Unlike ScreenCaptureKit it asks only for "System audio recording" (not the screen) and costs
//! WindowServer nothing. Without the permission macOS gives the tap silence, not an error.

use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::Mutex;

use anyhow::{Result, anyhow};
use core_foundation::array::CFArray;
use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use crossbeam_channel::Sender;
use objc2::AnyThread;
use objc2_core_audio::{
    AudioDeviceCreateIOProcID, AudioDeviceDestroyIOProcID, AudioDeviceIOProcID, AudioDeviceStart, AudioDeviceStop,
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
    resampler: Mutex<Resampler>,
}

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

            let state = Box::into_raw(Box::new(State {
                tx,
                resampler: Mutex::new(Resampler::new(format.mSampleRate as u32)),
            }));
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
    let Some(first) = buffers.first().filter(|b| !b.mData.is_null()) else { return 0 };
    let mono: Vec<f32> = if buffers.len() > 1 {
        // One buffer per channel: average them.
        let frames = first.mDataByteSize as usize / 4;
        (0..frames)
            .map(|i| {
                buffers.iter().map(|b| unsafe { *(b.mData as *const f32).add(i) }).sum::<f32>() / buffers.len() as f32
            })
            .collect()
    } else {
        let channels = (first.mNumberChannels as usize).max(1);
        let samples = unsafe { std::slice::from_raw_parts(first.mData as *const f32, first.mDataByteSize as usize / 4) };
        samples.chunks(channels).map(|c| c.iter().sum::<f32>() / c.len() as f32).collect()
    };
    let mut out = Vec::with_capacity(mono.len() / 2);
    if let Ok(mut resampler) = state.resampler.lock() {
        resampler.process(&mono, &mut out);
    }
    if !out.is_empty() {
        let _ = state.tx.send((Source::System, out));
    }
    0
}

impl Drop for SystemTap {
    fn drop(&mut self) {
        unsafe {
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
