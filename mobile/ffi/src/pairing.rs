//! The phone's side of pairing and syncing with the computer (docs/EMPARELLAR.md). The protocol
//! is `murmur_core::sync`, which the computer's side (mobile.rs) shares.
//!
//! - **Keys:** the phone's private key lives in the iPhone's keychain; Swift keeps it and passes it
//!   in. The computer's public key and name aren't secret and go in the app's settings.
//! - **Addresses:** Swift finds the computer with Bonjour and passes every candidate ("host:port");
//!   the handshake only completes with the right computer, so the others are just skipped.
//! - **What's been sent:** `sync.json` in the data folder (which meetings the computer has stored,
//!   which came back revised, and since when to ask), so the meeting's format stays the computer's.

use std::collections::BTreeSet;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

use murmur_core::sync::{self, Incoming, Keys, Msg, PairingCode, Session};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Murmur, MurmurError, Result, lock};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// A computer busy with a long file still answers well within this.
const IO_TIMEOUT: Duration = Duration::from_secs(60);

/// What the phone remembers about syncing, per meeting.
#[derive(Default, Serialize, Deserialize)]
pub(crate) struct SyncState {
    /// Results revised after this (seconds since 1970, the computer's clock) are still to come.
    #[serde(default)]
    pub since: f64,
    /// Stored on the computer, whole and checked.
    #[serde(default)]
    pub sent: BTreeSet<String>,
    /// Came back after the final pass.
    #[serde(default)]
    pub revised: BTreeSet<String>,
    /// Renamed (the meeting or a speaker) on the phone after it was sent: those names win over
    /// the computer's when the results come back.
    #[serde(default)]
    pub edited: BTreeSet<String>,
    /// Recorded on the computer and sent here, text only (Configuració › Mòbil on the computer):
    /// never sent back as the phone's own.
    #[serde(default)]
    pub from_computer: BTreeSet<String>,
    /// The computer's meetings deleted here: they don't come again.
    #[serde(default)]
    pub dismissed: BTreeSet<String>,
}

impl SyncState {
    /// A finished meeting of this phone's that the computer doesn't have yet.
    pub(crate) fn to_send(&self, id: &str, status: &str) -> bool {
        status == "done" && !self.sent.contains(id) && !self.from_computer.contains(id)
    }

    /// What survives unpairing or pairing again: what came back revised, and which meetings are
    /// the computer's (or were deleted here).
    fn kept(&self) -> Self {
        Self { revised: self.revised.clone(), from_computer: self.from_computer.clone(), dismissed: self.dismissed.clone(), ..Default::default() }
    }
}

/// What's in a pairing code, to show before pairing.
#[derive(uniffi::Record)]
pub struct PairingCodeInfo {
    pub computer_name: String,
    /// Where the computer was listening when it showed the code ("host:port").
    pub addresses: Vec<String>,
}

/// The computer this phone is paired with.
#[derive(uniffi::Record)]
pub struct Computer {
    pub name: String,
    /// Its public key (not secret): to know it again.
    pub key: Vec<u8>,
    /// The address that answered, to try first next time.
    pub address: String,
}

/// What a sync did.
#[derive(uniffi::Record)]
pub struct SyncReport {
    pub address: String,
    pub computer_name: String,
    /// Meetings the computer stored now.
    pub sent: u32,
    /// Meetings that came back revised now.
    pub revised: u32,
    /// The computer's own meetings that arrived now.
    pub received: u32,
    /// Meetings the computer refused (they'll be tried again next time).
    pub failed: u32,
}

/// A new private key for this phone, for the keychain.
#[uniffi::export]
pub fn new_sync_key() -> Result<Vec<u8>> {
    Ok(Keys::generate()?.private)
}

/// Reads the QR's text. Fails if it isn't a Murmur pairing code (or one from another version).
#[uniffi::export]
pub fn read_pairing_code(uri: String) -> Result<PairingCodeInfo> {
    let code = PairingCode::parse(uri.trim()).map_err(|_| MurmurError::NotACode)?;
    Ok(PairingCodeInfo { computer_name: code.name.clone(), addresses: addresses(&code) })
}

fn addresses(code: &PairingCode) -> Vec<String> {
    code.addrs.iter().map(|a| if a.contains(':') { format!("[{a}]:{}", code.port) } else { format!("{a}:{}", code.port) }).collect()
}

/// The first of `candidates` that answers and completes the handshake.
fn reach<T>(candidates: &[String], mut handshake: impl FnMut(TcpStream) -> anyhow::Result<T>) -> Result<(String, T)> {
    let mut refused = false;
    let mut seen = BTreeSet::new();
    for candidate in candidates {
        if !seen.insert(candidate.clone()) {
            continue;
        }
        let Ok(addrs) = candidate.to_socket_addrs() else { continue };
        let addrs: Vec<SocketAddr> = addrs.collect();
        for addr in addrs {
            let Ok(stream) = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) else { continue };
            let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
            let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
            match handshake(stream) {
                Ok(t) => return Ok((candidate.clone(), t)),
                // It answered but it isn't this phone's computer (another one on the network, or
                // ours after it unpaired this phone).
                Err(e) => {
                    log_debug(&format!("{candidate}: {e:#}"));
                    refused = true;
                }
            }
        }
    }
    Err(if refused { MurmurError::NotPaired } else { MurmurError::Unreachable })
}

fn log_debug(s: &str) {
    if cfg!(debug_assertions) {
        eprintln!("murmur sync: {s}");
    }
}

fn key32(key: &[u8]) -> Result<[u8; 32]> {
    key.try_into().map_err(|_| MurmurError::Failed("bad key".into()))
}

#[uniffi::export]
impl Murmur {
    /// Pairs with the computer of the QR's `uri`. `extra` are more addresses to try (the ones
    /// Bonjour found), after the code's own. Returns the computer, to remember.
    pub fn pair(&self, uri: String, extra: Vec<String>, private_key: Vec<u8>, phone_name: String) -> Result<Computer> {
        let code = PairingCode::parse(uri.trim()).map_err(|_| MurmurError::NotACode)?;
        let keys = Keys::from_private(&private_key)?;
        let mut candidates = addresses(&code);
        candidates.extend(extra);
        let (address, session) = reach(&candidates, |stream| sync::pair(stream, &keys, &code, &phone_name)).map_err(|e| match e {
            // With a code, a refused handshake means the code isn't on screen any more.
            MurmurError::NotPaired => MurmurError::CodeExpired,
            e => e,
        })?;
        let mut session = session;
        let _ = session.send(&Msg::Bye);
        // A new computer (or the same one again): everything goes to it from the start.
        self.save_sync(&self.load_sync().kept())?;
        Ok(Computer { name: session.remote_name.clone(), key: code.key.to_vec(), address })
    }

    /// Unpaired on the phone: what was sent is forgotten (pairing again sends it all; the computer
    /// knows what it already has). What came back revised stays revised.
    pub fn forget_computer(&self) -> Result<()> {
        self.save_sync(&self.load_sync().kept())
    }

    /// Finished meetings the computer doesn't have yet.
    pub fn unsent_count(&self) -> Result<u32> {
        let state = self.load_sync();
        Ok(lock(&self.db).list()?.iter().filter(|m| state.to_send(&m.id, &m.status)).count() as u32)
    }

    /// Sends the computer every finished meeting it doesn't have yet (with its audio, resuming a
    /// cut one), then picks up what it has revised. One sync at a time.
    /// `keep_audio` false (Configuració › Desa l'àudio al telèfon): a meeting's audio is deleted
    /// from the phone once the computer has stored it whole and checked.
    pub fn sync(&self, candidates: Vec<String>, private_key: Vec<u8>, computer_key: Vec<u8>, phone_name: String, keep_audio: bool) -> Result<SyncReport> {
        let _one = self.syncing.try_lock().map_err(|_| MurmurError::Busy)?;
        let keys = Keys::from_private(&private_key)?;
        let computer = key32(&computer_key)?;
        let (address, mut session) = reach(&candidates, |stream| sync::connect(stream, &keys, &computer, &phone_name))?;
        let mut report = SyncReport { address, computer_name: session.remote_name.clone(), sent: 0, revised: 0, received: 0, failed: 0 };
        let mut state = self.load_sync();

        let pending: Vec<String> = lock(&self.db).list()?.into_iter().filter(|m| state.to_send(&m.id, &m.status)).map(|m| m.id).collect();
        for id in pending {
            match self.send_meeting(&mut session, &id)? {
                true => {
                    if !keep_audio {
                        // The computer said Stored: it has every byte and the checksum matched.
                        let meeting = lock(&self.db).get(&id)?;
                        if let Some(path) = meeting.as_ref().and_then(|m| self.audio_of(m)) {
                            let _ = std::fs::remove_file(path);
                        }
                    }
                    state.sent.insert(id);
                    report.sent += 1;
                    self.save_sync(&state)?;
                }
                false => report.failed += 1,
            }
        }

        // The computer's own meetings this phone has (or deleted): the computer sends the rest,
        // if it's been told to (Configuració › Mòbil).
        let known = state.from_computer.union(&state.dismissed).cloned().collect();
        session.send(&Msg::GetResults { since: state.since, known: Some(known) }).map_err(io)?;
        loop {
            match session.recv().map_err(io)? {
                Incoming::Msg(Msg::Results { meeting, revised_at, computer }) => {
                    match self.take_results(meeting, &state, computer)? {
                        Took::Revised => report.revised += 1,
                        Took::Received => report.received += 1,
                        Took::Nothing => {}
                    }
                    // Re-read first: take_results marked it revised.
                    state = self.load_sync();
                    state.since = state.since.max(revised_at);
                    self.save_sync(&state)?;
                }
                Incoming::Msg(Msg::Bye) => break,
                other => return Err(MurmurError::Failed(format!("unexpected {other:?}"))),
            }
        }
        let _ = session.send(&Msg::Bye);
        Ok(report)
    }
}

/// What a meeting from the computer did here.
enum Took {
    /// One of the phone's came back revised (or one of the computer's changed).
    Revised,
    /// One of the computer's arrived.
    Received,
    /// Nothing: deleted here.
    Nothing,
}

/// A connection that drops halfway: the computer went away; next time it carries on.
fn io(e: anyhow::Error) -> MurmurError {
    if e.downcast_ref::<std::io::Error>().is_some() { MurmurError::Unreachable } else { e.into() }
}

impl Murmur {
    fn sync_file(&self) -> std::path::PathBuf {
        self.data_dir.join("sync.json")
    }

    pub(crate) fn load_sync(&self) -> SyncState {
        std::fs::read_to_string(self.sync_file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    pub(crate) fn save_sync(&self, state: &SyncState) -> Result<()> {
        let tmp = self.sync_file().with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(state).map_err(|e| MurmurError::Failed(e.to_string()))?).map_err(|e| MurmurError::Failed(e.to_string()))?;
        std::fs::rename(&tmp, self.sync_file()).map_err(|e| MurmurError::Failed(e.to_string()))
    }

    /// A rename on the phone after the meeting was sent: the phone's names win when it comes back.
    pub(crate) fn note_edit(&self, id: &str) {
        let mut state = self.load_sync();
        if state.sent.contains(id) && state.edited.insert(id.to_owned()) {
            let _ = self.save_sync(&state);
        }
    }

    /// One meeting and its audio. True when the computer has it whole; false when it refused it.
    fn send_meeting(&self, session: &mut Session<TcpStream>, id: &str) -> Result<bool> {
        let Some(mut meeting) = lock(&self.db).get(id)? else { return Ok(true) };
        // Everything goes by a plain name: the audio, and the photos as the computer's screenshots
        // ("screens/<file>.jpg", which mobile.rs places with the meeting).
        let mut sending: Vec<(String, std::path::PathBuf)> = vec![];
        if let Some(path) = self.audio_of(&meeting) {
            sending.push(("audio.ogg".into(), path));
        }
        if let Some(screens) = meeting.get_mut("screens").and_then(Value::as_array_mut) {
            screens.retain_mut(|screen| {
                let Some(path) = screen["path"].as_str().map(|p| self.data_dir.join(p)).filter(|p| p.exists()) else { return false };
                let Some(file) = path.file_name().map(|f| f.to_string_lossy().into_owned()) else { return false };
                let name = format!("screens/{file}");
                screen["path"] = Value::from(name.clone());
                sending.push((name, path));
                true
            });
        }
        // The phone's own paths mean nothing on the computer.
        if let Some(m) = meeting.as_object_mut() {
            m.remove("audioPath");
        }
        let files = sending.iter().map(|(name, path)| sync::file_info(name, path)).collect::<anyhow::Result<Vec<_>>>()?;
        session.send(&Msg::PutMeeting { meeting, files }).map_err(io)?;
        match session.recv_msg().map_err(io)? {
            Msg::Have { files, .. } => {
                for (name, path) in &sending {
                    let have = files.iter().find(|f| &f.name == name).map(|f| f.have).unwrap_or(0);
                    sync::send_file(session, id, name, path, have).map_err(io)?;
                }
            }
            Msg::Failed { reason, .. } => {
                log_debug(&format!("{id} refused: {reason}"));
                return Ok(false);
            }
            other => return Err(MurmurError::Failed(format!("expected Have, got {other:?}"))),
        }
        match session.recv_msg().map_err(io)? {
            Msg::Stored { .. } => Ok(true),
            Msg::Failed { reason, .. } => {
                log_debug(&format!("{id} failed: {reason}"));
                Ok(false)
            }
            other => Err(MurmurError::Failed(format!("expected Stored, got {other:?}"))),
        }
    }

    /// A meeting after the computer's final pass takes the place of the phone's: its lines,
    /// speakers, summary and translation. The phone keeps its audio, and its names if they were
    /// changed here after sending. A meeting deleted on the phone stays deleted.
    /// One of the computer's own (`computer`) that isn't here yet is added, text only.
    fn take_results(&self, mut meeting: Value, state: &SyncState, computer: bool) -> Result<Took> {
        let id = crate::safe_dir(meeting["id"].as_str().unwrap_or_default());
        if id.is_empty() {
            return Ok(Took::Nothing);
        }
        let mut db = lock(&self.db);
        let Some(mine) = db.get(&id)? else {
            if !computer || state.dismissed.contains(&id) {
                return Ok(Took::Nothing);
            }
            meeting["id"] = Value::from(id.clone());
            meeting["audioPath"] = Value::Null;
            meeting["screens"] = Value::Array(vec![]);
            meeting["status"] = Value::from("done");
            db.put(&meeting)?;
            drop(db);
            let mut state = self.load_sync();
            state.from_computer.insert(id.clone());
            state.sent.insert(id.clone());
            state.revised.insert(id);
            self.save_sync(&state)?;
            return Ok(Took::Received);
        };
        meeting["audioPath"] = match self.audio_of(&mine) {
            Some(path) => Value::from(path.to_string_lossy().into_owned()),
            None => mine["audioPath"].clone(),
        };
        // The photos stay as the phone has them (the computer doesn't send its paths back).
        meeting["screens"] = mine["screens"].clone();
        if state.edited.contains(&id) {
            meeting["title"] = mine["title"].clone();
            meeting["speakerNames"] = mine["speakerNames"].clone();
            meeting["notesDoc"] = mine["notesDoc"].clone();
            meeting["tags"] = mine["tags"].clone();
            // Tasks ticked on the phone stay ticked.
            if let (Some(theirs), Some(ours)) = (meeting.pointer_mut("/cover/tasks").and_then(Value::as_array_mut), mine.pointer("/cover/tasks").and_then(Value::as_array)) {
                for task in theirs.iter_mut() {
                    if ours.iter().any(|o| o["text"] == task["text"] && o["done"] == Value::Bool(true)) {
                        task["done"] = Value::Bool(true);
                    }
                }
            }
        }
        meeting["status"] = Value::from("done");
        db.put(&meeting)?;
        drop(db);
        let mut state = self.load_sync();
        state.revised.insert(id.clone());
        state.edited.remove(&id);
        self.save_sync(&state)?;
        Ok(Took::Revised)
    }
}
