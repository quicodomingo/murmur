"""Download the models used by the benchmark into models/."""

import tarfile
import urllib.request
from pathlib import Path

from huggingface_hub import snapshot_download

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

SHERPA_RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
FILES = {
    "silero_vad.onnx": f"{SHERPA_RELEASES}/asr-models/silero_vad.onnx",
    # Speaker embedding for diarization (language-independent)
    "3dspeaker_eres2net_base.onnx": f"{SHERPA_RELEASES}/speaker-recongition-models/"
    "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
}
TARBALLS = {
    "sherpa-onnx-pyannote-segmentation-3-0": f"{SHERPA_RELEASES}/speaker-segmentation-models/"
    "sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
}
HF_REPOS = {
    "conformer-ca-ctc": "mpuig/stt_ca_conformer_ctc_large_onnx",
    "conformer-ca-es-rnnt": "OpenVoiceOS/stt-ca-es-conformer-transducer-large-onnx",
    "whisper-turbo-mlx": "mlx-community/whisper-large-v3-turbo",
    "whisper-aina-ct2": "projecte-aina/faster-whisper-large-v3-ca-3catparla",
}


def path(name: str) -> Path:
    return MODELS_DIR / name


def download_all() -> None:
    MODELS_DIR.mkdir(exist_ok=True)
    for name, url in FILES.items():
        target = path(name)
        if not target.exists():
            print(f"↓ {name}")
            urllib.request.urlretrieve(url, target)
    for name, url in TARBALLS.items():
        if not path(name).exists():
            print(f"↓ {name}")
            archive = MODELS_DIR / f"{name}.tar.bz2"
            urllib.request.urlretrieve(url, archive)
            with tarfile.open(archive) as tar:
                tar.extractall(MODELS_DIR, filter="data")
            archive.unlink()
    for name, repo in HF_REPOS.items():
        print(f"↓ {repo}")
        snapshot_download(repo, local_dir=path(name))


if __name__ == "__main__":
    download_all()
