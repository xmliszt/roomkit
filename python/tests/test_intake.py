import json
from pathlib import Path

import numpy as np
import pytest
from PIL import ExifTags, Image

import intake


def make_photo(*, path, orientation=1, size=(80, 40), flat=False):
    pixels = np.full((size[1], size[0], 3), 128, dtype=np.uint8) if flat else np.random.default_rng(3).integers(0, 256, (size[1], size[0], 3), dtype=np.uint8)
    exif = Image.Exif()
    exif[ExifTags.Base.Orientation] = orientation
    exif[ExifTags.IFD.Exif] = {
        ExifTags.Base.FocalLength: 5.96,
        ExifTags.Base.FocalLengthIn35mmFilm: 26,
        ExifTags.Base.LensModel: "phone wide lens",
    }
    Image.fromarray(pixels).save(path, exif=exif)
    return {"photoId": "photo-1", "path": str(path)}


def test_applies_orientation_once_and_preserves_lens(tmp_path):
    source = make_photo(path=tmp_path / "source.jpg", orientation=6)
    original = Path(source["path"]).read_bytes()
    output = tmp_path / "out"
    result = intake.run({"photos": [source], "outputDir": str(output)})
    entry = result["photos"][0]
    assert entry["kind"] == "accepted"
    assert (entry["widthPx"], entry["heightPx"]) == (40, 80)
    assert entry["orientation"] == 6
    assert entry["lens"] == "phone wide lens"
    assert entry["focalLengthMm"] == pytest.approx(5.96)
    assert entry["focalLength35Mm"] == 26
    assert entry["focalLengthPx"] > 0
    with Image.open(output / entry["uprightPath"]) as image:
        assert image.size == (40, 80)
        assert image.getexif().get(ExifTags.Base.Orientation) is None
    assert Path(source["path"]).read_bytes() == original
    assert json.loads((output / "photos.json").read_text()) == {"version": 1, **result}


def test_vision_is_1568_pixels_without_resizing_upright(tmp_path):
    source = make_photo(path=tmp_path / "source.png", size=(2000, 1000))
    output = tmp_path / "out"
    entry = intake.run({"photos": [source], "outputDir": str(output)})["photos"][0]
    with Image.open(output / entry["uprightPath"]) as image:
        assert image.size == (2000, 1000)
    with Image.open(output / entry["visionPath"]) as image:
        assert image.size == (1568, 784)
    assert (entry["visionWidthPx"], entry["visionHeightPx"]) == (1568, 784)


def test_rejects_blur_without_a_usable_image_path(tmp_path):
    source = make_photo(path=tmp_path / "source.png", flat=True)
    output = tmp_path / "out"
    entry = intake.run({"photos": [source], "outputDir": str(output)})["photos"][0]
    assert entry["kind"] == "rejected"
    assert entry["reason"] == "blur"
    assert entry["blurScore"] == 0
    assert "uprightPath" not in entry
    assert "visionPath" not in entry
    assert not (output / "upright").exists()


@pytest.mark.parametrize("photo_id", ["../outside", "__proto__", "bad/id", ""])
def test_rejects_unsafe_ids(tmp_path, photo_id):
    with pytest.raises(ValueError, match="safe identifiers"):
        intake.run({"photos": [{"photoId": photo_id, "path": "unused"}], "outputDir": str(tmp_path)})


def test_refuses_source_overwrite(tmp_path):
    output = tmp_path / "out"
    (output / "upright").mkdir(parents=True)
    source = make_photo(path=output / "upright" / "photo-1.jpg")
    before = Path(source["path"]).read_bytes()
    with pytest.raises(ValueError, match="overwrite"):
        intake.run({"photos": [source], "outputDir": str(output)})
    assert Path(source["path"]).read_bytes() == before


def test_heic_conversion_uses_upright_pixels(tmp_path):
    from pillow_heif import from_pillow

    source_path = tmp_path / "source.heic"
    image = Image.fromarray(np.random.default_rng(9).integers(0, 256, (40, 80, 3), dtype=np.uint8))
    from_pillow(image).save(source_path)
    output = tmp_path / "out"
    entry = intake.run({"photos": [{"photoId": "heic-photo", "path": str(source_path)}], "outputDir": str(output)})["photos"][0]
    with Image.open(output / entry["uprightPath"]) as converted:
        assert converted.format == "JPEG"
        assert converted.size == (80, 40)
