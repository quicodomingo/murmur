//! Downloadable models. The transcription model is required (the first-run screens fetch it);
//! punctuation (126 MB) and the language model for the cover (5.2 GB) are optional, downloaded
//! only when the user turns their feature on and deletable from the settings.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

pub struct ModelFile {
    /// Path inside the model's folder.
    pub name: &'static str,
    /// None: not published yet (only usable when copied into the models folder by hand).
    pub url: Option<&'static str>,
    pub bytes: u64,
    /// Checked after every download, so a broken or tampered file is never used.
    pub sha256: &'static str,
}

pub struct OptionalModel {
    pub id: &'static str,
    /// Folder inside the models directory ("" for files shared at its top level).
    pub dir: &'static str,
    pub files: &'static [ModelFile],
    /// Murmur can't transcribe without it: it can't be deleted from the settings.
    pub required: bool,
}

/// Our export of the AINA Conformer for sherpa-onnx (tools/export_conformer_sherpa.py), published
/// with its CC BY 4.0 licence at huggingface.co/quicodomingo/murmur-models.
const CONFORMER_URL_ENCODER: &str = "https://huggingface.co/quicodomingo/murmur-models/resolve/main/conformer-ca-es-sherpa/encoder.onnx";
const CONFORMER_URL_DECODER: &str = "https://huggingface.co/quicodomingo/murmur-models/resolve/main/conformer-ca-es-sherpa/decoder.onnx";
const CONFORMER_URL_JOINER: &str = "https://huggingface.co/quicodomingo/murmur-models/resolve/main/conformer-ca-es-sherpa/joiner.onnx";
const CONFORMER_URL_TOKENS: &str = "https://huggingface.co/quicodomingo/murmur-models/resolve/main/conformer-ca-es-sherpa/tokens.txt";

/// Live and final transcription: the AINA Conformer, voice activity and speakers.
pub const TRANSCRIPTION: OptionalModel = OptionalModel {
    id: "transcription",
    dir: "",
    required: true,
    files: &[
        ModelFile { name: "conformer-ca-es-sherpa/encoder.onnx", url: Some(CONFORMER_URL_ENCODER), bytes: 481_422_175, sha256: "bfefe0f94e247475eb5c023a753c1e074b29419f3a441180d9b0b5aeaa5c9590" },
        ModelFile { name: "conformer-ca-es-sherpa/decoder.onnx", url: Some(CONFORMER_URL_DECODER), bytes: 13_787_005, sha256: "cc38a51494333377c3e7b1a7efdf251913a04e93a43d66b8cd12d4858ba78a58" },
        ModelFile { name: "conformer-ca-es-sherpa/joiner.onnx", url: Some(CONFORMER_URL_JOINER), bytes: 3_614_881, sha256: "c168756f6e8a4a5f5677444e8c194e494f697c6a8668133c1d753cb499f445f7" },
        ModelFile { name: "conformer-ca-es-sherpa/tokens.txt", url: Some(CONFORMER_URL_TOKENS), bytes: 1_955, sha256: "0451223f8209d957022aa856857a470731b2dbbcf2ea39e83dee2f298d45682c" },
        ModelFile {
            name: "silero_vad.onnx",
            url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"),
            bytes: 643_854,
            sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
        },
        ModelFile {
            name: "nemo_en_titanet_small.onnx",
            url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx"),
            bytes: 40_257_283,
            sha256: "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e",
        },
        ModelFile {
            name: "3dspeaker_eres2net_base.onnx",
            url: Some(
                "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
            ),
            bytes: 39_593_761,
            sha256: "1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b",
        },
        ModelFile {
            name: "sherpa-onnx-pyannote-segmentation-3-0/model.onnx",
            url: Some("https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx"),
            bytes: 5_992_913,
            sha256: "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079",
        },
    ],
};

pub const PUNCTUATION: OptionalModel = OptionalModel {
    id: "punctuation",
    dir: "punct-ca",
    required: false,
    // Converted with tools/export_punctuation.py. Kept in a private repo (quicodomingo/murmur-punctuation)
    // until Softcatalà confirms its licence, so the app can't download it yet.
    files: &[
        ModelFile { name: "model.int8.onnx", url: None, bytes: 126_172_226, sha256: "5485384fd69e3d5b7f260c6779bf857c8f82d222e3582f15240bbe5a3a8257ca" },
        ModelFile { name: "tokenizer.json", url: None, bytes: 2_296_937, sha256: "e986e7d59bd59b4a712a312548eb7cc450c40696f9f4bc1d88f7bba7cacb7b4b" },
    ],
};

pub const LLM: OptionalModel = OptionalModel {
    id: "llm",
    dir: "llm",
    required: false,
    files: &[ModelFile {
        name: "gemma-4-E4B_q4_0-it.gguf",
        url: Some(
            "https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/main/gemma-4-E4B_q4_0-it.gguf",
        ),
        bytes: 5_154_941_280,
        sha256: "676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee",
    }],
};

/// Live transcription of meetings in English: NVIDIA Parakeet TDT-CTC 110M (CC BY 4.0), its CTC
/// head exported by sherpa-onnx. Writes punctuation and capitals itself.
pub const ENGLISH: OptionalModel = OptionalModel {
    id: "english",
    dir: "parakeet-en",
    required: false,
    files: &[
        ModelFile {
            name: "model.onnx",
            url: Some("https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000/resolve/main/model.onnx"),
            bytes: 458_161_021,
            sha256: "936806cf3dd0db5aba53f8c7410bb5632d7a8ad6b2c51009f5e4fc0890ec76bf",
        },
        ModelFile {
            name: "tokens.txt",
            url: Some("https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000/resolve/main/tokens.txt"),
            bytes: 9_953,
            sha256: "450e56bd2f036fe5b6aa821865838cc5aa9d8b0106134ce9a9ba0664abe6cd10",
        },
    ],
};

/// Final pass of single-language meetings (Catalan, Spanish or English): OpenAI Whisper
/// large-v3-turbo (MIT) for whisper.cpp, 5-bit (run by the murmur-whisper sidecar).
pub const WHISPER: OptionalModel = OptionalModel {
    id: "whisper",
    dir: "whisper-ggml",
    required: false,
    files: &[ModelFile {
        name: "ggml-large-v3-turbo-q5_0.bin",
        url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin"),
        bytes: 574_041_195,
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    }],
};

pub const ALL: [&OptionalModel; 5] = [&TRANSCRIPTION, &PUNCTUATION, &LLM, &ENGLISH, &WHISPER];

pub fn find(id: &str) -> Result<&'static OptionalModel> {
    ALL.into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| anyhow!("Model desconegut: {id}"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub id: &'static str,
    pub installed: bool,
    /// Total size once downloaded.
    pub bytes: u64,
    /// Already on disk (finished files plus a partial download).
    pub downloaded: u64,
    pub downloadable: bool,
    pub required: bool,
}

impl OptionalModel {
    pub fn path(&self, root: &Path) -> PathBuf {
        root.join(self.dir)
    }

    pub fn file(&self, root: &Path, index: usize) -> PathBuf {
        self.path(root).join(self.files[index].name)
    }

    pub fn installed(&self, root: &Path) -> bool {
        (0..self.files.len()).all(|i| self.file(root, i).is_file())
    }

    pub fn status(&self, root: &Path) -> Status {
        let downloaded = (0..self.files.len())
            .map(|i| {
                let path = self.file(root, i);
                fs::metadata(&path)
                    .or_else(|_| fs::metadata(part(&path)))
                    .map(|m| m.len())
                    .unwrap_or(0)
            })
            .sum();
        Status {
            id: self.id,
            installed: self.installed(root),
            bytes: self.files.iter().map(|f| f.bytes).sum(),
            downloaded,
            // Files already on disk don't need a URL.
            downloadable: (0..self.files.len()).all(|i| self.files[i].url.is_some() || self.file(root, i).is_file()),
            required: self.required,
        }
    }

    /// Downloads the missing files, resuming partial ones. `progress(done, total)` is called a
    /// few times per second; setting `cancel` stops it and keeps the partial file for later.
    pub fn download(&self, root: &Path, cancel: &AtomicBool, progress: impl FnMut(u64, u64)) -> Result<()> {
        let mut items = vec![];
        for (i, file) in self.files.iter().enumerate() {
            let target = self.file(root, i);
            let url = match file.url {
                Some(url) => url.to_string(),
                None if target.is_file() => continue,
                None => return Err(anyhow!("Aquest model encara no es pot descarregar")),
            };
            items.push(Fetch { target, url, bytes: file.bytes, sha256: file.sha256.to_string() });
        }
        fetch_all(&items, cancel, progress)
    }

    /// Installs a newer version from the catalog: the new files are downloaded and checked in a
    /// folder of their own, and only then replace the old ones (a broken download never leaves
    /// Murmur without a model).
    pub fn update(&self, root: &Path, next: &CatalogModel, cancel: &AtomicBool, progress: impl FnMut(u64, u64)) -> Result<()> {
        let staging = root.join(".updates").join(self.id);
        let items: Vec<Fetch> = next
            .files
            .iter()
            .map(|f| {
                if !self.files.iter().any(|known| known.name == f.name) {
                    return Err(anyhow!("El catàleg porta un fitxer que aquesta versió de Murmur no coneix: {}", f.name));
                }
                Ok(Fetch { target: staging.join(&f.name), url: f.url.clone(), bytes: f.bytes, sha256: f.sha256.clone() })
            })
            .collect::<Result<_>>()?;
        fetch_all(&items, cancel, progress)?;
        for f in &next.files {
            let target = self.path(root).join(&f.name);
            if let Some(dir) = target.parent() {
                fs::create_dir_all(dir)?;
            }
            fs::rename(staging.join(&f.name), &target).with_context(|| format!("No s'ha pogut instal·lar {}", f.name))?;
        }
        let _ = fs::remove_dir_all(&staging);
        set_installed_version(root, self.id, next.version)
    }

    /// Removes the model's files, partial downloads included.
    pub fn delete(&self, root: &Path) -> Result<()> {
        for i in 0..self.files.len() {
            let path = self.file(root, i);
            for p in [part(&path), path] {
                if p.exists() {
                    fs::remove_file(&p)
                        .with_context(|| format!("No s'ha pogut esborrar {}", p.display()))?;
                }
            }
        }
        // Their folders too, if nothing else is left in them.
        for i in 0..self.files.len() {
            if let Some(dir) = self.file(root, i).parent().filter(|d| *d != root) {
                let _ = fs::remove_dir(dir);
            }
        }
        Ok(())
    }
}

/// One file to download: where it goes, from where, its size and its SHA-256.
struct Fetch {
    target: PathBuf,
    url: String,
    bytes: u64,
    sha256: String,
}

/// Downloads every file not already in place, resuming partial ones, after checking there's room
/// for them; each one is verified (size and SHA-256) before taking its final name.
fn fetch_all(items: &[Fetch], cancel: &AtomicBool, mut progress: impl FnMut(u64, u64)) -> Result<()> {
    let total: u64 = items.iter().map(|f| f.bytes).sum();
    let pending: Vec<&Fetch> = items.iter().filter(|f| !f.target.is_file()).collect();
    let missing: u64 = pending
        .iter()
        .map(|f| f.bytes.saturating_sub(fs::metadata(part(&f.target)).map(|m| m.len()).unwrap_or(0)))
        .sum();
    if let Some(first) = pending.first() {
        let dir = first.target.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(dir)?;
        // Room for the files plus a margin, so the Mac isn't left with a full disk.
        let margin = 500_000_000;
        if let Some(free) = free_space(dir) {
            if free < missing + margin {
                return Err(anyhow!(
                    "No hi ha prou espai al disc: calen {:.1} GB i n'hi ha {:.1} GB lliures",
                    (missing + margin) as f64 / 1e9,
                    free as f64 / 1e9
                ));
            }
        }
    }
    let mut done_before: u64 = items.iter().filter(|f| f.target.is_file()).map(|f| f.bytes).sum();
    for file in pending {
        if let Some(dir) = file.target.parent() {
            fs::create_dir_all(dir)?;
        }
        let partial = part(&file.target);
        let mut have = fs::metadata(&partial).map(|m| m.len()).unwrap_or(0);
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(20))
            .timeout_read(Duration::from_secs(60))
            .build();
        let mut request = agent.get(&file.url);
        if have > 0 {
            request = request.set("Range", &format!("bytes={have}-"));
        }
        let response = request.call().map_err(|e| match e {
            ureq::Error::Status(code, _) => anyhow!("El servidor ha respost {code}"),
            e => anyhow!("No s'ha pogut connectar: {e}"),
        })?;
        // 206: resumed; 200: the server sends everything again.
        if response.status() != 206 {
            have = 0;
        }
        let mut out = OpenOptions::new()
            .create(true)
            .write(true)
            .append(have > 0)
            .truncate(have == 0)
            .open(&partial)
            .context("No s'ha pogut escriure el model")?;
        let mut reader = response.into_reader();
        let mut buf = vec![0u8; 1 << 16];
        let mut last = Instant::now();
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(anyhow!("cancel·lat"));
            }
            let n = reader.read(&mut buf).context("La descàrrega s'ha interromput")?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])?;
            have += n as u64;
            if last.elapsed() > Duration::from_millis(250) {
                last = Instant::now();
                progress(done_before + have, total);
            }
        }
        out.flush()?;
        drop(out);
        if have != file.bytes {
            return Err(anyhow!("Descàrrega incompleta ({have} de {} bytes)", file.bytes));
        }
        if sha256_of(&partial)? != file.sha256 {
            // Start over next time: resuming a corrupt file would never fix it.
            let _ = fs::remove_file(&partial);
            return Err(anyhow!("El fitxer descarregat no és correcte (la suma de comprovació no coincideix). Torna-ho a provar."));
        }
        fs::rename(&partial, &file.target)?;
        done_before += file.bytes;
        progress(done_before, total);
    }
    Ok(())
}

fn sha256_of(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Bytes free for this user on the disk holding `dir`.
fn free_space(dir: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    (unsafe { libc::statvfs(path.as_ptr(), &mut stat) } == 0).then(|| stat.f_bavail as u64 * stat.f_frsize as u64)
}

// --- Catalog of model updates ----------------------------------------------------------------

/// What the newest models are: published next to the app's releases. A model update replaces the
/// files of a model with new ones of the same names; anything that needs new code comes with a
/// new version of the app (`minApp`).
pub const CATALOG_URL: &str = "https://raw.githubusercontent.com/quicodomingo/murmur-releases/main/models.json";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFile {
    pub name: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModel {
    pub version: u32,
    /// Oldest version of Murmur that can use it.
    #[serde(default)]
    pub min_app: Option<String>,
    /// One line on what's better, shown before updating.
    #[serde(default)]
    pub notes: String,
    pub files: Vec<CatalogFile>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Catalog {
    pub models: std::collections::HashMap<String, CatalogModel>,
}

pub fn fetch_catalog() -> Result<Catalog> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(20))
        .build();
    agent
        .get(CATALOG_URL)
        .call()
        .map_err(|e| anyhow!("No s'ha pogut consultar el catàleg de models: {e}"))?
        .into_json()
        .context("El catàleg de models no és vàlid")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUpdate {
    pub id: &'static str,
    pub version: u32,
    pub notes: String,
    pub bytes: u64,
}

/// Installed models with a newer version in the catalog that this app can use.
pub fn updates(root: &Path, catalog: &Catalog, app_version: &semver::Version) -> Vec<ModelUpdate> {
    ALL.into_iter()
        .filter(|m| m.installed(root))
        .filter_map(|m| {
            let next = catalog.models.get(m.id)?;
            let usable = next
                .min_app
                .as_deref()
                .and_then(|v| semver::Version::parse(v).ok())
                .is_none_or(|min| app_version >= &min);
            (usable && next.version > installed_version(root, m.id)).then(|| ModelUpdate {
                id: m.id,
                version: next.version,
                notes: next.notes.clone(),
                bytes: next.files.iter().map(|f| f.bytes).sum(),
            })
        })
        .collect()
}

/// `<models>/versions.json`: the version of each installed model (1 = the one built in).
fn versions_path(root: &Path) -> PathBuf {
    root.join("versions.json")
}

pub fn installed_version(root: &Path, id: &str) -> u32 {
    fs::read_to_string(versions_path(root))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get(id).and_then(|n| n.as_u64()))
        .map_or(1, |n| n as u32)
}

fn set_installed_version(root: &Path, id: &str, version: u32) -> Result<()> {
    let mut all = fs::read_to_string(versions_path(root))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .filter(|v| v.is_object())
        .unwrap_or_else(|| serde_json::json!({}));
    all[id] = serde_json::json!(version);
    fs::write(versions_path(root), serde_json::to_string_pretty(&all)?)?;
    Ok(())
}

fn part(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    path.with_file_name(name)
}

#[cfg(test)]
mod catalog_tests {
    use super::*;

    #[test]
    fn offers_newer_installed_models_this_app_can_use() {
        let root = std::env::temp_dir().join(format!("murmur-catalog-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        // The language model is installed; the others aren't.
        fs::create_dir_all(LLM.path(&root)).unwrap();
        fs::write(LLM.file(&root, 0), b"x").unwrap();
        let catalog: Catalog = serde_json::from_str(
            r#"{"models": {
                "llm": {"version": 2, "minApp": "0.2.0", "notes": "Millor", "files": [{"name": "gemma-4-E4B_q4_0-it.gguf", "url": "https://x", "bytes": 10, "sha256": "ab"}]},
                "transcription": {"version": 5, "files": []}
            }}"#,
        )
        .unwrap();
        let v = |s| semver::Version::parse(s).unwrap();
        let found = updates(&root, &catalog, &v("0.2.0"));
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].id, found[0].version, found[0].bytes), ("llm", 2, 10));
        // Too old an app, or already at that version: nothing.
        assert!(updates(&root, &catalog, &v("0.1.0")).is_empty());
        set_installed_version(&root, "llm", 2).unwrap();
        assert!(updates(&root, &catalog, &v("0.2.0")).is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
