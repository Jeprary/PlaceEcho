"""Isolated Hero Object runtime contracts.

Model packages and checkpoints are intentionally optional and are never imported
from the panorama worker's main process.
"""

from .contracts import (
    HeroArtifact,
    HeroGenerationRequest,
    Sam3MaskArtifact,
    Sam3MaskRequest,
    Sam3Prompt,
    Trellis2Request,
)
from .service import HeroGenerationService, RuntimeUnavailable

__all__ = [
    "HeroArtifact",
    "HeroGenerationRequest",
    "HeroGenerationService",
    "RuntimeUnavailable",
    "Sam3MaskArtifact",
    "Sam3MaskRequest",
    "Sam3Prompt",
    "Trellis2Request",
]
