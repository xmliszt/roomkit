import os

import numpy as np
from PIL import Image


def box_overlap(*, mask, box, image):
    height, width = mask.shape
    x0, y0 = int(box[0] / image.width * width), int(box[1] / image.height * height)
    x1, y1 = int(np.ceil(box[2] / image.width * width)), int(np.ceil(box[3] / image.height * height))
    inside = mask[y0:y1, x0:x1].sum()
    return inside / max(1, mask.sum() + (x1 - x0) * (y1 - y0) - inside)


def load(weights):
    os.environ["HF_HUB_OFFLINE"] = "1"
    import mlx.core as mx
    from mlx_vlm.models.sam3.processing_sam3 import Sam3Processor
    from mlx_vlm.utils import load_model
    from transformers import CLIPTokenizerFast

    model = load_model(weights)
    processor = Sam3Processor.from_pretrained(str(weights))
    processor._tokenizer = CLIPTokenizerFast.from_pretrained(str(weights), local_files_only=True)

    def predict(*, image, box, name):
        pixels = mx.array(processor.preprocess_image(image)["pixel_values"])
        text = processor.preprocess_text(name)
        embeds, attention = model.get_input_embeddings(mx.array(text["input_ids"]), mx.array(text["attention_mask"]))
        exemplar = {}
        if box is not None:
            x0, y0, x1, y1 = (box[0] / image.width, box[1] / image.height, box[2] / image.width, box[3] / image.height)
            exemplar = {"boxes": mx.array([[[(x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0]]])}
        outputs = model.detect(pixels, attention_mask=attention, inputs_embeds=embeds, **exemplar)
        mx.eval(outputs)
        scores = 1 / (1 + np.exp(-np.array(outputs["pred_logits"][0]).reshape(-1)))
        if outputs.get("presence_logits") is not None:
            scores = scores / (1 + np.exp(-np.array(outputs["presence_logits"][0]).reshape(-1)))
        logits = np.array(outputs["pred_masks"][0])
        if not len(scores) or not np.isfinite(scores).all() or not np.isfinite(logits).all():
            raise ValueError("SAM 3 returned no finite detections")
        candidates = [index for index in range(len(scores)) if scores[index] > 0.05] or [int(scores.argmax())]
        if box is None:
            best = int(scores.argmax())
        else:
            best = max(candidates, key=lambda index: scores[index] * box_overlap(mask=logits[index] > 0, box=box, image=image))
        full = Image.fromarray(logits[best].astype(np.float32)).resize(image.size, Image.Resampling.BILINEAR)
        return np.asarray(full) > 0, float(scores[best])

    return predict
