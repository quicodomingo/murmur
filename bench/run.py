"""Run every ASR engine (and diarization) on a recording and compare them.

    uv run python -m bench.run data/reunio.m4a [--ref data/reunio.ref.txt] [--speakers 3]

With --ref, only the first --ref-minutes of audio are scored, so the reference can be a
hand-transcribed excerpt from the start of the meeting.
"""

import argparse
import gc
import json
import time
from pathlib import Path

from bench.audio import SAMPLE_RATE, load_audio, vad_segments
from bench.diarize import diarize
from bench.engines import ENGINES
from bench.metrics import scores
from bench.models import path

RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"


def fmt_time(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m:02d}:{s:02d}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--ref", type=Path, help="hand-made reference transcript (plain text)")
    parser.add_argument("--ref-minutes", type=float, help="length of audio the reference covers")
    parser.add_argument("--engines", nargs="+", default=list(ENGINES), choices=list(ENGINES))
    parser.add_argument("--speakers", type=int, default=-1, help="number of speakers, if known")
    parser.add_argument("--no-diarization", action="store_true")
    args = parser.parse_args()

    audio = load_audio(args.audio)
    if args.ref_minutes:
        audio = audio[: int(args.ref_minutes * 60 * SAMPLE_RATE)]
    duration = len(audio) / SAMPLE_RATE
    out_dir = RESULTS_DIR / args.audio.stem
    out_dir.mkdir(parents=True, exist_ok=True)
    reference = args.ref.read_text() if args.ref else None
    print(f"Àudio: {args.audio.name} — {fmt_time(duration)}")

    segments = vad_segments(audio, path("silero_vad.onnx"))
    print(f"VAD: {len(segments)} segments de veu")

    report = {"audio": str(args.audio), "duration_s": duration, "engines": {}}
    for name in args.engines:
        print(f"\n▶ {name}")
        t0 = time.perf_counter()
        engine = ENGINES[name]()
        load_s = time.perf_counter() - t0
        t0 = time.perf_counter()
        text = engine.transcribe(audio, segments)
        run_s = time.perf_counter() - t0
        del engine
        gc.collect()

        (out_dir / f"{name}.txt").write_text(text + "\n")
        entry = {"load_s": round(load_s, 1), "run_s": round(run_s, 1), "rtf": run_s / duration}
        if reference:
            entry |= scores(reference, text)
        report["engines"][name] = entry
        print(
            f"  càrrega {load_s:.1f}s · transcripció {run_s:.1f}s · RTF {entry['rtf']:.3f}"
            + (f" · WER {entry['wer']:.1%} · CER {entry['cer']:.1%}" if reference else "")
        )

    if not args.no_diarization:
        print("\n▶ diarització")
        t0 = time.perf_counter()
        turns = diarize(audio, num_speakers=args.speakers)
        run_s = time.perf_counter() - t0
        speakers = sorted({t.speaker for t in turns})
        lines = [f"[{fmt_time(t.start)}–{fmt_time(t.end)}] Parlant {t.speaker + 1}" for t in turns]
        (out_dir / "diarization.txt").write_text("\n".join(lines) + "\n")
        report["diarization"] = {
            "run_s": round(run_s, 1),
            "rtf": run_s / duration,
            "speakers": len(speakers),
            "turns": len(turns),
        }
        print(
            f"  {run_s:.1f}s · RTF {run_s / duration:.3f} · {len(speakers)} parlants · "
            f"{len(turns)} torns"
        )

    (out_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"\nResultats a {out_dir}")
    print("RTF = temps de procés / durada de l'àudio (< 1 vol dir més ràpid que temps real)")


if __name__ == "__main__":
    main()
