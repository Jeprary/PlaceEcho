from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from placeecho_trellis_worker.runtime import (
    GenerateRequest,
    TrellisGenerationService,
    resolve_storage_key,
)


class FakeBackend:
    loaded = True

    def __init__(self) -> None:
        self.calls: list[tuple[Path, Path, Path | None, int, float, int]] = []

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
        self.calls.append(
            (
                input_path,
                output_glb_path,
                output_ply_path,
                seed,
                simplify,
                texture_size,
            )
        )
        output_glb_path.write_bytes(b"mock-glb")
        if output_ply_path is not None:
            output_ply_path.write_bytes(b"mock-ply")


class TrellisGenerationTests(unittest.TestCase):
    def test_generates_glb_and_optional_ply_with_storage_keys(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            output_root = root / "output"
            input_path = input_root / "scene" / "object.png"
            input_path.parent.mkdir(parents=True)
            input_path.write_bytes(b"not-decoded-by-the-mock")
            backend = FakeBackend()
            service = TrellisGenerationService(input_root, output_root, backend)

            health = service.health()
            self.assertEqual(health["provider"], "trellis")
            self.assertTrue(health["runtime_ready"])
            self.assertTrue(health["model_loaded"])
            self.assertFalse(health["busy"])

            result = service.generate(
                GenerateRequest(
                    input_key="scene/object.png",
                    output_glb_key="scene/hero.glb",
                    output_ply_key="scene/hero.ply",
                    seed=7,
                    simplify=0.9,
                    texture_size=512,
                )
            )

            self.assertEqual(result.provider, "trellis")
            self.assertEqual(result.status, "completed")
            self.assertEqual((output_root / "scene/hero.glb").read_bytes(), b"mock-glb")
            self.assertEqual((output_root / "scene/hero.ply").read_bytes(), b"mock-ply")
            self.assertEqual(backend.calls[0][3:], (7, 0.9, 512))

    def test_rejects_input_path_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            with self.assertRaises(ValueError):
                resolve_storage_key(root, "../private.png")

    def test_rejects_non_glb_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            input_root.mkdir()
            (input_root / "object.jpg").write_bytes(b"mock")
            service = TrellisGenerationService(
                input_root, root / "output", FakeBackend()
            )
            with self.assertRaisesRegex(ValueError, "must end with .glb"):
                service.generate(
                    GenerateRequest(
                        input_key="object.jpg", output_glb_key="hero.obj"
                    )
                )


if __name__ == "__main__":
    unittest.main()
