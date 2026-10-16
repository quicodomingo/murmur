"""Build a speaker-attributed transcript from diarization turns + an ASR engine.

    uv run python -m bench.transcript data/reunio.m4a --speakers 5 [--engine conformer-ca-es-rnnt]

- Conformer engines: the audio is cut at speaker changes and each piece is transcribed apart.
- Whisper engines: each word (with its timestamp) is assigned to the turn it overlaps most.
Diarization is cached in results/<name>/turns.<speakers>.json.
"""

import argparse
import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from bench.audio import SAMPLE_RATE, load_audio
from bench.diarize import Turn, diarize
from bench.engines import ConformerCaCtc, ConformerCaEsRnnt
from bench.models import path
from bench.run import RESULTS_DIR, fmt_time

MAX_PIECE_S = 20.0  # longer pieces are split; the Conformers were trained on short utterances
MERGE_GAP_S = 1.0  # same-speaker turns closer than this are joined


@dataclass
class Word:
    start: float
    end: float
    text: str


Paragraph = tuple[float, int, str]  # (start, speaker, text)


def speaker_timeline(turns: list[Turn]) -> list[Turn]:
    """Non-overlapping turns: overlaps are cut at the next turn's start, close same-speaker turns
    are merged."""
    timeline: list[Turn] = []
    for t in sorted(turns, key=lambda t: t.start):
        if timeline and t.start < timeline[-1].end:
            if t.end <= timeline[-1].end:  # fully inside the previous turn
                continue
            timeline[-1].end = t.start
        if (
            timeline
            and timeline[-1].speaker == t.speaker
            and t.start - timeline[-1].end < MERGE_GAP_S
        ):
            timeline[-1].end = t.end
        else:
            timeline.append(Turn(t.start, t.end, t.speaker))
    return [t for t in timeline if t.end - t.start > 0.2]


def split_piece(audio: np.ndarray, start: float, end: float) -> list[tuple[float, float]]:
    """Split [start, end] into pieces <= MAX_PIECE_S, cutting at the quietest 100 ms window."""
    if end - start <= MAX_PIECE_S:
        return [(start, end)]
    lo, hi = start + MAX_PIECE_S * 0.5, start + MAX_PIECE_S
    win = int(0.1 * SAMPLE_RATE)
    region = audio[int(lo * SAMPLE_RATE) : int(hi * SAMPLE_RATE)]
    energy = [float(np.mean(region[i : i + win] ** 2)) for i in range(0, len(region) - win, win)]
    cut = lo + (int(np.argmin(energy)) * win + win / 2) / SAMPLE_RATE
    return [(start, cut), *split_piece(audio, cut, end)]


def paragraphs_conformer(audio: np.ndarray, turns: list[Turn], engine_cls) -> list[Paragraph]:
    engine = engine_cls()
    paragraphs = []
    for turn in speaker_timeline(turns):
        texts = []
        for s, e in split_piece(audio, turn.start, turn.end):
            samples = audio[int(s * SAMPLE_RATE) : int(e * SAMPLE_RATE)]
            texts.append(engine.transcribe(samples, [_Seg(samples)]))
        text = " ".join(t for t in texts if t)
        if text:
            paragraphs.append((turn.start, turn.speaker, text))
    return paragraphs


@dataclass
class _Seg:
    samples: np.ndarray


def words_mlx(audio: np.ndarray, model: str) -> list[Word]:
    import mlx_whisper

    result = mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=str(path(model)),
        language="ca",
        word_timestamps=True,
        condition_on_previous_text=False,
    )
    return [Word(w["start"], w["end"], w["word"]) for s in result["segments"] for w in s["words"]]


def words_ct2(audio: np.ndarray, model: str) -> list[Word]:
    from faster_whisper import WhisperModel

    m = WhisperModel(str(path(model)), device="cpu", compute_type="int8")
    segments, _ = m.transcribe(
        audio,
        language="ca",
        vad_filter=True,
        word_timestamps=True,
        condition_on_previous_text=False,
    )
    return [Word(w.start, w.end, w.word) for s in segments for w in s.words]


def speaker_for(word: Word, turns: list[Turn]) -> int:
    best, best_overlap = None, 0.0
    for t in turns:
        overlap = min(word.end, t.end) - max(word.start, t.start)
        if overlap > best_overlap:
            best, best_overlap = t, overlap
    if best is None:  # word in a gap between turns: take the closest one
        mid = (word.start + word.end) / 2
        best = min(turns, key=lambda t: min(abs(mid - t.start), abs(mid - t.end)))
    return best.speaker


def paragraphs_whisper(audio: np.ndarray, turns: list[Turn], words_fn, model) -> list[Paragraph]:
    paragraphs: list[tuple[float, int, list[str]]] = []
    for w in words_fn(audio, model):
        spk = speaker_for(w, turns)
        if paragraphs and paragraphs[-1][1] == spk:
            paragraphs[-1][2].append(w.text)
        else:
            paragraphs.append((w.start, spk, [w.text]))
    return [(start, spk, "".join(parts).strip()) for start, spk, parts in paragraphs]


ENGINES = {
    "conformer-ca-es-rnnt": lambda a, t: paragraphs_conformer(a, t, ConformerCaEsRnnt),
    "conformer-ca-ctc": lambda a, t: paragraphs_conformer(a, t, ConformerCaCtc),
    "whisper-turbo-mlx": lambda a, t: paragraphs_whisper(a, t, words_mlx, "whisper-turbo-mlx"),
    "whisper-aina-ct2": lambda a, t: paragraphs_whisper(a, t, words_ct2, "whisper-aina-ct2"),
}


def load_turns(audio: np.ndarray, out_dir: Path, speakers: int) -> list[Turn]:
    cache = out_dir / f"turns.{speakers}.json"
    if cache.exists():
        return [Turn(**t) for t in json.loads(cache.read_text())]
    t0 = time.perf_counter()
    turns = diarize(audio, num_speakers=speakers)
    print(f"Diarització: {time.perf_counter() - t0:.1f}s")
    cache.write_text(json.dumps([asdict(t) for t in turns]))
    return turns


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--engine", default="conformer-ca-es-rnnt", choices=list(ENGINES))
    parser.add_argument("--speakers", type=int, default=-1)
    args = parser.parse_args()

    audio = load_audio(args.audio)
    out_dir = RESULTS_DIR / args.audio.stem
    out_dir.mkdir(parents=True, exist_ok=True)
    turns = load_turns(audio, out_dir, args.speakers)

    t0 = time.perf_counter()
    paragraphs = ENGINES[args.engine](audio, turns)
    print(f"Transcripció ({args.engine}): {time.perf_counter() - t0:.1f}s")

    lines = [f"# Transcripció — {args.audio.name}", f"_Motor: {args.engine}_", ""]
    lines += [f"**[{fmt_time(s)}] Parlant {spk + 1}:** {text}\n" for s, spk, text in paragraphs]
    out = out_dir / f"transcript.{args.engine}.md"
    out.write_text("\n".join(lines))
    print(f"→ {out}")


if __name__ == "__main__":
    main()
