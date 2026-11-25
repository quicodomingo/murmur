//! A phone without a phone: pairs with Murmur on this computer and sends it a meeting, to try
//! the computer's side (mobile.rs) before there's an iOS app (docs/EMPARELLAR.md).
//!
//!   cargo run --example fake_phone -- pair                  (the code on screen; or pass its text)
//!   cargo run --example fake_phone -- send ../../data/reunio-3min.wav "Reunió de prova"
//!   cargo run --example fake_phone -- results
//!
//! Its keys and the computer it's paired with go in `fake_phone.json` in the system's temp folder.

use std::net::TcpStream;
use std::path::PathBuf;

use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use serde_json::json;

use murmur_core::sync::{self, Incoming, Keys, Msg, PairingCode};

#[derive(Serialize, Deserialize)]
struct Saved {
    private: Vec<u8>,
    computer: [u8; 32],
    addr: String,
    since: f64,
}

fn state_file() -> PathBuf {
    std::env::temp_dir().join("fake_phone.json")
}

fn load() -> Result<Saved> {
    Ok(serde_json::from_str(&std::fs::read_to_string(state_file()).context("not paired yet: run `pair` first")?)?)
}

fn save(s: &Saved) -> Result<()> {
    Ok(std::fs::write(state_file(), serde_json::to_string(s)?)?)
}

const NAME: &str = "iPhone de prova";

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("pair") => {
            // A development build of the app leaves the code on screen in a temp file.
            let uri = match args.get(1) {
                Some(uri) => uri.clone(),
                None => std::fs::read_to_string(std::env::temp_dir().join("murmur-pairing-code.txt")).context("no code: open Settings › Mòbil › Connecta un mòbil, or pass the code")?,
            };
            let code = PairingCode::parse(uri.trim())?;
            let keys = Keys::generate()?;
            let addr = format!("{}:{}", code.addrs.first().ok_or_else(|| anyhow!("no address in the code"))?, code.port);
            let session = sync::pair(TcpStream::connect(&addr)?, &keys, &code, NAME)?;
            println!("paired with «{}»", session.remote_name);
            save(&Saved { private: keys.private, computer: code.key, addr, since: 0.0 })
        }
        Some("send") => {
            let wav = PathBuf::from(args.get(1).ok_or_else(|| anyhow!("send <file.wav> [title]"))?);
            let title = args.get(2).cloned().unwrap_or_else(|| "Reunió del mòbil".into());
            let saved = load()?;
            let keys = Keys::from_private(&saved.private)?;
            // The audio as the phone records it: Opus, mono, 16 kHz.
            let samples = read_wav(&wav)?;
            let ogg = std::env::temp_dir().join("fake_phone.ogg");
            let mut rec = murmur_core::recorder::Recorder::create(&ogg, 1)?;
            rec.push(&samples)?;
            rec.finish()?;
            let seconds = samples.len() as f64 / 16_000.0;
            // The live text, roughly: one utterance every 10 s, all from "Tu".
            let id = format!("fake-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis());
            // Line ids are unique across meetings (the database keys them so).
            let utterances: Vec<_> = (0..(seconds / 10.0) as usize)
                .map(|i| json!({ "id": format!("{id}-{i}"), "start": i as f64 * 10.0, "end": i as f64 * 10.0 + 9.0, "speaker": 0, "text": format!("Frase {} del directe.", i + 1) }))
                .collect();
            let created = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis() as f64;
            let meeting = json!({
                "id": id, "title": title, "createdAt": created, "duration": seconds, "status": "done",
                "utterances": utterances, "speakerNames": {}, "notes": [], "sources": { "mic": true, "system": false },
                "language": "ca", "screens": [],
            });
            let mut s = sync::connect(TcpStream::connect(&saved.addr)?, &keys, &saved.computer, NAME)?;
            let files = vec![sync::file_info("audio.ogg", &ogg)?];
            s.send(&Msg::PutMeeting { meeting, files })?;
            let Msg::Have { files, .. } = s.recv_msg()? else { bail!("expected Have") };
            sync::send_file(&mut s, &id, "audio.ogg", &ogg, files[0].have)?;
            println!("{:?}", s.recv_msg()?);
            s.send(&Msg::Bye)?;
            Ok(())
        }
        Some("results") => {
            let mut saved = load()?;
            let keys = Keys::from_private(&saved.private)?;
            let mut s = sync::connect(TcpStream::connect(&saved.addr)?, &keys, &saved.computer, NAME)?;
            // Says it takes the computer's own meetings too (Configuració › Mòbil), and has none yet.
            s.send(&Msg::GetResults { since: saved.since, known: Some(vec![]) })?;
            loop {
                match s.recv()? {
                    Incoming::Msg(Msg::Results { meeting, revised_at, computer }) => {
                        let utterances = meeting["utterances"].as_array().map(Vec::len).unwrap_or(0);
                        let from = if computer { " · de l'ordinador" } else { "" };
                        println!("{} · «{}» · {utterances} frases · parlants {}{from}", meeting["id"], meeting["title"].as_str().unwrap_or(""), meeting["speakerNames"]);
                        saved.since = saved.since.max(revised_at);
                    }
                    Incoming::Msg(Msg::Bye) => break,
                    other => bail!("unexpected {other:?}"),
                }
            }
            s.send(&Msg::Bye)?;
            save(&saved)
        }
        _ => bail!("fake_phone pair <uri> | send <file.wav> [title] | results"),
    }
}

/// A 16 kHz mono 16-bit WAV, as the repo's test recordings are.
fn read_wav(path: &PathBuf) -> Result<Vec<f32>> {
    let bytes = std::fs::read(path)?;
    let data = bytes.windows(4).position(|w| w == b"data").ok_or_else(|| anyhow!("not a WAV"))? + 8;
    Ok(bytes[data..].chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0).collect())
}
