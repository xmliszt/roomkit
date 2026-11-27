import os
import pathlib
import time

import numpy as np
from PIL import Image

WEIGHTS = pathlib.Path.home() / ".interior-planner/python/weights/sam3-mlx-bf16"
MIN_SCORE = 0.05


def load_sam3():
    """Load the SAM 3 MLX model and its processor from the local weights folder, with the CLIP tokenizer read from that folder."""
    os.environ["HF_HUB_OFFLINE"] = "1"
    from mlx_vlm.models.sam3.processing_sam3 import Sam3Processor
    from mlx_vlm.utils import load_model
    from transformers import CLIPTokenizerFast

    model = load_model(WEIGHTS)
    processor = Sam3Processor.from_pretrained(str(WEIGHTS))
    processor._tokenizer = CLIPTokenizerFast.from_pretrained(str(WEIGHTS))
    return model, processor


def detect(model, processor, image, box, name):
    """Return the scores and low-resolution mask logits of SAM 3's detections for `name` with `box` as the exemplar."""
    import mlx.core as mx

    pixel_values = mx.array(processor.preprocess_image(image)["pixel_values"])
    text = processor.preprocess_text(name)
    embeds, attention = model.get_input_embeddings(mx.array(text["input_ids"]), mx.array(text["attention_mask"]))
    x0, y0, x1, y1 = (box[0] / image.width, box[1] / image.height, box[2] / image.width, box[3] / image.height)
    exemplar = mx.array([[[(x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0]]])
    outputs = model.detect(pixel_values, attention_mask=attention, boxes=exemplar, inputs_embeds=embeds)
    mx.eval(outputs)
    scores = 1 / (1 + np.exp(-np.array(outputs["pred_logits"][0]).reshape(-1)))
    if outputs.get("presence_logits") is not None:
        scores = scores / (1 + np.exp(-np.array(outputs["presence_logits"][0]).reshape(-1)))
    return scores, np.array(outputs["pred_masks"][0])


def box_overlap(low_mask, box, image):
    """Return the IoU between the low-resolution mask and `box`, measured on the mask grid."""
    h, w = low_mask.shape
    x0, y0 = int(box[0] / image.width * w), int(box[1] / image.height * h)
    x1, y1 = int(np.ceil(box[2] / image.width * w)), int(np.ceil(box[3] / image.height * h))
    inside = low_mask[y0:y1, x0:x1].sum()
    return inside / max(1, low_mask.sum() + (x1 - x0) * (y1 - y0) - inside)


def segment_sam3(model, processor, image, box, name):
    """Return the mask, as a bool array the size of `image`, of the detection above `MIN_SCORE` with the highest score times mask-to-`box` IoU (else the top-scoring detection), with its score and the seconds from photo to full-size mask."""
    start = time.perf_counter()
    scores, logits = detect(model, processor, image, box, name)
    candidates = [index for index in range(len(scores)) if scores[index] > MIN_SCORE] or [int(scores.argmax())]
    best = max(candidates, key=lambda index: scores[index] * box_overlap(logits[index] > 0, box, image))
    full = Image.fromarray(logits[best].astype(np.float32)).resize(image.size, Image.BILINEAR)
    mask = np.asarray(full) > 0
    return mask, float(scores[best]), time.perf_counter() - start
