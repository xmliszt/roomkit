"""Convert the HEIC photos to upright JPEGs and record each photo's lens and intrinsics."""

import argparse
import json
from pathlib import Path
import sys

from PIL import ExifTags, Image, ImageOps
from pillow_heif import register_heif_opener

from paths import JPEG_DIR, OUT_DIR

LONG_SIDE_PX = 1568


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("photo_dir", type=Path)
    photo_dir = parser.parse_args().photo_dir
    register_heif_opener()
    JPEG_DIR.mkdir(parents=True, exist_ok=True)
    photos = []
    for src in sorted(photo_dir.glob("*.HEIC")):
        img = Image.open(src)
        exif = img.getexif()
        sub = exif.get_ifd(ExifTags.IFD.Exif)
        upright = ImageOps.exif_transpose(img).convert("RGB")
        upright.thumbnail((LONG_SIDE_PX, LONG_SIDE_PX), Image.Resampling.LANCZOS)
        upright.save(JPEG_DIR / f"{src.stem}.jpg", quality=92)
        width, height = upright.size
        focal_35mm = sub.get(ExifTags.Base.FocalLengthIn35mmFilm)
        # 35 mm equivalent focal length is defined against the 43.27 mm film diagonal.
        diag_px = (width**2 + height**2) ** 0.5
        focal_px = float(focal_35mm) * diag_px / 43.2666 if focal_35mm else None
        photos.append(
            {
                "name": src.stem,
                "orientation": exif.get(ExifTags.Base.Orientation),
                "lens": sub.get(ExifTags.Base.LensModel),
                "focal_mm": float(sub.get(ExifTags.Base.FocalLength) or 0),
                "focal_35mm": focal_35mm,
                "width": width,
                "height": height,
                "focal_px": focal_px,
            }
        )
        print(src.stem, width, height, focal_35mm, sub.get(ExifTags.Base.LensModel), file=sys.stderr)
    (OUT_DIR / "photos.json").write_text(json.dumps(photos, indent=2))


if __name__ == "__main__":
    main()
