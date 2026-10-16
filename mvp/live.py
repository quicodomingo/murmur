"""Live transcription session: VAD → Conformer ca-es (partial + final) → online speaker clustering."""

from dataclasses import dataclass, field

import numpy as np
import onnx_asr
import sherpa_onnx

from bench.audio import SAMPLE_RATE
from bench.models import path

PARTIAL_EVERY_S = 0.6  # how often the in-progress utterance is re-decoded
MIN_EMBED_S = 1.0  # shorter utterances can't create or update speakers (embeddings too noisy)


class Models:
    """Loaded once per server and shared by sessions."""

    def __init__(self) -> None:
        self.asr = onnx_asr.load_model(
            "nemo-conformer-rnnt", path("conformer-ca-es-rnnt"), providers=["CPUExecutionProvider"]
        )
        self.embedder = sherpa_onnx.SpeakerEmbeddingExtractor(
            sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=str(path("3dspeaker_eres2net_base.onnx")), num_threads=2
            )
        )

    def transcribe(self, samples: np.ndarray) -> str:
        return self.asr.recognize(samples, sample_rate=SAMPLE_RATE).strip()

    def embed(self, samples: np.ndarray) -> np.ndarray:
        stream = self.embedder.create_stream()
        stream.accept_waveform(SAMPLE_RATE, samples)
        stream.input_finished()
        emb = np.array(self.embedder.compute(stream), dtype=np.float32)
        return emb / (np.linalg.norm(emb) + 1e-9)


@dataclass
class SpeakerClusters:
    """Online clustering: each utterance joins the closest speaker or starts a new one."""

    max_speakers: int = 5
    threshold: float = 0.65  # cosine similarity needed to join an existing speaker
    sums: list[np.ndarray] = field(default_factory=list)
    last: int = 0

    def assign(self, emb: np.ndarray, duration: float) -> int:
        reliable = duration >= MIN_EMBED_S
        if not self.sums:
            if not reliable:
                return 0
            self.sums.append(emb.copy())
            return 0
        centroids = np.stack([s / np.linalg.norm(s) for s in self.sums])
        sims = centroids @ emb
        best = int(np.argmax(sims))
        if sims[best] >= self.threshold or not reliable:
            if not reliable and sims[best] < self.threshold:
                best = self.last  # short interjection, unsure: keep the current speaker
            elif reliable:
                self.sums[best] += emb
        elif len(self.sums) < self.max_speakers:
            self.sums.append(emb.copy())
            best = len(self.sums) - 1
        else:
            self.sums[best] += emb
        self.last = best
        return best


class LiveSession:
    def __init__(self, models: Models, max_speakers: int = 5, threshold: float = 0.65) -> None:
        self.models = models
        self.speakers = SpeakerClusters(max_speakers=max_speakers, threshold=threshold)
        config = sherpa_onnx.VadModelConfig()
        config.silero_vad.model = str(path("silero_vad.onnx"))
        config.silero_vad.threshold = 0.5
        config.silero_vad.min_silence_duration = 0.5
        config.silero_vad.min_speech_duration = 0.25
        config.silero_vad.max_speech_duration = 15
        config.sample_rate = SAMPLE_RATE
        self.vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=60)
        self.window = config.silero_vad.window_size
        self.leftover = np.zeros(0, dtype=np.float32)
        self.next_id = 0
        self.samples_seen = 0
        self.last_partial = 0
        self.partial_shown = False

    def accept(self, samples: np.ndarray) -> list[dict]:
        events: list[dict] = []
        buf = np.concatenate([self.leftover, samples])
        n = len(buf) // self.window * self.window
        for i in range(0, n, self.window):
            self.vad.accept_waveform(buf[i : i + self.window])
            events += self._drain()
        self.leftover = buf[n:]
        self.samples_seen += len(samples)
        events += self._partial()
        return events

    def finish(self) -> list[dict]:
        self.vad.flush()
        return self._drain()

    def _drain(self) -> list[dict]:
        events = []
        while not self.vad.empty():
            seg = self.vad.front
            samples = np.array(seg.samples, dtype=np.float32)
            self.vad.pop()
            start = seg.start / SAMPLE_RATE
            duration = len(samples) / SAMPLE_RATE
            text = self.models.transcribe(samples)
            if not text:
                continue
            speaker = self.speakers.assign(self.models.embed(samples), duration)
            events.append(
                {
                    "type": "final",
                    "id": self.next_id,
                    "start": round(start, 2),
                    "end": round(start + duration, 2),
                    "speaker": speaker,
                    "text": text,
                }
            )
            self.next_id += 1
            self.partial_shown = False
        return events

    def _partial(self) -> list[dict]:
        if not self.vad.is_speech_detected():
            if self.partial_shown:
                self.partial_shown = False
                return [{"type": "partial", "text": ""}]
            return []
        # Throttle on audio time, not wall time, so it behaves the same live and in simulations
        if self.samples_seen - self.last_partial < PARTIAL_EVERY_S * SAMPLE_RATE:
            return []
        self.last_partial = self.samples_seen
        samples = np.array(self.vad.current_segment.samples, dtype=np.float32)
        if len(samples) < SAMPLE_RATE // 2:
            return []
        self.partial_shown = True
        return [{"type": "partial", "text": self.models.transcribe(samples)}]
