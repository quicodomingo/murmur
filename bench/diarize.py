"""Offline speaker diarization with sherpa-onnx (pyannote segmentation + 3D-Speaker embeddings)."""

from dataclasses import dataclass

import numpy as np
import sherpa_onnx

from bench.models import path


@dataclass
class Turn:
    start: float
    end: float
    speaker: int


def diarize(audio: np.ndarray, num_speakers: int = -1, threshold: float = 0.5) -> list[Turn]:
    """num_speakers=-1 lets clustering decide; pass the real count when known (more accurate)."""
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=str(path("sherpa-onnx-pyannote-segmentation-3-0") / "model.onnx")
            ),
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(path("3dspeaker_eres2net_base.onnx"))
        ),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=num_speakers, threshold=threshold),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    if not config.validate():
        raise RuntimeError("Invalid diarization config — have you run `python -m bench.models`?")
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)
    result = sd.process(audio).sort_by_start_time()
    return [Turn(r.start, r.end, r.speaker) for r in result]
