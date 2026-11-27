import json

import numpy as np
import pytest
from PIL import Image

import segment
from sam3 import box_overlap


def request_for(*, tmp_path, views=1, model="sam3"):
    photo = tmp_path / "photo.png"
    Image.new("RGB", (30, 20)).save(photo)
    return {
        "weightsDir": str(tmp_path / "weights"),
        "outputDir": str(tmp_path / "masks"),
        "model": model,
        "objects": [{"objectId": "sofa", "name": "sofa", "views": [
            {"photoId": f"view-{index}", "path": str(photo), "box": [2, 3, 25, 17]} for index in range(views)
        ]}],
    }


def box_prediction(*, image, box, name):
    mask = np.zeros((image.height, image.width), dtype=bool)
    x0, y0, x1, y1 = box
    mask[y0:y1, x0:x1] = True
    return mask, 0.9


def test_segments_every_view_with_one_model_load(tmp_path, monkeypatch):
    loaded = []

    def load(**kwargs):
        loaded.append(kwargs)
        return box_prediction

    monkeypatch.setattr(segment, "load_backend", load)
    request = request_for(tmp_path=tmp_path, views=3)
    result = segment.run(request)
    assert [call["model"] for call in loaded] == ["sam3"]
    views = result["objects"][0]["views"]
    assert len(views) == 3
    for view in views:
        with Image.open(tmp_path / "masks" / view["maskPath"]) as image:
            assert image.size == (30, 20)
            assert set(np.unique(image)) == {0, 255}
        assert view["shareInBox"] == 1
        assert view["durationSeconds"] >= 0
        assert view["model"] == "sam3"
    assert json.loads((tmp_path / "masks" / "masks.json").read_text()) == {"version": 1, **result}


@pytest.mark.parametrize("failure", ["load", "predict", "empty"])
def test_fallback_handles_model_failure_once(tmp_path, monkeypatch, failure):
    loaded = []

    def load(*, model, weights_dir):
        loaded.append(model)
        if model == "sam2.1":
            return box_prediction
        if failure == "load":
            raise RuntimeError("missing SAM 3 weights")

        def predict(**kwargs):
            if failure == "predict":
                raise RuntimeError("SAM 3 inference failed")
            return np.zeros((20, 30), dtype=bool), 0.8

        return predict

    monkeypatch.setattr(segment, "load_backend", load)
    result = segment.run(request_for(tmp_path=tmp_path, views=2))
    assert loaded == ["sam3", "sam2.1"]
    assert all(view["model"] == "sam2.1" and view["fallbackReason"] for view in result["objects"][0]["views"])


def test_fallback_failure_propagates(tmp_path, monkeypatch):
    def load(**kwargs):
        raise RuntimeError("weights unavailable")

    monkeypatch.setattr(segment, "load_backend", load)
    with pytest.raises(RuntimeError, match="weights unavailable"):
        segment.run(request_for(tmp_path=tmp_path))


@pytest.mark.parametrize("box", [[0, 0, 31, 20], [2, 3, 1, 5], [1.2, 2, 3, 4], [0, 0, 2]])
def test_rejects_invalid_box_before_loading_model(tmp_path, monkeypatch, box):
    def load(**kwargs):
        pytest.fail("invalid box must not load weights")

    monkeypatch.setattr(segment, "load_backend", load)
    request = request_for(tmp_path=tmp_path)
    request["objects"][0]["views"][0]["box"] = box
    with pytest.raises(ValueError, match="box"):
        segment.run(request)


def test_mask_box_iou_uses_mask_grid():
    image = Image.new("RGB", (100, 100))
    mask = np.zeros((10, 10), dtype=bool)
    mask[2:5, 3:8] = True
    assert box_overlap(mask=mask, box=[30, 20, 80, 50], image=image) == 1
    assert box_overlap(mask=mask, box=[0, 0, 10, 10], image=image) == 0
