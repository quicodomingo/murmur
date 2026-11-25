//! Pairing and syncing a phone with the computer (docs/EMPARELLAR.md), the part both sides
//! share: the pairing code in the QR, the encrypted channel and the messages.
//!
//! - **Channel:** TCP on the local network with Noise. Pairing uses `Noise_IKpsk2`: the phone
//!   knows the computer's key from the QR, and the one-time secret in it proves the phone saw the
//!   screen. Afterwards, `Noise_IK`: both keys are known, and the computer accepts only phones it
//!   has paired. Every connection has fresh keys.
//! - **Frames:** a Noise message carries at most 65535 bytes, so each message is split into
//!   frames, each written as a 2-byte length and the ciphertext. The first frame of a message
//!   starts with the message's total length (4 bytes).
//! - **Messages:** a kind byte, then JSON (`Msg`) or a file chunk (a small JSON header and the
//!   raw bytes), so audio isn't inflated as JSON.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use snow::{Builder, HandshakeState, TransportState};

/// The protocol's version: in the QR, the Noise prologue and `Hello`.
pub const VERSION: u32 = 1;
/// The Bonjour service the computer announces while it has paired phones.
pub const SERVICE: &str = "_murmur._tcp.local.";
/// How long a pairing code shown on screen is valid.
pub const PAIRING_TTL_S: u64 = 5 * 60;
/// File chunks: small enough to resume often, big enough not to waste frames.
pub const CHUNK: usize = 256 * 1024;

const PAIR: &str = "Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s";
const CONNECT: &str = "Noise_IK_25519_ChaChaPoly_BLAKE2s";
const PROLOGUE: &[u8] = b"murmur-sync/1";
const MAX_FRAME: usize = 65535;
/// Noise's authentication tag on each frame.
const TAG: usize = 16;
/// A message bigger than this is refused: a meeting's JSON is far smaller, and files go in chunks.
const MAX_MESSAGE: usize = 64 * 1024 * 1024;
const MODE_PAIR: u8 = b'P';
const MODE_CONNECT: u8 = b'C';

/// A device's long-term X25519 keys. The private half lives in the system keychain.
#[derive(Clone)]
pub struct Keys {
    pub private: Vec<u8>,
    pub public: [u8; 32],
}

impl Keys {
    pub fn generate() -> Result<Self> {
        let pair = Builder::new(CONNECT.parse()?).generate_keypair()?;
        Ok(Self { public: pair.public.as_slice().try_into()?, private: pair.private })
    }

    pub fn from_private(private: &[u8]) -> Result<Self> {
        // X25519: the public key is the private one times the base point.
        let secret: [u8; 32] = private.try_into().map_err(|_| anyhow!("private key must be 32 bytes"))?;
        let public = x25519_public(&secret);
        Ok(Self { private: private.to_vec(), public })
    }
}

fn x25519_public(secret: &[u8; 32]) -> [u8; 32] {
    x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(*secret)).to_bytes()
}

/// What the computer's QR carries: `murmur://pair?v=1&n=…&k=…&s=…&a=…&p=…`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PairingCode {
    pub version: u32,
    /// The computer's name, shown on the phone ("MacBook de Quico").
    pub name: String,
    /// The computer's public key.
    pub key: [u8; 32],
    /// One-time secret for this pairing only.
    pub secret: [u8; 32],
    /// Local addresses, as a hint (the phone also looks with Bonjour).
    pub addrs: Vec<String>,
    pub port: u16,
}

impl PairingCode {
    pub fn to_uri(&self) -> String {
        format!(
            "murmur://pair?v={}&n={}&k={}&s={}&a={}&p={}",
            self.version,
            B64.encode(self.name.as_bytes()),
            B64.encode(self.key),
            B64.encode(self.secret),
            self.addrs.join(","),
            self.port
        )
    }

    pub fn parse(uri: &str) -> Result<Self> {
        let query = uri.strip_prefix("murmur://pair?").ok_or_else(|| anyhow!("not a Murmur pairing code"))?;
        let field = |key: &str| {
            query.split('&').find_map(|kv| kv.strip_prefix(key).and_then(|v| v.strip_prefix('='))).ok_or_else(|| anyhow!("pairing code without {key}"))
        };
        let bytes32 = |key: &str| -> Result<[u8; 32]> {
            B64.decode(field(key)?)?.try_into().map_err(|_| anyhow!("pairing code: bad {key}"))
        };
        let version: u32 = field("v")?.parse()?;
        if version != VERSION {
            bail!("pairing code version {version}, this app speaks {VERSION}");
        }
        Ok(Self {
            version,
            name: String::from_utf8(B64.decode(field("n")?)?)?,
            key: bytes32("k")?,
            secret: bytes32("s")?,
            addrs: field("a")?.split(',').filter(|a| !a.is_empty()).map(str::to_owned).collect(),
            port: field("p")?.parse()?,
        })
    }
}

/// Messages between the phone and the computer.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Msg {
    /// First message each way: who's there.
    Hello { version: u32, name: String },
    /// Phone → computer: a meeting (the database's JSON) and the files that go with it.
    PutMeeting { meeting: Value, files: Vec<FileInfo> },
    /// Computer → phone: how much of each file it already has, to start or resume.
    Have { meeting_id: String, files: Vec<FileProgress> },
    /// Computer → phone: the meeting and all its files are stored and check out.
    Stored { meeting_id: String },
    /// Phone → computer: anything revised since `since` (seconds since the epoch)? `known`, from
    /// phones that also take the computer's own meetings: the ones it has (or deleted), so that
    /// only the rest come whole. Phones before it don't send it, and get only their own.
    GetResults {
        since: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        known: Option<Vec<String>>,
    },
    /// Computer → phone: a meeting after the final pass (revised utterances, names, summary).
    /// `computer`: one recorded on the computer (or another phone), not this phone's; text only.
    Results {
        meeting: Value,
        revised_at: f64,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        computer: bool,
    },
    /// Either way: something went wrong with this meeting; it can be sent again.
    Failed { meeting_id: String, reason: String },
    /// Either way: nothing more for now.
    Bye,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    /// A plain file name: "audio.ogg", "screens/861000.jpg".
    pub name: String,
    pub size: u64,
    /// SHA-256 of the whole file, in hex.
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileProgress {
    pub name: String,
    pub have: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ChunkHeader {
    meeting_id: String,
    name: String,
    offset: u64,
}

/// One received message.
#[derive(Debug, PartialEq)]
pub enum Incoming {
    Msg(Msg),
    Chunk { meeting_id: String, name: String, offset: u64, data: Vec<u8> },
}

/// An encrypted, authenticated connection to the other device.
pub struct Session<S: Read + Write> {
    stream: S,
    noise: TransportState,
    /// The other device's public key.
    pub remote: [u8; 32],
    /// The other device's name, from its `Hello`.
    pub remote_name: String,
    buf: Vec<u8>,
}

fn write_frame(stream: &mut impl Write, frame: &[u8]) -> Result<()> {
    stream.write_all(&(frame.len() as u16).to_be_bytes())?;
    stream.write_all(frame)?;
    Ok(())
}

fn read_frame(stream: &mut impl Read) -> Result<Vec<u8>> {
    let mut len = [0u8; 2];
    stream.read_exact(&mut len)?;
    let mut frame = vec![0u8; u16::from_be_bytes(len) as usize];
    stream.read_exact(&mut frame)?;
    Ok(frame)
}

fn handshake_out(hs: &mut HandshakeState, stream: &mut impl Write, payload: &[u8]) -> Result<()> {
    let mut out = vec![0u8; MAX_FRAME];
    let n = hs.write_message(payload, &mut out)?;
    write_frame(stream, &out[..n])
}

fn handshake_in(hs: &mut HandshakeState, stream: &mut impl Read) -> Result<Vec<u8>> {
    let frame = read_frame(stream)?;
    let mut out = vec![0u8; MAX_FRAME];
    let n = hs.read_message(&frame, &mut out).context("the other device isn't the one expected")?;
    Ok(out[..n].to_vec())
}

fn remote_key(hs: &HandshakeState) -> Result<[u8; 32]> {
    hs.get_remote_static().ok_or_else(|| anyhow!("no remote key"))?.try_into().map_err(|_| anyhow!("bad remote key"))
}

/// Phone: pairs with the computer in `code`, over `stream`.
pub fn pair<S: Read + Write>(mut stream: S, keys: &Keys, code: &PairingCode, name: &str) -> Result<Session<S>> {
    let mut hs = Builder::new(PAIR.parse()?)
        .local_private_key(&keys.private)
        .remote_public_key(&code.key)
        .psk(2, &code.secret)
        .prologue(PROLOGUE)
        .build_initiator()?;
    stream.write_all(&[MODE_PAIR])?;
    handshake_out(&mut hs, &mut stream, &[])?;
    handshake_in(&mut hs, &mut stream)?;
    Session::new(stream, hs)?.greet_first(name)
}

/// Phone: connects to a computer it's already paired with.
pub fn connect<S: Read + Write>(mut stream: S, keys: &Keys, computer: &[u8; 32], name: &str) -> Result<Session<S>> {
    let mut hs = Builder::new(CONNECT.parse()?)
        .local_private_key(&keys.private)
        .remote_public_key(computer)
        .prologue(PROLOGUE)
        .build_initiator()?;
    stream.write_all(&[MODE_CONNECT])?;
    handshake_out(&mut hs, &mut stream, &[])?;
    handshake_in(&mut hs, &mut stream)?;
    Session::new(stream, hs)?.greet_first(name)
}

/// What the computer accepts on an incoming connection.
pub struct Accept<'a> {
    /// The secret of the pairing code on screen, if one is.
    pub pairing_secret: Option<&'a [u8; 32]>,
    /// The phones already paired.
    pub paired: &'a [[u8; 32]],
}

/// How a phone came in.
#[derive(Debug, PartialEq, Eq)]
pub enum Arrival {
    /// With the code on screen: a new phone, to remember.
    Paired,
    /// A phone already paired.
    Known,
}

/// Computer: answers a phone. Refuses phones it doesn't know, unless they bring the code on
/// screen. Returns once the phone's `Hello` has arrived: in pairing, that's what proves it had the
/// secret, so only then is it safe to remember the phone.
pub fn accept<S: Read + Write>(mut stream: S, keys: &Keys, rules: &Accept, name: &str) -> Result<(Session<S>, Arrival)> {
    let mut mode = [0u8; 1];
    stream.read_exact(&mut mode)?;
    let (mut hs, arrival) = match mode[0] {
        MODE_PAIR => {
            let secret = rules.pairing_secret.ok_or_else(|| anyhow!("no pairing code on screen"))?;
            let hs = Builder::new(PAIR.parse()?).local_private_key(&keys.private).psk(2, secret).prologue(PROLOGUE).build_responder()?;
            (hs, Arrival::Paired)
        }
        MODE_CONNECT => (Builder::new(CONNECT.parse()?).local_private_key(&keys.private).prologue(PROLOGUE).build_responder()?, Arrival::Known),
        _ => bail!("not a Murmur phone"),
    };
    handshake_in(&mut hs, &mut stream)?;
    let remote = remote_key(&hs)?;
    if arrival == Arrival::Known && !rules.paired.contains(&remote) {
        bail!("this phone isn't paired");
    }
    handshake_out(&mut hs, &mut stream, &[])?;
    let mut session = Session::new(stream, hs)?;
    // In pairing, the secret is only checked here: a phone without it can't encrypt its Hello.
    session.remote_name = session.expect_hello().context("the phone didn't bring the right code")?;
    session.send(&Msg::Hello { version: VERSION, name: name.into() })?;
    Ok((session, arrival))
}

impl<S: Read + Write> Session<S> {
    fn new(stream: S, hs: HandshakeState) -> Result<Self> {
        let remote = remote_key(&hs)?;
        Ok(Self { stream, noise: hs.into_transport_mode()?, remote, remote_name: String::new(), buf: vec![0u8; MAX_FRAME] })
    }

    fn expect_hello(&mut self) -> Result<String> {
        match self.recv_msg()? {
            Msg::Hello { version, name } if version == VERSION => Ok(name),
            Msg::Hello { version, .. } => bail!("the other device speaks version {version}, this one {VERSION}"),
            other => bail!("expected Hello, got {other:?}"),
        }
    }

    /// The phone's side: says hello first, then hears the computer's.
    fn greet_first(mut self, name: &str) -> Result<Self> {
        self.send(&Msg::Hello { version: VERSION, name: name.into() })?;
        self.remote_name = self.expect_hello()?;
        Ok(self)
    }

    fn send_bytes(&mut self, kind: u8, body: &[u8]) -> Result<()> {
        let total = 1 + body.len();
        let mut message = Vec::with_capacity(4 + total);
        message.extend_from_slice(&(total as u32).to_be_bytes());
        message.push(kind);
        message.extend_from_slice(body);
        for piece in message.chunks(MAX_FRAME - TAG) {
            let n = self.noise.write_message(piece, &mut self.buf)?;
            let frame = self.buf[..n].to_vec();
            write_frame(&mut self.stream, &frame)?;
        }
        self.stream.flush()?;
        Ok(())
    }

    fn recv_bytes(&mut self) -> Result<Vec<u8>> {
        let mut message = vec![];
        let mut total = None;
        loop {
            let frame = read_frame(&mut self.stream)?;
            let n = self.noise.read_message(&frame, &mut self.buf)?;
            message.extend_from_slice(&self.buf[..n]);
            if total.is_none() && message.len() >= 4 {
                let t = u32::from_be_bytes(message[..4].try_into()?) as usize;
                if t > MAX_MESSAGE {
                    bail!("message too big ({t} bytes)");
                }
                total = Some(t);
            }
            if let Some(t) = total {
                if message.len() >= 4 + t {
                    message.drain(..4);
                    message.truncate(t);
                    return Ok(message);
                }
            }
        }
    }

    pub fn send(&mut self, msg: &Msg) -> Result<()> {
        self.send_bytes(0, &serde_json::to_vec(msg)?)
    }

    pub fn send_chunk(&mut self, meeting_id: &str, name: &str, offset: u64, data: &[u8]) -> Result<()> {
        let header = serde_json::to_vec(&ChunkHeader { meeting_id: meeting_id.into(), name: name.into(), offset })?;
        let mut body = Vec::with_capacity(2 + header.len() + data.len());
        body.extend_from_slice(&(header.len() as u16).to_be_bytes());
        body.extend_from_slice(&header);
        body.extend_from_slice(data);
        self.send_bytes(1, &body)
    }

    pub fn recv(&mut self) -> Result<Incoming> {
        let message = self.recv_bytes()?;
        let (kind, body) = message.split_first().ok_or_else(|| anyhow!("empty message"))?;
        match kind {
            0 => Ok(Incoming::Msg(serde_json::from_slice(body)?)),
            1 => {
                let len = u16::from_be_bytes(body.get(..2).ok_or_else(|| anyhow!("short chunk"))?.try_into()?) as usize;
                let header: ChunkHeader = serde_json::from_slice(body.get(2..2 + len).ok_or_else(|| anyhow!("short chunk"))?)?;
                Ok(Incoming::Chunk { meeting_id: header.meeting_id, name: header.name, offset: header.offset, data: body[2 + len..].to_vec() })
            }
            k => bail!("unknown message kind {k}"),
        }
    }

    /// The next message, which has to be a `Msg`.
    pub fn recv_msg(&mut self) -> Result<Msg> {
        match self.recv()? {
            Incoming::Msg(m) => Ok(m),
            Incoming::Chunk { .. } => bail!("expected a message, got a file chunk"),
        }
    }
}

/// SHA-256 of a file, in hex.
pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// A file name the other side sent is only ever a plain relative path inside the meeting's folder.
pub fn safe_name(name: &str) -> Result<&str> {
    let path = Path::new(name);
    if name.is_empty() || path.is_absolute() || path.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        bail!("bad file name: {name}");
    }
    Ok(name)
}

/// Phone: what to tell the computer about a file to send.
pub fn file_info(name: &str, path: &Path) -> Result<FileInfo> {
    Ok(FileInfo { name: safe_name(name)?.into(), size: std::fs::metadata(path)?.len(), sha256: sha256_file(path)? })
}

/// Phone: sends `path` from where the computer says it has it up to.
pub fn send_file<S: Read + Write>(session: &mut Session<S>, meeting_id: &str, name: &str, path: &Path, from: u64) -> Result<()> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(from))?;
    let mut offset = from;
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            return Ok(());
        }
        session.send_chunk(meeting_id, name, offset, &buf[..n])?;
        offset += n as u64;
    }
}

/// Computer: a meeting's files as they arrive, in `dir`, each as `<name>.part` until it's whole
/// and its SHA-256 checks out. What's there survives a cut connection, to resume.
pub struct Receiving {
    pub dir: PathBuf,
    pub files: Vec<FileInfo>,
}

impl Receiving {
    pub fn new(dir: PathBuf, files: Vec<FileInfo>) -> Result<Self> {
        for f in &files {
            safe_name(&f.name)?;
        }
        std::fs::create_dir_all(&dir)?;
        Ok(Self { dir, files })
    }

    fn part(&self, name: &str) -> PathBuf {
        self.dir.join(format!("{name}.part"))
    }

    /// How much of each file is already here (a finished file counts as whole).
    pub fn progress(&self) -> Vec<FileProgress> {
        self.files
            .iter()
            .map(|f| {
                let have = if self.dir.join(&f.name).exists() { f.size } else { std::fs::metadata(self.part(&f.name)).map(|m| m.len()).unwrap_or(0) };
                FileProgress { name: f.name.clone(), have: have.min(f.size) }
            })
            .collect()
    }

    /// Writes a chunk. A chunk that doesn't continue the file exactly is refused.
    pub fn write(&self, name: &str, offset: u64, data: &[u8]) -> Result<()> {
        let info = self.files.iter().find(|f| f.name == name).ok_or_else(|| anyhow!("unexpected file {name}"))?;
        let part = self.part(name);
        if let Some(parent) = part.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        if offset != have || offset + data.len() as u64 > info.size {
            bail!("chunk of {name} at {offset} doesn't follow ({have} of {} here)", info.size);
        }
        OpenOptions::new().create(true).append(true).open(&part)?.write_all(data)?;
        Ok(())
    }

    /// True when every file is whole and checks out (and has its final name). A whole file whose
    /// checksum fails is thrown away, to be sent again.
    pub fn finish(&self) -> Result<bool> {
        let mut done = true;
        for f in &self.files {
            let fin = self.dir.join(&f.name);
            if fin.exists() {
                continue;
            }
            let part = self.part(&f.name);
            let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
            if have < f.size {
                done = false;
                continue;
            }
            if sha256_file(&part)? != f.sha256 {
                std::fs::remove_file(&part)?;
                bail!("{} arrived damaged; it will be sent again", f.name);
            }
            std::fs::rename(&part, &fin)?;
        }
        Ok(done)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{TcpListener, TcpStream};

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("murmur-sync-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn code(computer: &Keys, secret: [u8; 32], port: u16) -> PairingCode {
        PairingCode { version: VERSION, name: "MacBook de Quico".into(), key: computer.public, secret, addrs: vec!["127.0.0.1".into()], port }
    }

    #[test]
    fn the_pairing_code_goes_through_the_qr_and_back() {
        let keys = Keys::generate().unwrap();
        let c = PairingCode { addrs: vec!["192.168.1.20".into(), "fe80::1".into()], ..code(&keys, [7; 32], 50123) };
        assert_eq!(PairingCode::parse(&c.to_uri()).unwrap(), c);
        assert!(PairingCode::parse("https://example.com").is_err());
        assert!(PairingCode::parse(&c.to_uri().replace("v=1", "v=9")).is_err());
    }

    #[test]
    fn keys_rebuild_from_the_private_half() {
        let keys = Keys::generate().unwrap();
        assert_eq!(Keys::from_private(&keys.private).unwrap().public, keys.public);
    }

    /// Runs the computer's side on a thread and returns what it ended with.
    fn computer<T: Send + 'static>(keys: Keys, secret: Option<[u8; 32]>, paired: Vec<[u8; 32]>, then: impl FnOnce(Session<TcpStream>, Arrival) -> T + Send + 'static) -> (u16, std::thread::JoinHandle<Result<T>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (stream, _) = listener.accept()?;
            let (session, arrival) = accept(stream, &keys, &Accept { pairing_secret: secret.as_ref(), paired: &paired }, "MacBook de Quico")?;
            Ok(then(session, arrival))
        });
        (port, handle)
    }

    #[test]
    fn a_phone_pairs_with_the_code_then_reconnects_with_its_key() {
        let (pc, phone) = (Keys::generate().unwrap(), Keys::generate().unwrap());
        let secret = [42u8; 32];
        let (port, handle) = computer(pc.clone(), Some(secret), vec![], |s, arrival| (s.remote, s.remote_name.clone(), arrival));
        let s = pair(TcpStream::connect(("127.0.0.1", port)).unwrap(), &phone, &code(&pc, secret, port), "iPhone de Quico").unwrap();
        assert_eq!((s.remote, s.remote_name.as_str()), (pc.public, "MacBook de Quico"));
        let (remembered, name, arrival) = handle.join().unwrap().unwrap();
        assert_eq!((remembered, name.as_str(), arrival), (phone.public, "iPhone de Quico", Arrival::Paired));

        // Later, without a code on screen: the computer knows this phone.
        let (port, handle) = computer(pc.clone(), None, vec![phone.public], |mut s, arrival| (s.recv_msg().unwrap(), arrival));
        let mut s = connect(TcpStream::connect(("127.0.0.1", port)).unwrap(), &phone, &pc.public, "iPhone de Quico").unwrap();
        s.send(&Msg::Bye).unwrap();
        assert_eq!(handle.join().unwrap().unwrap(), (Msg::Bye, Arrival::Known));
    }

    #[test]
    fn strangers_are_turned_away() {
        let (pc, phone, other) = (Keys::generate().unwrap(), Keys::generate().unwrap(), Keys::generate().unwrap());
        // A phone that isn't paired.
        let (port, handle) = computer(pc.clone(), None, vec![phone.public], |_, _| ());
        let _ = connect(TcpStream::connect(("127.0.0.1", port)).unwrap(), &other, &pc.public, "Un altre");
        assert!(handle.join().unwrap().is_err());
        // A wrong pairing secret (an old QR, or a guess): neither side gets a session, and the
        // computer never gets to remember the phone.
        let (port, handle) = computer(pc.clone(), Some([1; 32]), vec![], |_, _| ());
        assert!(pair(TcpStream::connect(("127.0.0.1", port)).unwrap(), &phone, &code(&pc, [2; 32], port), "iPhone").is_err());
        assert!(handle.join().unwrap().is_err());
        // Pairing when no code is on screen.
        let (port, handle) = computer(pc.clone(), None, vec![], |_, _| ());
        let _ = pair(TcpStream::connect(("127.0.0.1", port)).unwrap(), &phone, &code(&pc, [1; 32], port), "iPhone");
        assert!(handle.join().unwrap().is_err());
        // A computer that isn't the one in the QR.
        let (port, handle) = computer(other.clone(), Some([1; 32]), vec![], |_, _| ());
        assert!(pair(TcpStream::connect(("127.0.0.1", port)).unwrap(), &phone, &code(&pc, [1; 32], port), "iPhone").is_err());
        let _ = handle.join();
    }

    #[test]
    fn a_meeting_and_its_audio_arrive_and_resume_after_a_cut() {
        let src = temp("src");
        let audio = src.join("audio.ogg");
        let bytes: Vec<u8> = (0..(CHUNK * 2 + 1234)).map(|i| (i * 31 % 251) as u8).collect();
        std::fs::write(&audio, &bytes).unwrap();
        let info = file_info("audio.ogg", &audio).unwrap();
        let meeting = serde_json::json!({ "id": "m1", "title": "Revisió del pressupost" });
        let dest = temp("dest");

        // First try: the phone sends one chunk and the connection drops.
        let receiving = Receiving::new(dest.clone(), vec![info.clone()]).unwrap();
        receiving.write("audio.ogg", 0, &bytes[..CHUNK]).unwrap();
        assert_eq!(receiving.progress(), vec![FileProgress { name: "audio.ogg".into(), have: CHUNK as u64 }]);
        // A chunk that skips ahead is refused.
        assert!(receiving.write("audio.ogg", (CHUNK * 2) as u64, &bytes[CHUNK * 2..]).is_err());

        // Second try, over the wire: it carries on from what's there.
        let (pc, phone) = (Keys::generate().unwrap(), Keys::generate().unwrap());
        let dest2 = dest.clone();
        let (port, handle) = computer(pc.clone(), None, vec![phone.public], move |mut s, _| {
            let Msg::PutMeeting { meeting, files } = s.recv_msg().unwrap() else { panic!() };
            let r = Receiving::new(dest2, files).unwrap();
            s.send(&Msg::Have { meeting_id: "m1".into(), files: r.progress() }).unwrap();
            while !r.finish().unwrap() {
                let Incoming::Chunk { name, offset, data, .. } = s.recv().unwrap() else { panic!() };
                r.write(&name, offset, &data).unwrap();
            }
            s.send(&Msg::Stored { meeting_id: "m1".into() }).unwrap();
            meeting
        });
        let mut s = connect(TcpStream::connect(("127.0.0.1", port)).unwrap(), &phone, &pc.public, "iPhone de Quico").unwrap();
        s.send(&Msg::PutMeeting { meeting: meeting.clone(), files: vec![info] }).unwrap();
        let Msg::Have { files, .. } = s.recv_msg().unwrap() else { panic!() };
        assert_eq!(files[0].have, CHUNK as u64);
        send_file(&mut s, "m1", "audio.ogg", &audio, files[0].have).unwrap();
        assert_eq!(s.recv_msg().unwrap(), Msg::Stored { meeting_id: "m1".into() });
        assert_eq!(handle.join().unwrap().unwrap(), meeting);
        assert_eq!(std::fs::read(dest.join("audio.ogg")).unwrap(), bytes);
        assert!(!dest.join("audio.ogg.part").exists());
        let _ = std::fs::remove_dir_all(&src);
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn a_damaged_file_is_thrown_away_and_names_stay_inside() {
        let dest = temp("damaged");
        let info = FileInfo { name: "screens/861000.jpg".into(), size: 3, sha256: "00".repeat(32) };
        let r = Receiving::new(dest.clone(), vec![info]).unwrap();
        r.write("screens/861000.jpg", 0, b"abc").unwrap();
        assert!(r.finish().is_err());
        assert_eq!(r.progress()[0].have, 0);
        for bad in ["../x", "/etc/passwd", "a/../../b", ""] {
            assert!(safe_name(bad).is_err(), "{bad}");
        }
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn big_messages_cross_frame_boundaries() {
        let (pc, phone) = (Keys::generate().unwrap(), Keys::generate().unwrap());
        let text: String = "Hem passat de dotze a quinze mil. ".repeat(10_000);
        let (port, handle) = computer(pc.clone(), None, vec![phone.public], |mut s, _| s.recv_msg().unwrap());
        let mut s = connect(TcpStream::connect(("127.0.0.1", port)).unwrap(), &phone, &pc.public, "iPhone de Quico").unwrap();
        let msg = Msg::PutMeeting { meeting: serde_json::json!({ "id": "m2", "notes": text }), files: vec![] };
        s.send(&msg).unwrap();
        assert_eq!(handle.join().unwrap().unwrap(), msg);
    }

    #[test]
    fn phones_and_computers_of_either_version_understand_each_other() {
        // A phone from before asks without `known`; a computer from before ignores it.
        let old: Msg = serde_json::from_str(r#"{"type":"getResults","since":5.0}"#).unwrap();
        assert_eq!(old, Msg::GetResults { since: 5.0, known: None });
        let new = serde_json::to_value(Msg::GetResults { since: 5.0, known: Some(vec!["m1".into()]) }).unwrap();
        assert_eq!(new["known"], serde_json::json!(["m1"]));
        // A phone's own meeting goes back as before; the computer's says so.
        let own = serde_json::to_value(Msg::Results { meeting: serde_json::json!({}), revised_at: 1.0, computer: false }).unwrap();
        assert!(own.get("computer").is_none());
        let theirs: Msg = serde_json::from_str(r#"{"type":"results","meeting":{},"revisedAt":1.0,"computer":true}"#).unwrap();
        assert!(matches!(theirs, Msg::Results { computer: true, .. }));
    }
}
