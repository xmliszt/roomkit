import os
import pathlib
import time

import torch

from segment import share_in_box

WEIGHTS = pathlib.Path.home() / ".interior-planner/python/weights/sam2.1-hiera-large"
MIN_SHARE_IN_BOX = 0.95
MAX_SCORE_GAP = 0.1


def load_model(device):
    """Load SAM 2.1 large from the local weights folder onto `device`."""
    os.environ["HF_HUB_OFFLINE"] = "1"
    from transformers import Sam2Model, Sam2Processor

    processor = Sam2Processor.from_pretrained(WEIGHTS)
    model = Sam2Model.from_pretrained(WEIGHTS).to(device).eval()
    return processor, model


def sync(device):
    if device == "mps":
        torch.mps.synchronize()


def segment(processor, model, device, image, box):
    """Return the largest of SAM's three masks for `box` that scores within `MAX_SCORE_GAP` of the best and lies at least `MIN_SHARE_IN_BOX` inside the box (else the best-scoring mask), as a bool array the size of `image`, with its score, the preprocess-and-encode seconds and the decode seconds."""
    start = time.perf_counter()
    inputs = processor(images=image, input_boxes=[[box]], return_tensors="pt").to(device)
    with torch.no_grad():
        embeddings = model.get_image_embeddings(inputs["pixel_values"])
        sync(device)
        encoded = time.perf_counter()
        outputs = model(input_boxes=inputs["input_boxes"], image_embeddings=embeddings, multimask_output=True)
        masks = processor.post_process_masks(outputs.pred_masks.cpu(), inputs["original_sizes"])[0][0].numpy().astype(bool)
        scores = outputs.iou_scores[0, 0].cpu().numpy()
        candidates = [
            index
            for index in range(len(masks))
            if scores[index] >= scores.max() - MAX_SCORE_GAP and share_in_box(masks[index], box) >= MIN_SHARE_IN_BOX
        ]
        best = max(candidates, key=lambda index: masks[index].sum()) if candidates else int(scores.argmax())
        decoded = time.perf_counter()
    return masks[best], float(scores[best]), encoded - start, decoded - encoded
