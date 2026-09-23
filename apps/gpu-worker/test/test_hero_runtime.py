import unittest

from placeecho_gpu_worker.hero.contracts import (
    HeroArtifact,
    HeroGenerationRequest,
    Sam3MaskArtifact,
    Sam3Prompt,
)
from placeecho_gpu_worker.hero.probe import (
    TRELLIS2_OFFICIAL_MINIMUM_VRAM_MIB,
    GpuInspection,
    PythonInspection,
    evaluate_sam3,
    evaluate_trellis2,
)
from placeecho_gpu_worker.hero.service import HeroGenerationService


class FakeSam3:
    def __init__(self) -> None:
        self.requests = []

    def create_mask(self, request):
        self.requests.append(request)
        return Sam3MaskArtifact(request.output_mask_key, 1024, 1024, 0.9)


class FakeTrellis2:
    def __init__(self) -> None:
        self.requests = []

    def generate(self, request):
        self.requests.append(request)
        return HeroArtifact(request.output_key, elapsed_ms=100)


class HeroGenerationServiceTests(unittest.TestCase):
    def test_generates_from_one_image_without_segmentation(self) -> None:
        provider = FakeTrellis2()
        service = HeroGenerationService(provider)

        result = service.generate(
            HeroGenerationRequest("heroes/input.jpg", "heroes/model.glb", seed=3)
        )

        self.assertEqual(result.asset_key, "heroes/model.glb")
        self.assertIsNone(provider.requests[0].mask_key)

    def test_optionally_runs_sam3_before_trellis2(self) -> None:
        sam3 = FakeSam3()
        provider = FakeTrellis2()
        service = HeroGenerationService(provider, sam3)

        service.generate(
            HeroGenerationRequest(
                input_key="heroes/input.jpg",
                output_key="heroes/model.glb",
                sam3_prompt=Sam3Prompt(type="text", text="the ceramic cup"),
                mask_key="heroes/mask.png",
            )
        )

        self.assertEqual(sam3.requests[0].output_mask_key, "heroes/mask.png")
        self.assertEqual(provider.requests[0].mask_key, "heroes/mask.png")

    def test_accepts_a_mask_from_a_separate_sam3_service(self) -> None:
        provider = FakeTrellis2()
        service = HeroGenerationService(provider)

        service.generate(
            HeroGenerationRequest(
                input_key="heroes/input.jpg",
                output_key="heroes/model.glb",
                mask_key="heroes/precomputed-mask.png",
            )
        )

        self.assertEqual(provider.requests[0].mask_key, "heroes/precomputed-mask.png")

    def test_rejects_storage_key_traversal(self) -> None:
        service = HeroGenerationService(FakeTrellis2())
        with self.assertRaisesRegex(ValueError, "safe relative storage key"):
            service.generate(HeroGenerationRequest("../private.jpg", "hero.glb"))


class RuntimeProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runtime = PythonInspection(
            executable="/venv/bin/python",
            available=True,
            python_version="3.12.3",
            torch_version="2.7.1+cu128",
            cuda_version="12.8",
            cuda_available=True,
            modules={"torch": True, "sam3": True, "trellis2": True},
        )

    def test_sam3_requires_checkpoint_access_acknowledgement(self) -> None:
        result = evaluate_sam3(
            self.runtime,
            GpuInspection("NVIDIA A10", 23028),
            source_present=True,
            checkpoint_present=True,
            checkpoint_access_acknowledged=False,
        )
        self.assertFalse(result.ready)
        self.assertTrue(any("access" in blocker for blocker in result.blockers))

    def test_a10_reported_memory_is_below_trellis2_official_minimum(self) -> None:
        result = evaluate_trellis2(
            self.runtime,
            GpuInspection("NVIDIA A10", 23028),
            source_present=True,
            checkpoint_present=True,
        )
        self.assertFalse(result.ready)
        self.assertEqual(result.official_minimum_vram_mib, 24 * 1024)
        self.assertTrue(any("below" in blocker for blocker in result.blockers))

    def test_trellis2_becomes_probe_ready_at_minimum_memory(self) -> None:
        result = evaluate_trellis2(
            self.runtime,
            GpuInspection("NVIDIA A100", TRELLIS2_OFFICIAL_MINIMUM_VRAM_MIB),
            source_present=True,
            checkpoint_present=True,
        )
        self.assertTrue(result.ready)


if __name__ == "__main__":
    unittest.main()
