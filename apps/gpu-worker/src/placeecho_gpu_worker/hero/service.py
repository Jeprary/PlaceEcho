from typing import Protocol

from .contracts import (
    HeroArtifact,
    HeroGenerationRequest,
    Sam3MaskArtifact,
    Sam3MaskRequest,
    Trellis2Request,
    validate_prompt,
    validate_storage_key,
)


class RuntimeUnavailable(RuntimeError):
    """Raised when a model runtime was not provisioned or failed readiness checks."""


class Sam3Backend(Protocol):
    def create_mask(self, request: Sam3MaskRequest) -> Sam3MaskArtifact: ...


class Trellis2Backend(Protocol):
    def generate(self, request: Trellis2Request) -> HeroArtifact: ...


class HeroGenerationService:
    """Coordinates optional SAM 3 masking with a single-image TRELLIS.2 call.

    The service is dependency-injected so importing it does not import PyTorch,
    allocate GPU memory, read checkpoints, or download anything.
    """

    def __init__(
        self,
        trellis2: Trellis2Backend,
        sam3: Sam3Backend | None = None,
    ) -> None:
        self._trellis2 = trellis2
        self._sam3 = sam3

    def generate(self, request: HeroGenerationRequest) -> HeroArtifact:
        validate_storage_key(request.input_key, "input_key")
        validate_storage_key(request.output_key, "output_key")
        if not request.output_key.lower().endswith(".glb"):
            raise ValueError("TRELLIS.2 output_key must end with .glb.")
        if request.seed is not None and request.seed < 0:
            raise ValueError("TRELLIS.2 seed must be non-negative.")

        effective_mask_key: str | None = None
        if request.sam3_prompt is not None:
            if request.mask_key is None:
                raise ValueError("SAM 3 preprocessing requires a mask_key.")
            if self._sam3 is None:
                raise RuntimeUnavailable("SAM 3 preprocessing is not configured.")
            validate_storage_key(request.mask_key, "mask_key")
            validate_prompt(request.sam3_prompt)
            mask = self._sam3.create_mask(
                Sam3MaskRequest(
                    input_key=request.input_key,
                    output_mask_key=request.mask_key,
                    prompt=request.sam3_prompt,
                )
            )
            if mask.mask_key != request.mask_key:
                raise RuntimeError("SAM 3 returned a mask key different from the request.")
            effective_mask_key = mask.mask_key
        elif request.mask_key is not None:
            validate_storage_key(request.mask_key, "mask_key")
            effective_mask_key = request.mask_key

        artifact = self._trellis2.generate(
            Trellis2Request(
                input_key=request.input_key,
                mask_key=effective_mask_key,
                output_key=request.output_key,
                seed=request.seed,
            )
        )
        if artifact.asset_key != request.output_key or artifact.format != "glb":
            raise RuntimeError("TRELLIS.2 returned an unexpected output artifact.")
        return artifact
