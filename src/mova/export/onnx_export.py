"""Export a trained Mova model to ONNX for edge deployment, with a parity check.

Produces two artifacts from one checkpoint:

  * ``<name>_encoder.onnx`` — the foundation encoder: ``(x, placement_id, dataset_id) -> embedding``
    (mean-pooled ``[B, hidden]``), reusable by every head.
  * ``<name>.onnx`` — encoder + task head: ``(x, placement_id, dataset_id) -> logits ``[B, C]``.

Both have a dynamic batch axis. After export we re-run the ONNX graph under onnxruntime and assert it
matches PyTorch to a tight tolerance, so a green export means the edge model is numerically faithful.

Run:
    python -m mova.export.onnx_export --ckpt checkpoints/fog_model.ckpt --task fog \
        --out-dir checkpoints/onnx --name fog
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import numpy as np
import torch
from torch import nn

from mova.models.encoder import LIMUBertEncoder

logger = logging.getLogger("mova.export.onnx")


class EncoderEmbedding(nn.Module):
    """encoder -> mean-pooled embedding (the reusable foundation representation)."""

    def __init__(self, encoder: LIMUBertEncoder) -> None:
        super().__init__()
        self.encoder = encoder

    def forward(self, x: torch.Tensor, placement_id: torch.Tensor, dataset_id: torch.Tensor) -> torch.Tensor:
        return LIMUBertEncoder.pool(self.encoder(x, placement_id, dataset_id))


class EncoderWithHead(nn.Module):
    """encoder + task head -> logits."""

    def __init__(self, encoder: LIMUBertEncoder, head: nn.Module) -> None:
        super().__init__()
        self.encoder = encoder
        self.head = head

    def forward(self, x: torch.Tensor, placement_id: torch.Tensor, dataset_id: torch.Tensor) -> torch.Tensor:
        return self.head(LIMUBertEncoder.pool(self.encoder(x, placement_id, dataset_id)))


def _example_inputs(max_len: int, in_channels: int, batch: int = 2):
    return (
        torch.randn(batch, max_len, in_channels),
        torch.zeros(batch, dtype=torch.long),
        torch.zeros(batch, dtype=torch.long),
    )


def _export(model: nn.Module, path: Path, example, output_name: str, opset: int) -> None:
    model.eval()
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model, example, str(path),
        input_names=["window", "placement_id", "dataset_id"], output_names=[output_name],
        dynamic_axes={"window": {0: "batch"}, "placement_id": {0: "batch"},
                      "dataset_id": {0: "batch"}, output_name: {0: "batch"}},
        opset_version=opset, do_constant_folding=True,
        dynamo=False,  # legacy TorchScript exporter: robust for nn.TransformerEncoder, no onnxscript dep
    )


def _parity(model: nn.Module, path: Path, example, atol: float = 2e-4) -> float:
    import onnxruntime as ort

    model.eval()
    with torch.no_grad():
        ref = model(*example).cpu().numpy()
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    feed = {"window": example[0].numpy(), "placement_id": example[1].numpy().astype(np.int64),
            "dataset_id": example[2].numpy().astype(np.int64)}
    got = sess.run(None, feed)[0]
    max_abs = float(np.max(np.abs(ref - got)))
    if max_abs > atol:
        raise AssertionError(f"ONNX parity failed for {path.name}: max_abs_diff={max_abs:.2e} > {atol:.0e}")
    return max_abs


def export_module(module, out_dir: Path, name: str, *, task: str, opset: int = 17) -> dict:
    """Export a trained MovaLitModule's encoder + head to ONNX and verify parity."""
    encoder: LIMUBertEncoder = module.encoder
    cfg = encoder.cfg
    example = _example_inputs(cfg.max_len, cfg.in_channels)

    enc_path = out_dir / f"{name}_encoder.onnx"
    _export(EncoderEmbedding(encoder), enc_path, example, "embedding", opset)
    enc_diff = _parity(EncoderEmbedding(encoder), enc_path, example)

    full_path = out_dir / f"{name}.onnx"
    _export(EncoderWithHead(encoder, module.head), full_path, example, "logits", opset)
    full_diff = _parity(EncoderWithHead(encoder, module.head), full_path, example)

    meta = {
        "name": name, "task": task, "opset": opset,
        "encoder_onnx": str(enc_path), "model_onnx": str(full_path),
        "encoder_parity_max_abs": enc_diff, "model_parity_max_abs": full_diff,
        "input_signature": {"window": [None, cfg.max_len, cfg.in_channels],
                            "placement_id": [None], "dataset_id": [None]},
        "encoder": {"hidden": cfg.hidden, "n_layers": cfg.n_layers, "params": encoder.num_parameters},
    }
    (out_dir / f"{name}_onnx.json").write_text(json.dumps(meta, indent=2))
    logger.info("exported %s + encoder (parity max_abs: model=%.2e enc=%.2e)", full_path.name, full_diff, enc_diff)
    return meta


def load_module_from_ckpt(ckpt_path: str):
    from mova.train.module import MovaLitModule
    return MovaLitModule.load_from_checkpoint(ckpt_path, map_location="cpu")


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Export a Mova checkpoint to ONNX")
    p.add_argument("--ckpt", required=True)
    p.add_argument("--task", default="fog")
    p.add_argument("--out-dir", type=Path, default=Path("checkpoints/onnx"))
    p.add_argument("--name", default="fog")
    p.add_argument("--opset", type=int, default=17)
    p.add_argument("--log-level", default="INFO")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    module = load_module_from_ckpt(args.ckpt)
    export_module(module, args.out_dir, args.name, task=args.task, opset=args.opset)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
