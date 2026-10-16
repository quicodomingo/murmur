"""WER/CER with Catalan-aware text normalization."""

import re
import unicodedata

import jiwer


def normalize(text: str) -> str:
    """Lowercase, unify apostrophes, drop punctuation. Accents are kept: they matter in Catalan."""
    text = unicodedata.normalize("NFC", text).lower()
    text = re.sub(r"[’‘`´]", "'", text)
    text = text.replace("l·l", "l.l").replace("l•l", "l.l")  # protect the ela geminada
    text = re.sub(r"[-–—]", " ", text)  # "dóna-li" vs "dóna li" shouldn't count as an error
    text = re.sub(r"[^\w\s'.]", " ", text)
    text = re.sub(r"(?<!l)\.|\.(?!l)", " ", text)  # remove periods except inside l.l
    text = text.replace("l.l", "l·l")
    return re.sub(r"\s+", " ", text).strip()


def scores(reference: str, hypothesis: str) -> dict[str, float]:
    ref, hyp = normalize(reference), normalize(hypothesis)
    return {"wer": jiwer.wer(ref, hyp), "cer": jiwer.cer(ref, hyp)}
