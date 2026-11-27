from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

from reconstruction_preview import write_preview


class ReconstructionPreviewTest(unittest.TestCase):
    def test_points_keep_measured_positions_and_photo_colors(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            Image.new("RGB", (2, 1), (255, 128, 0)).save(folder / "photo.png")
            output = folder / "points.bin"
            scene = {
                "names": np.array(["photo"]),
                "world_points": np.array([[[[1, 2, 3], [float("nan"), 0, 0]]]]),
                "masks": np.ones((1, 1, 2), dtype=bool),
                "transforms": np.array([[1, 0, 0]]),
                "image_sizes": np.array([[2, 1]]),
            }
            photos = [{"kind": "accepted", "photoId": "photo", "visionPath": "photo.png"}]
            self.assertTrue(write_preview(scene=scene, photos=photos, photos_dir=folder, output_path=output))
            points = np.fromfile(output, dtype="<f4").reshape(8000, 6)
            np.testing.assert_allclose(points[:, :3], np.tile([1, 2, 3], (8000, 1)))
            np.testing.assert_allclose(points[:, 3:], np.tile([1, 128 / 255, 0], (8000, 1)))
            original = output.read_bytes()
            scene_path = folder / "scene.npz"
            np.savez_compressed(scene_path, **scene)
            photos_path = folder / "photos.json"
            photos_path.write_text(json.dumps({"photos": photos}))
            output.unlink()
            subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "workers/reconstruction_preview.py"), str(scene_path), str(photos_path), str(output)], check=True)
            self.assertEqual(output.read_bytes(), original)
            write_preview(scene=scene, photos=photos, photos_dir=folder, output_path=output)
            self.assertEqual(output.read_bytes(), original)
            scene["masks"][:] = False
            output.unlink()
            self.assertFalse(write_preview(scene=scene, photos=photos, photos_dir=folder, output_path=output))
            self.assertFalse(output.exists())
