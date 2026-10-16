//! Downloadable models. The transcription model is required (the first-run screens fetch it);
//! punctuation (126 MB) and the language model for the cover (5.2 GB) are optional, downloaded
//! only when the user turns their feature on and deletable from the settings.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use serde::Serialize;

pub struct ModelFile {
    /// Path inside the model's folder.
    pub name: &'static str,
    /// None: not published yet (only usable when copied into the models folder by hand).
    pub url: Option<&'static str>,
    pub bytes: u64,
}

pub struct OptionalModel {
    pub id: &'static str,
    /// Folder inside the models directory ("" for files shared at its top level).
    pub dir: &'static str,
    pub files: &'static [ModelFile],
    /// Murmur can't transcribe without it: it can't be deleted from the settings.
    pub required: bool,
}

/// Live and final transcription: the AINA Conformer exported for sherpa-onnx
/// (tools/export_conformer_sherpa.py, still to be published), voice activity and speakers.
pub const TRANSCRIPTION: OptionalModel = OptionalModel {
    id: "transcription",
    dir: "",
    required: true,
    files: &[
        ModelFile { name: "conformer-ca-es-sherpa/encoder.onnx", url: None, bytes: 481_422_175 },
        ModelFile { name: "conformer-ca-es-sherpa/decoder.onnx", url: None, bytes: 13_787_005 },
        ModelFile { name: "conformer-ca-es-sherpa/joiner.onnx", url: None, bytes: 3_614_881 },
        ModelFile { name: "conformer-ca-es-sherpa/tokens.txt", url: None, bytes: 1_955 },
        ModelFile {
            name: "silero_vad.onnx",
            url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"),
            bytes: 643_854,
        },
        ModelFile {
            name: "nemo_en_titanet_small.onnx",
            url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx"),
            bytes: 40_257_283,
        },
        ModelFile {
            name: "3dspeaker_eres2net_base.onnx",
            url: Some(
                "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
            ),
            bytes: 39_593_761,
        },
        ModelFile {
            name: "sherpa-onnx-pyannote-segmentation-3-0/model.onnx",
            url: Some("https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx"),
            bytes: 5_992_913,
        },
    ],
};

pub const PUNCTUATION: OptionalModel = OptionalModel {
    id: "punctuation",
    dir: "punct-ca",
    required: false,
    // Converted with tools/export_punctuation.py; still to be published somewhere to download from.
    files: &[
        ModelFile { name: "model.int8.onnx", url: None, bytes: 126_172_226 },
        ModelFile { name: "tokenizer.json", url: None, bytes: 2_296_937 },
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
    }],
};

pub const ALL: [&OptionalModel; 3] = [&TRANSCRIPTION, &PUNCTUATION, &LLM];

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
    pub fn download(
        &self,
        root: &Path,
        cancel: &AtomicBool,
        mut progress: impl FnMut(u64, u64),
    ) -> Result<()> {
        let total: u64 = self.files.iter().map(|f| f.bytes).sum();
        let mut done_before = 0u64;
        for (i, file) in self.files.iter().enumerate() {
            let target = self.file(root, i);
            if target.is_file() {
                done_before += file.bytes;
                continue;
            }
            let url = file
                .url
                .ok_or_else(|| anyhow!("Aquest model encara no es pot descarregar"))?;
            if let Some(dir) = target.parent() {
                fs::create_dir_all(dir)?;
            }
            let partial = part(&target);
            let mut have = fs::metadata(&partial).map(|m| m.len()).unwrap_or(0);
            let agent = ureq::AgentBuilder::new()
                .timeout_connect(Duration::from_secs(20))
                .timeout_read(Duration::from_secs(60))
                .build();
            let mut request = agent.get(url);
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
                return Err(anyhow!(
                    "Descàrrega incompleta ({have} de {} bytes)",
                    file.bytes
                ));
            }
            fs::rename(&partial, &target)?;
            done_before += file.bytes;
            progress(done_before, total);
        }
        Ok(())
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

fn part(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    path.with_file_name(name)
}
