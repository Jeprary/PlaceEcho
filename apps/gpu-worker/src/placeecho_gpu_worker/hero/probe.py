from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable


TRELLIS2_OFFICIAL_MINIMUM_VRAM_MIB = 24 * 1024


@dataclass(frozen=True)
class PythonInspection:
    executable: str
    available: bool
    python_version: str | None
    torch_version: str | None
    cuda_version: str | None
    cuda_available: bool
    modules: dict[str, bool]
    error: str | None = None


@dataclass(frozen=True)
class GpuInspection:
    name: str | None
    memory_mib: int | None
    error: str | None = None


@dataclass(frozen=True)
class RuntimeReadiness:
    ready: bool
    blockers: list[str]
    warnings: list[str]
    python_version: str | None
    torch_version: str | None
    cuda_version: str | None
    gpu_name: str | None
    gpu_memory_mib: int | None
    checkpoint_present: bool
    source_present: bool
    checkpoint_access_acknowledged: bool | None = None
    official_minimum_vram_mib: int | None = None


@dataclass(frozen=True)
class HeroRuntimeProbe:
    sam3: RuntimeReadiness
    trellis2: RuntimeReadiness
    disk_free_gib: float | None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def inspect_python(executable: str, modules: tuple[str, ...]) -> PythonInspection:
    path = shutil.which(executable) if "/" not in executable else executable
    if path is None or not Path(path).is_file():
        return PythonInspection(executable, False, None, None, None, False, {}, "missing")
    script = """
import importlib.util, json, sys
modules = json.loads(sys.argv[1])
result = {
    "python_version": ".".join(str(value) for value in sys.version_info[:3]),
    "modules": {name: importlib.util.find_spec(name) is not None for name in modules},
    "torch_version": None,
    "cuda_version": None,
    "cuda_available": False,
}
if importlib.util.find_spec("torch") is not None:
    import torch
    result["torch_version"] = str(torch.__version__)
    result["cuda_version"] = str(torch.version.cuda) if torch.version.cuda else None
    result["cuda_available"] = bool(torch.cuda.is_available())
print(json.dumps(result))
"""
    try:
        completed = subprocess.run(
            [path, "-c", script, json.dumps(modules)],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if completed.returncode != 0:
            return PythonInspection(
                executable, False, None, None, None, False, {}, completed.stderr[-1000:]
            )
        payload = json.loads(completed.stdout)
        return PythonInspection(
            executable=executable,
            available=True,
            python_version=payload["python_version"],
            torch_version=payload["torch_version"],
            cuda_version=payload["cuda_version"],
            cuda_available=payload["cuda_available"],
            modules=payload["modules"],
        )
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        return PythonInspection(executable, False, None, None, None, False, {}, str(error))


def inspect_gpu() -> GpuInspection:
    try:
        completed = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        if completed.returncode != 0:
            return GpuInspection(None, None, completed.stderr[-1000:])
        first = completed.stdout.strip().splitlines()[0]
        name, memory = (part.strip() for part in first.rsplit(",", 1))
        return GpuInspection(name, int(memory))
    except (OSError, subprocess.TimeoutExpired, ValueError, IndexError) as error:
        return GpuInspection(None, None, str(error))


def evaluate_sam3(
    runtime: PythonInspection,
    gpu: GpuInspection,
    source_present: bool,
    checkpoint_present: bool,
    checkpoint_access_acknowledged: bool,
) -> RuntimeReadiness:
    blockers: list[str] = []
    warnings: list[str] = []
    if not source_present:
        blockers.append("SAM 3 source directory is missing.")
    if not runtime.available:
        blockers.append("SAM 3 isolated Python environment is missing or unusable.")
    if not _at_least(runtime.python_version, (3, 12)):
        blockers.append("SAM 3 requires Python 3.12 or newer.")
    if not runtime.modules.get("sam3", False):
        blockers.append("The sam3 package is not installed in its isolated environment.")
    if not _at_least(runtime.torch_version, (2, 7)):
        blockers.append("SAM 3 requires PyTorch 2.7 or newer.")
    if not _at_least(runtime.cuda_version, (12, 6)):
        blockers.append("SAM 3 requires a CUDA 12.6-or-newer PyTorch runtime.")
    if not runtime.cuda_available or gpu.memory_mib is None:
        blockers.append("SAM 3 cannot see an NVIDIA CUDA GPU.")
    if not checkpoint_access_acknowledged:
        blockers.append("SAM 3 checkpoint access has not been approved and acknowledged.")
    if not checkpoint_present:
        blockers.append("SAM 3 checkpoint is absent; the probe never downloads it automatically.")
    if runtime.error:
        warnings.append(f"Python inspection detail: {runtime.error}")
    return RuntimeReadiness(
        ready=not blockers,
        blockers=blockers,
        warnings=warnings,
        python_version=runtime.python_version,
        torch_version=runtime.torch_version,
        cuda_version=runtime.cuda_version,
        gpu_name=gpu.name,
        gpu_memory_mib=gpu.memory_mib,
        checkpoint_present=checkpoint_present,
        source_present=source_present,
        checkpoint_access_acknowledged=checkpoint_access_acknowledged,
    )


def evaluate_trellis2(
    runtime: PythonInspection,
    gpu: GpuInspection,
    source_present: bool,
    checkpoint_present: bool,
) -> RuntimeReadiness:
    blockers: list[str] = []
    warnings: list[str] = []
    if not source_present:
        blockers.append("TRELLIS.2 source directory is missing.")
    if not runtime.available:
        blockers.append("TRELLIS.2 isolated Python environment is missing or unusable.")
    if not runtime.modules.get("trellis2", False):
        blockers.append("The trellis2 package is not installed in its isolated environment.")
    if not runtime.modules.get("torch", False) or not runtime.cuda_available:
        blockers.append("TRELLIS.2 cannot use a CUDA-enabled PyTorch runtime.")
    if not checkpoint_present:
        blockers.append("TRELLIS.2 checkpoint is absent; the probe never downloads it automatically.")
    if gpu.memory_mib is None:
        blockers.append("TRELLIS.2 cannot detect GPU memory.")
    elif gpu.memory_mib < TRELLIS2_OFFICIAL_MINIMUM_VRAM_MIB:
        blockers.append(
            "Detected GPU memory is below TRELLIS.2's official 24 GiB minimum "
            f"({gpu.memory_mib} MiB < {TRELLIS2_OFFICIAL_MINIMUM_VRAM_MIB} MiB)."
        )
    if runtime.cuda_version and not _at_least(runtime.cuda_version, (12, 4)):
        warnings.append("TRELLIS.2 recommends CUDA 12.4; this runtime is older.")
    if gpu.name and not re.search(r"\b(?:A100|H100)\b", gpu.name, re.IGNORECASE):
        warnings.append(
            "TRELLIS.2 is officially tested on A100/H100; this GPU should be treated as a probe-only target."
        )
    if runtime.error:
        warnings.append(f"Python inspection detail: {runtime.error}")
    return RuntimeReadiness(
        ready=not blockers,
        blockers=blockers,
        warnings=warnings,
        python_version=runtime.python_version,
        torch_version=runtime.torch_version,
        cuda_version=runtime.cuda_version,
        gpu_name=gpu.name,
        gpu_memory_mib=gpu.memory_mib,
        checkpoint_present=checkpoint_present,
        source_present=source_present,
        official_minimum_vram_mib=TRELLIS2_OFFICIAL_MINIMUM_VRAM_MIB,
    )


def collect_runtime_probe(
    environ: dict[str, str] | None = None,
    python_inspector: Callable[[str, tuple[str, ...]], PythonInspection] = inspect_python,
    gpu_inspector: Callable[[], GpuInspection] = inspect_gpu,
) -> HeroRuntimeProbe:
    values = os.environ if environ is None else environ
    gpu = gpu_inspector()
    sam3_source = Path(values.get("SAM3_SOURCE_DIR", "/opt/placeecho/models/sam3"))
    sam3_checkpoint_value = values.get("SAM3_CHECKPOINT_PATH", "")
    sam3_checkpoint = Path(sam3_checkpoint_value) if sam3_checkpoint_value else None
    trellis2_source = Path(values.get("TRELLIS2_SOURCE_DIR", "/opt/placeecho/models/TRELLIS.2"))
    trellis2_checkpoint_value = values.get("TRELLIS2_CHECKPOINT_PATH", "")
    trellis2_checkpoint = (
        Path(trellis2_checkpoint_value) if trellis2_checkpoint_value else None
    )
    sam3_runtime = python_inspector(
        values.get("SAM3_PYTHON", "/opt/placeecho/venvs/sam3/bin/python"),
        ("torch", "sam3"),
    )
    trellis2_runtime = python_inspector(
        values.get("TRELLIS2_PYTHON", "/opt/placeecho/venvs/trellis2/bin/python"),
        ("torch", "trellis2"),
    )
    disk_path = Path(values.get("HERO_MODEL_ROOT", "/opt/placeecho/models"))
    try:
        disk_free_gib = round(shutil.disk_usage(disk_path).free / (1024**3), 2)
    except OSError:
        disk_free_gib = None
    return HeroRuntimeProbe(
        sam3=evaluate_sam3(
            sam3_runtime,
            gpu,
            sam3_source.is_dir(),
            sam3_checkpoint is not None and sam3_checkpoint.is_file(),
            values.get("SAM3_CHECKPOINT_ACCESS_APPROVED", "").lower()
            in {"1", "true", "yes"},
        ),
        trellis2=evaluate_trellis2(
            trellis2_runtime,
            gpu,
            trellis2_source.is_dir(),
            trellis2_checkpoint is not None and trellis2_checkpoint.exists(),
        ),
        disk_free_gib=disk_free_gib,
    )


def _at_least(version: str | None, minimum: tuple[int, ...]) -> bool:
    if not version:
        return False
    numbers = tuple(int(value) for value in re.findall(r"\d+", version)[: len(minimum)])
    return numbers >= minimum if len(numbers) == len(minimum) else False


def main() -> int:
    probe = collect_runtime_probe()
    print(json.dumps(probe.to_dict(), indent=2, sort_keys=True))
    return 0 if probe.sam3.ready and probe.trellis2.ready else 2


if __name__ == "__main__":
    raise SystemExit(main())
