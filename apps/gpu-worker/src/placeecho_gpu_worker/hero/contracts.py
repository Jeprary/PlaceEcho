from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Literal


PromptType = Literal["text", "point", "box"]


@dataclass(frozen=True)
class Sam3Prompt:
    type: PromptType
    text: str | None = None
    x: float | None = None
    y: float | None = None
    label: Literal["foreground", "background"] | None = None
    x_min: float | None = None
    y_min: float | None = None
    x_max: float | None = None
    y_max: float | None = None


@dataclass(frozen=True)
class Sam3MaskRequest:
    input_key: str
    output_mask_key: str
    prompt: Sam3Prompt


@dataclass(frozen=True)
class Sam3MaskArtifact:
    mask_key: str
    width: int
    height: int
    score: float | None = None


@dataclass(frozen=True)
class Trellis2Request:
    input_key: str
    output_key: str
    mask_key: str | None = None
    seed: int | None = None


@dataclass(frozen=True)
class HeroArtifact:
    asset_key: str
    format: Literal["glb"] = "glb"
    elapsed_ms: int = 0
    peak_vram_mib: int | None = None


@dataclass(frozen=True)
class HeroGenerationRequest:
    input_key: str
    output_key: str
    sam3_prompt: Sam3Prompt | None = None
    mask_key: str | None = None
    seed: int | None = None


def validate_storage_key(key: str, field: str) -> None:
    path = PurePosixPath(key)
    if (
        not key
        or key.startswith("/")
        or "\\" in key
        or any(part in {"", ".", ".."} for part in key.split("/"))
        or path.is_absolute()
    ):
        raise ValueError(f"{field} must be a safe relative storage key.")


def validate_prompt(prompt: Sam3Prompt) -> None:
    if prompt.type == "text":
        if prompt.text is None or not prompt.text.strip():
            raise ValueError("SAM 3 text prompts must not be empty.")
        return
    if prompt.type == "point":
        if prompt.label not in {"foreground", "background"}:
            raise ValueError("SAM 3 point prompts require a foreground/background label.")
        _validate_normalized((prompt.x, prompt.y), "point")
        return
    if prompt.type == "box":
        _validate_normalized(
            (prompt.x_min, prompt.y_min, prompt.x_max, prompt.y_max), "box"
        )
        if prompt.x_min >= prompt.x_max or prompt.y_min >= prompt.y_max:  # type: ignore[operator]
            raise ValueError("SAM 3 box must have positive width and height.")
        return
    raise ValueError(f"Unsupported SAM 3 prompt type: {prompt.type}")


def _validate_normalized(values: tuple[float | None, ...], name: str) -> None:
    if any(value is None or value < 0 or value > 1 for value in values):
        raise ValueError(f"SAM 3 {name} coordinates must be normalized to [0, 1].")
