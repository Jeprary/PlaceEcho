from __future__ import annotations

import importlib.util
import os
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


DEFAULT_SOURCE_DIR = "/opt/placeecho/models/TRELLIS"
DEFAULT_MODEL_PATH = "/opt/placeecho/weights/trellis1"


class RuntimeUnavailableError(RuntimeError):
    """Raised when the isolated TRELLIS runtime is not fully installed."""


class WorkerBusyError(RuntimeError):
    """Raised instead of oversubscribing the single GPU."""


class GenerationError(RuntimeError):
    """Raised when TRELLIS inference or export fails."""


@dataclass(frozen=True)
class GenerateRequest:
    input_key: str
    output_glb_key: str
    output_ply_key: str | None = None
    seed: int = 1
    simplify: float = 0.95
    texture_size: int = 1024


@dataclass(frozen=True)
class GenerateResult:
    provider: str
    status: str
    input_key: str
    output_glb_key: str
    output_ply_key: str | None
    seed: int
    elapsed_ms: int
    cuda_enabled: bool


class Backend(Protocol):
    @property
    def loaded(self) -> bool: ...

    def generate(
        self,
        input_path: Path,
        output_glb_path: Path,
        output_ply_path: Path | None,
        *,
        seed: int,
        simplify: float,
        texture_size: int,
    ) -> None: ...


class OfficialTrellisBackend:
    """Lazy adapter around Microsoft's official TRELLIS image pipeline."""

    def __init__(self, source_dir: Path, model_path: Path) -> None:
        self.source_dir = source_dir.resolve()
        self.model_path = model_path.resolve()
        self._pipeline: Any | None = None

    @classmethod
    def from_environment(cls) -> OfficialTrellisBackend:
        return cls(
            Path(os.getenv("TRELLIS_SOURCE_DIR", DEFAULT_SOURCE_DIR)),
            Path(os.getenv("TRELLIS_MODEL_PATH", DEFAULT_MODEL_PATH)),
        )

    @property
    def loaded(self) -> bool:
        return self._pipeline is not None

    def runtime_ready(self) -> bool:
        if not (self.source_dir / "trellis").is_dir() or not self.model_path.is_dir():
            return False
        source = str(self.source_dir)
        if source not in sys.path:
            sys.path.insert(0, source)
        try:
            from trellis.pipelines import TrellisImageTo3DPipeline  # noqa: F401
        except Exception:
            return False
        return importlib.util.find_spec("torch") is not None

    def generate(
        self,
        input_path: Path,
        output_glb_path: Path,
        output_ply_path: Path | None,
        *,
        seed: int,
        simplify: float,
        texture_size: int,
    ) -> None:
        pipeline = self._load_pipeline()
        try:
            from PIL import Image, ImageOps
            from trellis.utils import postprocessing_utils

            with Image.open(input_path) as opened:
                # iPhone photos commonly store rotation/mirroring in EXIF rather
                # than pixels. Normalize it before segmentation and inference.
                image = ImageOps.exif_transpose(opened).convert("RGBA")
                outputs = pipeline.run(image, seed=seed)

            glb = postprocessing_utils.to_glb(
                outputs["gaussian"][0],
                outputs["mesh"][0],
                simplify=simplify,
                texture_size=texture_size,
            )
            glb.export(output_glb_path)
            if output_ply_path is not None:
                outputs["gaussian"][0].save_ply(output_ply_path)
        except Exception as error:  # upstream CUDA extensions raise varied errors
            raise GenerationError(f"TRELLIS generation failed: {error}") from error

    def _load_pipeline(self) -> Any:
        if self._pipeline is not None:
            return self._pipeline
        if not (self.source_dir / "trellis").is_dir():
            raise RuntimeUnavailableError(
                f"TRELLIS source is missing: {self.source_dir}"
            )
        if not self.model_path.is_dir():
            raise RuntimeUnavailableError(
                f"TRELLIS model is missing: {self.model_path}"
            )

        source = str(self.source_dir)
        if source not in sys.path:
            sys.path.insert(0, source)
        os.environ.setdefault("SPCONV_ALGO", "native")
        # xFormers has an official PyTorch 2.4/CUDA 11.8 wheel and avoids a
        # costly, fragile FlashAttention source build on the Team28 A10 host.
        os.environ.setdefault("ATTN_BACKEND", "xformers")
        try:
            from trellis.pipelines import TrellisImageTo3DPipeline

            pipeline = TrellisImageTo3DPipeline.from_pretrained(str(self.model_path))
            pipeline.cuda()
        except Exception as error:
            raise RuntimeUnavailableError(
                f"TRELLIS runtime could not load the local model: {error}"
            ) from error
        self._pipeline = pipeline
        return pipeline


class TrellisGenerationService:
    def __init__(
        self,
        input_root: Path,
        output_root: Path,
        backend: Backend,
    ) -> None:
        self.input_root = input_root.resolve()
        self.output_root = output_root.resolve()
        self.backend = backend
        self._generation_lock = threading.Lock()

    @classmethod
    def from_environment(cls) -> TrellisGenerationService:
        return cls(
            input_root=Path(os.getenv("TRELLIS_INPUT_ROOT", "/data/input")),
            output_root=Path(os.getenv("TRELLIS_OUTPUT_ROOT", "/data/output")),
            backend=OfficialTrellisBackend.from_environment(),
        )

    @property
    def busy(self) -> bool:
        acquired = self._generation_lock.acquire(blocking=False)
        if acquired:
            self._generation_lock.release()
            return False
        return True

    def health(self) -> dict[str, str | bool]:
        runtime_ready = (
            self.backend.runtime_ready()
            if isinstance(self.backend, OfficialTrellisBackend)
            else True
        )
        return {
            "status": "ok",
            "provider": "trellis",
            "runtime_ready": runtime_ready,
            "model_loaded": self.backend.loaded,
            "cuda_available": cuda_available(),
            "busy": self.busy,
        }

    def generate(self, request: GenerateRequest) -> GenerateResult:
        input_path = resolve_storage_key(self.input_root, request.input_key)
        output_glb_path = resolve_storage_key(
            self.output_root, request.output_glb_key
        )
        output_ply_path = (
            resolve_storage_key(self.output_root, request.output_ply_key)
            if request.output_ply_key is not None
            else None
        )
        if input_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            raise ValueError("TRELLIS input must be a JPG, PNG, or WebP image.")
        if output_glb_path.suffix.lower() != ".glb":
            raise ValueError("TRELLIS GLB output key must end with .glb.")
        if output_ply_path is not None and output_ply_path.suffix.lower() != ".ply":
            raise ValueError("TRELLIS PLY output key must end with .ply.")
        if not input_path.is_file():
            raise FileNotFoundError(f"TRELLIS input was not found: {request.input_key}")
        if not 0 <= request.simplify < 1:
            raise ValueError("TRELLIS simplify must be between 0 (inclusive) and 1.")
        if request.texture_size not in {512, 1024, 2048}:
            raise ValueError("TRELLIS texture_size must be 512, 1024, or 2048.")
        if not self._generation_lock.acquire(blocking=False):
            raise WorkerBusyError("The TRELLIS GPU worker is already processing a job.")

        output_glb_path.parent.mkdir(parents=True, exist_ok=True)
        if output_ply_path is not None:
            output_ply_path.parent.mkdir(parents=True, exist_ok=True)
        started = time.monotonic()
        try:
            self.backend.generate(
                input_path,
                output_glb_path,
                output_ply_path,
                seed=request.seed,
                simplify=request.simplify,
                texture_size=request.texture_size,
            )
            if not output_glb_path.is_file():
                raise GenerationError("TRELLIS completed without producing the GLB output.")
            if output_ply_path is not None and not output_ply_path.is_file():
                raise GenerationError("TRELLIS completed without producing the PLY output.")
            return GenerateResult(
                provider="trellis",
                status="completed",
                input_key=request.input_key,
                output_glb_key=request.output_glb_key,
                output_ply_key=request.output_ply_key,
                seed=request.seed,
                elapsed_ms=round((time.monotonic() - started) * 1000),
                cuda_enabled=cuda_available(),
            )
        except Exception:
            output_glb_path.unlink(missing_ok=True)
            if output_ply_path is not None:
                output_ply_path.unlink(missing_ok=True)
            raise
        finally:
            self._generation_lock.release()


def resolve_storage_key(root: Path, key: str) -> Path:
    if not key or Path(key).is_absolute():
        raise ValueError("Storage key must be a non-empty relative path.")
    resolved = (root / key).resolve()
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ValueError("Storage key must remain within its configured root.") from error
    return resolved


def cuda_available() -> bool:
    if importlib.util.find_spec("torch") is None:
        return False
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False
