"""ASR engines under test. Each engine turns 16 kHz mono audio into text."""

import os
from abc import ABC, abstractmethod

import numpy as np

from bench.audio import SAMPLE_RATE, Segment
from bench.models import path

THREADS = min(8, os.cpu_count() or 4)


class Engine(ABC):
    name: str
    # Segment-based engines get VAD segments (as in live mode); others get the full audio.
    uses_vad: bool

    @abstractmethod
    def transcribe(self, audio: np.ndarray, segments: list[Segment]) -> str: ...


class ConformerCaCtc(Engine):
    """NVIDIA Conformer-CTC Large, Catalan only (Common Voice 9.0)."""

    name = "conformer-ca-ctc"
    uses_vad = True

    def __init__(self) -> None:
        import sherpa_onnx

        model_dir = path(self.name)
        self.recognizer = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
            model=str(model_dir / "model.onnx"),
            tokens=str(model_dir / "tokens.txt"),
            num_threads=THREADS,
        )

    def transcribe(self, audio, segments):
        texts = []
        for seg in segments:
            stream = self.recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, seg.samples)
            self.recognizer.decode_stream(stream)
            texts.append(stream.result.text.strip())
        return " ".join(t for t in texts if t)


class ConformerCaEsRnnt(Engine):
    """Projecte AINA Conformer-Transducer Large, Catalan + Spanish."""

    name = "conformer-ca-es-rnnt"
    uses_vad = True

    def __init__(self) -> None:
        import onnx_asr

        # CoreML only covers part of the graph and ends up slower; stay on CPU.
        self.model = onnx_asr.load_model(
            "nemo-conformer-rnnt", path(self.name), providers=["CPUExecutionProvider"]
        )

    def transcribe(self, audio, segments):
        # One segment at a time: batching all segments stalls onnxruntime in padded Slice copies.
        texts = [self.model.recognize(seg.samples, sample_rate=SAMPLE_RATE) for seg in segments]
        return " ".join(t.strip() for t in texts if t.strip())


class WhisperTurboMlx(Engine):
    """OpenAI Whisper large-v3-turbo on Apple GPU via MLX (multilingual baseline)."""

    name = "whisper-turbo-mlx"
    uses_vad = False

    def transcribe(self, audio, segments):
        import mlx_whisper

        result = mlx_whisper.transcribe(
            audio,
            path_or_hf_repo=str(path(self.name)),
            language="ca",
            condition_on_previous_text=False,
        )
        return result["text"].strip()


class WhisperAinaCt2(Engine):
    """Projecte AINA Whisper large-v3 fine-tuned on Catalan (3CatParla), CTranslate2 on CPU."""

    name = "whisper-aina-ct2"
    uses_vad = False

    def __init__(self) -> None:
        from faster_whisper import WhisperModel

        self.model = WhisperModel(
            str(path(self.name)), device="cpu", compute_type="int8", cpu_threads=THREADS
        )

    def transcribe(self, audio, segments):
        result, _ = self.model.transcribe(
            audio, language="ca", vad_filter=True, condition_on_previous_text=False
        )
        return " ".join(s.text.strip() for s in result)


ENGINES: dict[str, type[Engine]] = {
    e.name: e for e in (ConformerCaCtc, ConformerCaEsRnnt, WhisperTurboMlx, WhisperAinaCt2)
}
