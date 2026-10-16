"""Export a NeMo Conformer-Transducer (.nemo) to sherpa-onnx's offline transducer format.

Adapted from sherpa-onnx scripts/nemo/fast-conformer-hybrid-transducer-ctc/
export-onnx-transducer-non-streaming.py. Needs NeMo (heavy: torch), so run it from an isolated venv:

    python tools/export_conformer_sherpa.py \
        --model projecte-aina/stt_ca-es_conformer_transducer_large \
        --out models/conformer-ca-es-sherpa

Writes encoder/decoder/joiner .onnx (+ .int8.onnx) and tokens.txt.
"""

import argparse
import os
from pathlib import Path

import nemo.collections.asr as nemo_asr
import onnx
import torch
from huggingface_hub import hf_hub_download
from onnxruntime.quantization import QuantType, quantize_dynamic


def add_meta_data(filename: Path, meta_data: dict[str, str]) -> None:
    model = onnx.load(str(filename))
    while len(model.metadata_props):
        model.metadata_props.pop()
    for key, value in meta_data.items():
        meta = model.metadata_props.add()
        meta.key = key
        meta.value = str(value)
    onnx.save(model, str(filename))


@torch.no_grad()
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Hugging Face repo with a .nemo file")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    repo_file = args.model.split("/")[-1] + ".nemo"
    nemo_path = hf_hub_download(args.model, repo_file)
    asr_model = nemo_asr.models.ASRModel.restore_from(nemo_path, map_location="cpu")
    asr_model.eval()

    vocab = asr_model.joint.vocabulary
    with open(args.out / "tokens.txt", "w", encoding="utf-8") as f:
        for i, s in enumerate(vocab):
            f.write(f"{s} {i}\n")
        f.write(f"<blk> {len(vocab)}\n")

    os.chdir(args.out)
    asr_model.encoder.export("encoder.onnx")
    asr_model.decoder.export("decoder.onnx")
    asr_model.joint.export("joiner.onnx")

    cfg = asr_model.cfg
    normalize_type = cfg.preprocessor.normalize
    if normalize_type == "NA":
        normalize_type = ""
    meta_data = {
        "vocab_size": asr_model.decoder.vocab_size,
        "normalize_type": normalize_type,
        "pred_rnn_layers": asr_model.decoder.pred_rnn_layers,
        "pred_hidden": asr_model.decoder.pred_hidden,
        # Classic Conformer subsamples by 4 (FastConformer by 8): read it from the model config.
        "subsampling_factor": cfg.encoder.subsampling_factor,
        "model_type": "EncDecRNNTBPEModel",
        "version": "1",
        "model_author": "NeMo",
        "url": f"https://huggingface.co/{args.model}",
        "comment": "Exported for sherpa-onnx (offline transducer)",
    }
    add_meta_data(Path("encoder.onnx"), meta_data)
    print(meta_data)
    print("features:", cfg.preprocessor.features, "window:", cfg.preprocessor.window_size)

    for m in ["encoder", "decoder", "joiner"]:
        quantize_dynamic(
            model_input=f"{m}.onnx", model_output=f"{m}.int8.onnx", weight_type=QuantType.QUInt8
        )


if __name__ == "__main__":
    main()
