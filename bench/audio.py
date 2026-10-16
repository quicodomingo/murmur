"""Audio loading and VAD segmentation shared by all engines."""

import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import sherpa_onnx

SAMPLE_RATE = 16000


def load_audio(path: Path) -> np.ndarray:
    """Decode any audio/video file to 16 kHz mono float32 using ffmpeg."""
    cmd = [
        "ffmpeg",
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "f32le",
        "-",
    ]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


@dataclass
class Segment:
    start: float  # seconds
    end: float
    samples: np.ndarray


def vad_segments(audio: np.ndarray, vad_model: Path, max_speech: float = 20.0) -> list[Segment]:
    """Split audio into speech segments with Silero VAD (same approach as live mode)."""
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = str(vad_model)
    config.silero_vad.threshold = 0.5
    config.silero_vad.min_silence_duration = 0.3
    config.silero_vad.min_speech_duration = 0.25
    config.silero_vad.max_speech_duration = max_speech
    config.sample_rate = SAMPLE_RATE
    vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=max_speech * 2)

    segments: list[Segment] = []

    def drain() -> None:
        while not vad.empty():
            seg = vad.front
            samples = np.array(seg.samples, dtype=np.float32)
            start = seg.start / SAMPLE_RATE
            segments.append(Segment(start, start + len(samples) / SAMPLE_RATE, samples))
            vad.pop()

    window = config.silero_vad.window_size
    for i in range(0, len(audio), window):
        vad.accept_waveform(audio[i : i + window])
        drain()
    vad.flush()
    drain()
    return segments
