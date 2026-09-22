from __future__ import annotations

import os
import struct
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path


DEFAULT_MEDIA_SDK = "/opt/MediaSDK-3.1.7-linux/bin/MediaSDKTest"


class StitchError(RuntimeError):
    def __init__(self, message: str, sdk_output: str = "") -> None:
        super().__init__(message)
        self.sdk_output = sdk_output


@dataclass(frozen=True)
class StitchRequest:
    input_keys: list[str]
    output_key: str
    output_width: int = 8600
    output_height: int = 4300
    stitch_type: str = "optflow"
    enable_stitchfusion: bool = False


@dataclass(frozen=True)
class StitchResult:
    status: str
    output_key: str
    width: int
    height: int
    elapsed_ms: int
    cuda_enabled: bool


class MediaSdkStitcher:
    def __init__(
        self,
        input_root: Path,
        output_root: Path,
        executable: str = DEFAULT_MEDIA_SDK,
        cuda_enabled: bool = True,
        timeout_seconds: int = 900,
    ) -> None:
        self.input_root = input_root.resolve()
        self.output_root = output_root.resolve()
        self.executable = executable
        self.cuda_enabled = cuda_enabled
        self.timeout_seconds = timeout_seconds

    @classmethod
    def from_environment(cls) -> MediaSdkStitcher:
        return cls(
            input_root=Path(os.getenv("STITCH_INPUT_ROOT", "/data/input")),
            output_root=Path(os.getenv("STITCH_OUTPUT_ROOT", "/data/output")),
            executable=os.getenv("MEDIA_SDK_EXECUTABLE", DEFAULT_MEDIA_SDK),
            cuda_enabled=os.getenv("STITCH_ENABLE_CUDA", "true").lower() == "true",
            timeout_seconds=int(os.getenv("STITCH_TIMEOUT_SECONDS", "900")),
        )

    def stitch(self, request: StitchRequest) -> StitchResult:
        if request.output_width != request.output_height * 2:
            raise ValueError("Panorama output must have a 2:1 width-to-height ratio.")
        if request.stitch_type not in {"optflow", "dynamicstitch", "aistitch"}:
            raise ValueError(f"Unsupported stitch type: {request.stitch_type}")
        if not Path(self.executable).is_file():
            raise FileNotFoundError(f"MediaSDK executable not found: {self.executable}")

        input_paths = [self._resolve_input(key) for key in request.input_keys]
        output_path = self._resolve_output(request.output_key)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        command = [
            self.executable,
            "-inputs",
            *(str(path) for path in input_paths),
            "-output",
            str(output_path),
            "-stitch_type",
            request.stitch_type,
            "-output_size",
            f"{request.output_width}x{request.output_height}",
            "--log_level",
            "info",
        ]
        if request.enable_stitchfusion:
            command.append("-enable_stitchfusion")
        if not self.cuda_enabled:
            command.append("-disable_cuda")

        started = time.monotonic()
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
            )
        except subprocess.TimeoutExpired as error:
            raise StitchError(
                f"MediaSDK timed out after {self.timeout_seconds} seconds.",
                (error.stdout or "") + (error.stderr or ""),
            ) from error

        sdk_output = completed.stdout + completed.stderr
        if completed.returncode != 0 or not output_path.is_file():
            raise StitchError(
                f"MediaSDK failed with exit code {completed.returncode}.", sdk_output
            )

        width, height = read_jpeg_dimensions(output_path)
        if (width, height) != (request.output_width, request.output_height):
            raise StitchError(
                f"MediaSDK produced {width}x{height}, expected "
                f"{request.output_width}x{request.output_height}.",
                sdk_output,
            )

        return StitchResult(
            status="completed",
            output_key=request.output_key,
            width=width,
            height=height,
            elapsed_ms=round((time.monotonic() - started) * 1000),
            cuda_enabled=self.cuda_enabled,
        )

    def _resolve_input(self, key: str) -> Path:
        path = resolve_storage_key(self.input_root, key)
        if path.suffix.lower() != ".insp":
            raise ValueError(f"Input must be an .insp file: {key}")
        if not path.is_file():
            raise FileNotFoundError(f"Input file not found: {key}")
        return path

    def _resolve_output(self, key: str) -> Path:
        path = resolve_storage_key(self.output_root, key)
        if path.suffix.lower() not in {".jpg", ".jpeg"}:
            raise ValueError("Output key must end with .jpg or .jpeg.")
        return path


def resolve_storage_key(root: Path, key: str) -> Path:
    if not key or Path(key).is_absolute():
        raise ValueError("Storage key must be a non-empty relative path.")
    resolved = (root / key).resolve()
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ValueError("Storage key must remain within its configured root.") from error
    return resolved


def read_jpeg_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as image:
        if image.read(2) != b"\xff\xd8":
            raise StitchError(f"Output is not a JPEG file: {path.name}")
        while True:
            marker_start = image.read(1)
            if not marker_start:
                break
            if marker_start != b"\xff":
                continue
            marker = image.read(1)
            while marker == b"\xff":
                marker = image.read(1)
            if marker in {b"\xd8", b"\xd9"}:
                continue
            length_bytes = image.read(2)
            if len(length_bytes) != 2:
                break
            segment_length = struct.unpack(">H", length_bytes)[0]
            if marker in {
                b"\xc0", b"\xc1", b"\xc2", b"\xc3", b"\xc5", b"\xc6", b"\xc7",
                b"\xc9", b"\xca", b"\xcb", b"\xcd", b"\xce", b"\xcf",
            }:
                precision_height_width = image.read(5)
                if len(precision_height_width) != 5:
                    break
                _, height, width = struct.unpack(">BHH", precision_height_width)
                return width, height
            image.seek(segment_length - 2, 1)
    raise StitchError(f"Could not read JPEG dimensions: {path.name}")
