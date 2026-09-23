#!/usr/bin/env python3
"""Run one authorized SAM3 text-prompt segmentation without network access."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from sam3.model.sam3_image_processor import Sam3Processor
from sam3.model_builder import build_sam3_image_model


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output-mask", type=Path, required=True)
    parser.add_argument("--output-rgba", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--confidence", type=float, default=0.35)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    for path in (args.image, args.checkpoint):
        if not path.is_file():
            raise SystemExit(f"Missing input: {path}")
    for path in (args.output_mask, args.output_rgba, args.output_json):
        path.parent.mkdir(parents=True, exist_ok=True)

    image = Image.open(args.image).convert("RGB")
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()

    started = time.perf_counter()
    with torch.autocast("cuda", dtype=torch.bfloat16):
        model = build_sam3_image_model(
            checkpoint_path=str(args.checkpoint),
            load_from_HF=False,
            device="cuda",
            eval_mode=True,
        )
        torch.cuda.synchronize()
        load_seconds = time.perf_counter() - started

        processor = Sam3Processor(
            model,
            device="cuda",
            confidence_threshold=args.confidence,
        )
        inference_started = time.perf_counter()
        state = processor.set_image(image)
        output = processor.set_text_prompt(prompt=args.prompt, state=state)
        torch.cuda.synchronize()
    inference_seconds = time.perf_counter() - inference_started

    scores = output["scores"].detach().float().cpu()
    masks = output["masks"].detach().cpu()
    boxes = output["boxes"].detach().float().cpu()
    if scores.numel() == 0:
        raise RuntimeError(
            f"SAM3 returned no masks at confidence threshold {args.confidence}."
        )
    selected = int(torch.argmax(scores).item())
    mask = masks[selected]
    while mask.ndim > 2:
        mask = mask[0]
    mask_array = mask.numpy().astype(np.uint8) * 255
    mask_image = Image.fromarray(mask_array, mode="L")
    mask_image.save(args.output_mask)

    rgba = image.convert("RGBA")
    rgba.putalpha(mask_image)
    rgba.save(args.output_rgba)

    result = {
        "image": str(args.image),
        "checkpoint": str(args.checkpoint),
        "prompt": args.prompt,
        "confidence_threshold": args.confidence,
        "candidate_count": int(scores.numel()),
        "selected_index": selected,
        "selected_score": float(scores[selected].item()),
        "selected_box_xyxy": [float(value) for value in boxes[selected].tolist()],
        "mask_pixels": int(mask.sum().item()),
        "image_width": image.width,
        "image_height": image.height,
        "model_load_seconds": round(load_seconds, 3),
        "inference_seconds": round(inference_seconds, 3),
        "total_seconds": round(time.perf_counter() - started, 3),
        "peak_memory_allocated_mib": round(
            torch.cuda.max_memory_allocated() / (1024 * 1024), 1
        ),
        "peak_memory_reserved_mib": round(
            torch.cuda.max_memory_reserved() / (1024 * 1024), 1
        ),
        "mask_output": str(args.output_mask),
        "rgba_output": str(args.output_rgba),
        "torch_version": torch.__version__,
        "cuda_version": torch.version.cuda,
    }
    args.output_json.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
