//! A computer without the computer's app: the other side of `fake_phone`, to try the phone's
//! pairing and sync (docs/EMPARELLAR.md) in the simulator or on an iPhone.
//!
//!   cargo run --release --example fake_computer [address]
//!
//! It prints a pairing code (pass it to the app with `-pair <code>`, or as a QR with `qrencode`),
//! then stores whatever the phone sends in the system's temp folder and sends each meeting back
//! "revised": with a marked title, so it shows on the phone. No Bonjour: the code has the address.

use std::net::TcpListener;

use anyhow::Result;
use murmur_core::sync::{self, Accept, Incoming, Keys, Msg, PairingCode, Receiving, VERSION};
use serde_json::{Value, json};

fn main() -> Result<()> {
    let address = std::env::args().nth(1).unwrap_or_else(|| "127.0.0.1".into());
    let keys = Keys::generate()?;
    let listener = TcpListener::bind("0.0.0.0:0")?;
    let port = listener.local_addr()?.port();
    let mut secret = [0u8; 32];
    for (i, b) in secret.iter_mut().enumerate() {
        *b = (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos() as u8).wrapping_add(i as u8 * 37);
    }
    let code = PairingCode { version: VERSION, name: "Ordinador de prova".into(), key: keys.public, secret, addrs: vec![address], port };
    println!("{}", code.to_uri());
    let dest = std::env::temp_dir().join("fake_computer");
    let mut paired: Vec<[u8; 32]> = vec![];
    let mut received: Vec<Value> = vec![];
    let mut revised_at = 0.0;

    for stream in listener.incoming() {
        let stream = stream?;
        let rules = Accept { pairing_secret: Some(&secret), paired: &paired };
        let (mut s, arrival) = match sync::accept(stream, &keys, &rules, "Ordinador de prova") {
            Ok(x) => x,
            Err(e) => {
                eprintln!("refused: {e:#}");
                continue;
            }
        };
        eprintln!("{arrival:?}: «{}»", s.remote_name);
        if !paired.contains(&s.remote) {
            paired.push(s.remote);
        }
        loop {
            match s.recv() {
                Ok(Incoming::Msg(Msg::PutMeeting { meeting, files })) => {
                    let id = meeting["id"].as_str().unwrap_or_default().to_owned();
                    let r = Receiving::new(dest.join(&id), files)?;
                    s.send(&Msg::Have { meeting_id: id.clone(), files: r.progress() })?;
                    while !r.finish()? {
                        let Incoming::Chunk { name, offset, data, .. } = s.recv()? else { anyhow::bail!("expected a chunk") };
                        r.write(&name, offset, &data)?;
                    }
                    s.send(&Msg::Stored { meeting_id: id.clone() })?;
                    eprintln!("stored {id} «{}» in {}", meeting["title"].as_str().unwrap_or(""), dest.join(&id).display());
                    received.push(meeting);
                }
                Ok(Incoming::Msg(Msg::GetResults { since, .. })) => {
                    for m in &received {
                        revised_at += 1.0;
                        if revised_at <= since {
                            continue;
                        }
                        let mut back = m.clone();
                        back["title"] = json!(format!("{} (revisada)", m["title"].as_str().unwrap_or("")));
                        // A cover as the computer's language model writes it (app/src/lib/types.ts).
                        back["cover"] = json!({
                            "generatedAt": 0,
                            "excerpt": "L'equip tanca el calendari: la web nova es publica el dimarts 18 al matí, amb els preus i els textos en anglès acabats abans.",
                            "tone": { "label": "constructive", "reason": "Tothom proposa solucions." },
                            "summary": ["La portada ja està acabada.", "Falten els preus definitius i els textos en anglès.", "Es publica el dimarts 18 al matí."],
                            "decisions": [{ "text": "Es publica el dimarts 18 al matí.", "t": 26.0 }, { "text": "Els preus es tanquen dilluns amb direcció.", "t": 18.0 }],
                            "tasks": [{ "text": "Canviar l'adreça del formulari", "owner": "Marta", "when": null, "t": 12.0, "done": true },
                                      { "text": "Anunci a les xarxes", "owner": "Laia", "when": "divendres", "t": 30.0 }],
                            "parts": [{ "t": 0.0, "title": "El calendari", "points": ["Data de publicació", "Què falta"] }, { "t": 30.0, "title": "Els preus", "points": ["Es tanquen dilluns"] }],
                        });
                        s.send(&Msg::Results { meeting: back, revised_at, computer: false })?;
                    }
                    received.clear();
                    s.send(&Msg::Bye)?;
                }
                Ok(Incoming::Msg(Msg::Bye)) | Err(_) => break,
                Ok(other) => eprintln!("unexpected {other:?}"),
            }
        }
    }
    Ok(())
}
