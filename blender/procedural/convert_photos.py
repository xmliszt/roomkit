"""Write an EXIF-oriented JPEG of every HEIC in a folder, skipping photos already converted.

python convert_photos.py --source ~/Downloads/Room --output <dir>
"""

import argparse
import pathlib

import pillow_heif
from PIL import Image, ImageOps


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    args = parser.parse_args()
    pillow_heif.register_heif_opener()
    args.output.mkdir(parents=True, exist_ok=True)
    converted = 0
    for heic in sorted(args.source.glob("*.HEIC")):
        target = args.output / f"{heic.stem}.jpg"
        if target.exists():
            continue
        ImageOps.exif_transpose(Image.open(heic)).convert("RGB").save(target, quality=92)
        converted += 1
    print(f"photos: {converted} converted, {len(list(args.output.glob('IMG_*.jpg')))} in {args.output}")


main()
