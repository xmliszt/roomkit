"""Build compare.png: one row per object with its photo crop and the three.js screenshots without and with the
environment map, labelled tuned or held-out, with the object's size under each row.

python compose.py --photos <dir> --models <dir with <object>/shot-*.png> --output compare.png [--only <object>...]
"""

import argparse
import json
import pathlib

from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
ROW_HEIGHT_PX = 560
GAP_PX = 16
LABEL_PX = 60
CAPTION_PX = 24
BACKGROUND = "#F4F1EA"
INK = "#2b2a27"
MUTED = "#76726a"
COLUMNS = [("photo", "Photo"), ("shot-plain.png", "three.js, key + ambient"), ("shot-environment.png", "three.js, + environment map")]


def font(size):
    for path in ["/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/SFNS.ttf"]:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def size_text(spec):
    size = spec["sizeM"]
    dims = " × ".join(f"{size[key] * 100:g}" for key in ("width", "depth", "height"))
    return f"{dims} cm (W × D × H), {spec['sizeSource']}"


def fit(image):
    return image.resize((round(ROW_HEIGHT_PX * image.width / image.height), ROW_HEIGHT_PX), Image.LANCZOS)


def row(spec, photos, models):
    photo = Image.open(photos / f"{spec['bestPhoto']}.jpg")
    x0, y0, x1, y1 = spec["box"]
    tiles = [fit(photo.crop((round(x0 * photo.width), round(y0 * photo.height), round(x1 * photo.width), round(y1 * photo.height))))]
    tiles += [fit(Image.open(models / spec["name"] / file).convert("RGB")) for file, _ in COLUMNS[1:]]
    width = sum(tile.width for tile in tiles) + GAP_PX * (len(tiles) - 1)
    image = Image.new("RGB", (width, CAPTION_PX + ROW_HEIGHT_PX + LABEL_PX), BACKGROUND)
    draw = ImageDraw.Draw(image)
    left = 0
    for tile, (_, caption) in zip(tiles, COLUMNS):
        draw.text((left + 2, 2), caption, fill=MUTED, font=font(15))
        image.paste(tile, (left, CAPTION_PX))
        left += tile.width + GAP_PX
    top = CAPTION_PX + ROW_HEIGHT_PX
    draw.text((2, top + 8), f"{spec['label']}  ·  {spec['set']}", fill=INK, font=font(22))
    draw.text((2, top + 36), f"{size_text(spec)}  ·  photo {spec['bestPhoto']}", fill=MUTED, font=font(15))
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--photos", required=True, type=pathlib.Path)
    parser.add_argument("--models", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--only", nargs="*")
    args = parser.parse_args()

    objects = json.loads((HERE / "objects.json").read_text())["objects"]
    rows = [row(spec, args.photos, args.models) for spec in objects if not args.only or spec["name"] in args.only]
    width = max(image.width for image in rows) + 2 * GAP_PX
    sheet = Image.new("RGB", (width, sum(image.height + GAP_PX for image in rows) + GAP_PX), BACKGROUND)
    top = GAP_PX
    for image in rows:
        sheet.paste(image, (GAP_PX, top))
        top += image.height + GAP_PX
    sheet.save(args.output)
    print(f"wrote {args.output} ({sheet.width} x {sheet.height})")


main()
