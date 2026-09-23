"""Explicit, selective ModelScope checkpoint download for Hero runtimes.

This helper is intentionally not imported by the application. It avoids the
duplicate SAM 3 safetensors file and the TRELLIS.2 1024 flows so the A10 probe
does not consume disk for variants it must not run.
"""

from __future__ import annotations

import argparse
from pathlib import Path

SAM3_ALLOW_PATTERNS = [
    "sam3.pt",
    "tokenizer.json",
    "config.json",
    "configuration.json",
    "merges.txt",
    "processor_config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
    "vocab.json",
    "LICENSE",
    "README.md",
]

TRELLIS2_ALLOW_PATTERNS = [
    "configuration.json",
    "pipeline.json",
    "texturing_pipeline.json",
    "README.md",
    "ckpts/shape_dec_next_dc_f16c32_fp16.*",
    "ckpts/shape_enc_next_dc_f16c32_fp16.*",
    "ckpts/tex_dec_next_dc_f16c32_fp16.*",
    "ckpts/tex_enc_next_dc_f16c32_fp16.*",
    "ckpts/ss_flow_img_dit_1_3B_64_bf16.*",
    "ckpts/slat_flow_img2shape_dit_1_3B_512_bf16.*",
    "ckpts/slat_flow_imgshape2tex_dit_1_3B_512_bf16.*",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--only", choices=("sam3", "trellis2", "both"), default="both")
    parser.add_argument("--confirm-large-download", action="store_true")
    parser.add_argument("--confirm-sam3-access-approved", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.confirm_large_download:
        raise SystemExit("Refusing download without --confirm-large-download")
    if args.only in {"sam3", "both"} and not args.confirm_sam3_access_approved:
        raise SystemExit("Refusing SAM 3 download without access approval acknowledgement")
    from modelscope import snapshot_download

    args.model_root.mkdir(parents=True, exist_ok=True)
    if args.only in {"sam3", "both"}:
        snapshot_download(
            "facebook/sam3",
            local_dir=str(args.model_root / "sam3"),
            allow_patterns=SAM3_ALLOW_PATTERNS,
        )
    if args.only in {"trellis2", "both"}:
        snapshot_download(
            "microsoft/TRELLIS.2-4B",
            local_dir=str(args.model_root / "trellis2"),
            allow_patterns=TRELLIS2_ALLOW_PATTERNS,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
