import tempfile
import unittest
from pathlib import Path

from placeecho_gpu_worker.stitching import resolve_storage_key


class StorageKeyTests(unittest.TestCase):
    def test_resolves_relative_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.assertEqual(resolve_storage_key(root, "scene/input.insp"), root / "scene/input.insp")

    def test_rejects_parent_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            with self.assertRaises(ValueError):
                resolve_storage_key(root, "../secret")


if __name__ == "__main__":
    unittest.main()
