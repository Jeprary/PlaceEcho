import json
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
import requests

from qwen_panorama.api import edit_image
from qwen_panorama.geometry import (compose_patch, inverse_map, outside_changes,
                                   perspective, read_mask, save_panorama_jpeg)


class GeometryTests(unittest.TestCase):
    def settings(self, pitch=0, yaw=0):
        return {'width': 33, 'height': 33, 'yaw': yaw, 'pitch': pitch, 'hfov': 90,
                'crop': [0, 0, 33, 33]}

    def test_projection_orientation_and_poles(self):
        source = np.zeros((128, 256, 3), np.uint8)
        source[..., 0] = np.arange(256)[None, :]
        source[..., 1] = np.arange(128)[:, None]
        source[-1, :, 2] = 231
        source[0, :, 2] = 17
        np.testing.assert_array_equal(perspective(source, self.settings())[16, 16], source[64, 128])
        np.testing.assert_array_equal(perspective(source, self.settings(yaw=90))[16, 16], source[64, 192])
        self.assertEqual(int(perspective(source, self.settings(pitch=-90))[16, 16, 2]), 231)
        self.assertEqual(int(perspective(source, self.settings(pitch=90))[16, 16, 2]), 17)

    def test_inverse_only_modifies_mask_and_wraps_nadir(self):
        source = np.full((128, 256, 3), 80, np.uint8)
        edited = np.full((33, 33, 3), [230, 10, 30], np.uint8)
        mask = np.zeros((33, 33), bool)
        mask[8:25, 8:25] = True
        output, support = inverse_map(source, edited, mask, self.settings(pitch=-90), feather=2)
        self.assertEqual(outside_changes(source, output, support), 0)
        self.assertTrue((support[-1] > 0).all())
        self.assertFalse(support[:64].any())
        self.assertGreater(int(output[-1, 0, 0]), 200)
        np.testing.assert_array_equal(output[-1, 0], output[-1, -1])

    def test_composite_exterior_exact_and_mask_validation(self):
        source = np.full((40, 40, 3), 100, np.uint8)
        generated = np.full((80, 80, 3), 160, np.uint8)
        mask = np.zeros((40, 40), bool)
        mask[10:30, 10:30] = True
        output, _ = compose_patch(source, generated, mask, colour_match=False)
        np.testing.assert_array_equal(output[~mask], source[~mask])
        self.assertEqual(int(output[20, 20, 0]), 160)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'mask.png'
            Image.fromarray(np.zeros((40, 40), np.uint8)).save(path)
            with self.assertRaisesRegex(ValueError, 'empty'):
                read_mask(path, (40, 40))

    def test_jpeg_contains_correct_panorama_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'panorama.jpg'
            save_panorama_jpeg(path, np.zeros((64, 128, 3), np.uint8))
            with Image.open(path) as image:
                self.assertEqual(image.size, (128, 64))
                self.assertIn(b'GPano:FullPanoWidthPixels="128"', image.info['xmp'])


class ApiTests(unittest.TestCase):
    def test_download_resume_does_not_generate_again(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            image = folder / 'input.png'
            Image.new('RGB', (32, 32)).save(image)
            encoded = io.BytesIO()
            Image.new('RGB', (64, 64), 'gray').save(encoded, format='PNG')
            generated = unittest.mock.Mock(status_code=200)
            generated.json.return_value = {'request_id': 'r1', 'output': {'choices': [{'message': {'content': [{'image': 'https://example.aliyuncs.com/image.png'}]}}]}}
            downloaded = unittest.mock.Mock(content=encoded.getvalue())
            with patch('qwen_panorama.api.load_settings', return_value=('https://example.maas.aliyuncs.com/api', 'TEST_SECRET')):
                with patch('qwen_panorama.api.requests.post', return_value=generated) as post:
                    with patch('qwen_panorama.api.requests.get', side_effect=[requests.Timeout, downloaded]):
                        with self.assertRaisesRegex(RuntimeError, 'download failed'):
                            edit_image(image, 'remove rig', 'qwen-image-3.0-pro', {'n': 1}, folder)
                        self.assertTrue((folder / '.private_result.json').exists())
                        edit_image(image, 'remove rig', 'qwen-image-3.0-pro', {'n': 1}, folder)
                        self.assertEqual(post.call_count, 1)
                        self.assertFalse((folder / '.private_result.json').exists())
                        self.assertTrue((folder / 'model_raw.png').exists())

    def test_quota_error_logged_without_key_or_model_fallback(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            image = folder / 'input.png'
            Image.new('RGB', (32, 32)).save(image)
            fake = unittest.mock.Mock(status_code=403)
            fake.json.return_value = {'code': 'AllocationQuota.FreeTierOnly', 'message': 'quota TEST_SECRET', 'request_id': 'test'}
            with patch('qwen_panorama.api.load_settings', return_value=('https://example.maas.aliyuncs.com/api', 'TEST_SECRET')):
                with patch('qwen_panorama.api.requests.post', return_value=fake) as post:
                    with self.assertRaisesRegex(RuntimeError, 'AllocationQuota.FreeTierOnly'):
                        edit_image(image, 'remove rig', 'qwen-image-3.0-pro', {'n': 1}, folder)
                    self.assertEqual(post.call_count, 1)
                    self.assertEqual(post.call_args.kwargs['json']['model'], 'qwen-image-3.0-pro')
            saved = (folder / 'request_metadata.json').read_text()
            self.assertNotIn('TEST_SECRET', saved)
            self.assertEqual(json.loads(saved)['status'], 'api_rejected')

    def test_timeout_does_not_automatically_repeat_a_paid_call(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            image = folder / 'input.png'
            Image.new('RGB', (32, 32)).save(image)
            with patch('qwen_panorama.api.load_settings', return_value=('https://example.maas.aliyuncs.com/api', 'TEST_SECRET')):
                with patch('qwen_panorama.api.requests.post', side_effect=requests.Timeout) as post:
                    with self.assertRaisesRegex(RuntimeError, 'unknown'):
                        edit_image(image, 'remove rig', 'qwen-image-3.0-pro', {'n': 1}, folder)
                    with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                        edit_image(image, 'remove rig', 'qwen-image-3.0-pro', {'n': 1}, folder)
                    self.assertEqual(post.call_count, 1)


if __name__ == '__main__':
    unittest.main()
