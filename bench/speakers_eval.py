"""Score speaker assignments against hand labels (data/qui-parla.json from data/qui-parla.html).

    uv run python -m bench.speakers_eval data/qui-parla.json results.jsonl

`results.jsonl`: one {"config": str, "speakers": [int, …]} per line, in the labelled spans'
order (see app/src-tauri/examples/diarize_spans.rs). The live clustering is always scored too.
Lines labelled "Diverses persones" / "No s'entén" are left out: they have no single answer.
"""

import json
import sys
from itertools import combinations, permutations

SKIP = {"Diverses persones", "No s'entén", None}


def pairwise(truth: list[str], pred: list[int]) -> tuple[float, float, float]:
    """Precision/recall/F1 of "same speaker" over all pairs of lines (label-free)."""
    tp = fp = fn = 0
    for i, j in combinations(range(len(truth)), 2):
        same_t, same_p = truth[i] == truth[j], pred[i] == pred[j]
        tp += same_t and same_p
        fp += same_p and not same_t
        fn += same_t and not same_p
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def accuracy(truth: list[str], pred: list[int]) -> float:
    """Share of lines right under the best one-to-one mapping of clusters to people."""
    people, clusters = sorted(set(truth)), sorted(set(pred))
    best = 0
    k = min(len(people), len(clusters))
    for chosen in combinations(clusters, k):
        for perm in permutations(people, k):
            mapping = dict(zip(chosen, perm))
            best = max(best, sum(mapping.get(p) == t for t, p in zip(truth, pred)))
    return best / len(truth)


def main() -> None:
    labelled = json.load(open(sys.argv[1]))
    keep = [i for i, line in enumerate(labelled) if line["speaker"] not in SKIP]
    truth = [labelled[i]["speaker"] for i in keep]
    rows = [("en directe", [labelled[i]["live"] for i in range(len(labelled))])]
    for line in open(sys.argv[2]):
        if line.strip():
            r = json.loads(line)
            rows.append((r["config"], r["speakers"]))
    print(f"{len(truth)} frases d'una sola persona, {len(set(truth))} persones\n")
    print(f"{'configuració':<16}{'grups':>6}{'encerts':>9}{'precisió':>10}{'cobertura':>11}{'F1':>7}")
    for name, speakers in rows:
        pred = [speakers[i] for i in keep]
        p, r, f1 = pairwise(truth, pred)
        print(f"{name:<16}{len(set(pred)):>6}{accuracy(truth, pred):>9.0%}{p:>10.0%}{r:>11.0%}{f1:>7.2f}")


if __name__ == "__main__":
    main()
