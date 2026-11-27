import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import torch
from PIL import Image
from spandrel.architectures.ESRGAN.__arch.RRDB import RRDBNet

from patch_super_resolution import patch_super_resolution


class PatchSuperResolutionTest(unittest.TestCase):
    def test_paint_pipeline_can_keep_its_imported_upscaler_class(self):
        class ImageSuperNet:
            pass

        upstream = ModuleType("utils.image_super_utils")
        upstream.imageSuperNet = ImageSuperNet
        paint_upscaler = upstream.imageSuperNet
        backend = SimpleNamespace(device="cpu", is_cuda_like=False)
        model = RRDBNet(in_nc=3, out_nc=3, num_filters=8, num_blocks=1, scale=4)
        weights = {key: torch.zeros_like(weight) for key, weight in model.state_dict().items()}

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "realesrgan.pth"
            torch.save({"params_ema": weights}, path)
            with patch.dict(sys.modules, {upstream.__name__: upstream}):
                patch_super_resolution(backend)
                upscaler = paint_upscaler(SimpleNamespace(realesrgan_ckpt_path=path))
                output = upscaler(Image.new("RGB", (7, 5), (40, 90, 130)))

        self.assertEqual(output.mode, "RGB")
        self.assertEqual(output.size, (28, 20))
        self.assertIsNone(output.getbbox())
