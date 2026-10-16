"""Export Softcatalà's Catalan punctuation model to ONNX int8 for the app (`punctuate.rs`).

Needs torch + transformers, so run it from an isolated venv:

    uv venv /tmp/punct && VIRTUAL_ENV=/tmp/punct uv pip install torch transformers onnx onnxruntime
    /tmp/punct/bin/python tools/export_punctuation.py --out models/punct-ca

Writes model.int8.onnx (~126 MB, vs 502 MB in fp32) and tokenizer.json.
"""

import argparse
import shutil
from pathlib import Path

import torch
from huggingface_hub import hf_hub_download
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoModelForTokenClassification, AutoTokenizer

REPO = "softcatala/fullstop-catalan-punctuation-prediction"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("models/punct-ca"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(REPO, add_prefix_space=True)
    model = AutoModelForTokenClassification.from_pretrained(REPO).eval()
    dummy = tokenizer(["hola", "què", "tal"], is_split_into_words=True, return_tensors="pt")
    fp32 = args.out / "model.onnx"
    axes = {0: "batch", 1: "tokens"}
    with torch.no_grad():
        torch.onnx.export(
            model,
            (dummy["input_ids"], dummy["attention_mask"]),
            fp32,
            input_names=["input_ids", "attention_mask"],
            output_names=["logits"],
            dynamic_axes={"input_ids": axes, "attention_mask": axes, "logits": axes},
            opset_version=17,
            dynamo=False,
        )
    quantize_dynamic(fp32, args.out / "model.int8.onnx", weight_type=QuantType.QInt8)
    fp32.unlink()
    shutil.copy(hf_hub_download(REPO, "tokenizer.json"), args.out / "tokenizer.json")
    print(f"→ {args.out}")


if __name__ == "__main__":
    main()
