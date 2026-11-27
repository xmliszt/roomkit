"""S3 checks: SAM 2.1 mask on MPS against CPU, the three multimask outputs for the floor lamp, and the largest multimask inside each box."""

import json
import pathlib

import torch

from segment import OUT, load_photo, save_overlay, share_in_box
from segment_sam21 import load_model, segment

HERE = pathlib.Path(__file__).resolve().parent
MIN_SHARE_IN_BOX = 0.95


def main():
    boxes = {entry["object"]: entry for entry in json.loads((HERE / "boxes.json").read_text())}
    results = {}
    for device in ["mps", "cpu"]:
        processor, model = load_model(device)
        for name in ["fridge", "floor lamp"]:
            entry = boxes[name]
            image = load_photo(entry["photo"])
            segment(processor, model, device, image, entry["box"])
            mask, score, encode_s, decode_s = segment(processor, model, device, image, entry["box"])
            results[(device, name)] = mask
            print(f"{device} {name:<10} {encode_s + decode_s:5.2f} s  score {score:.2f}")
    for name in ["fridge", "floor lamp"]:
        a, b = results[("mps", name)], results[("cpu", name)]
        print(f"MPS vs CPU IoU {name}: {(a & b).sum() / (a | b).sum():.4f}")

    processor, model = load_model("mps")
    entry = boxes["floor lamp"]
    image = load_photo(entry["photo"])
    inputs = processor(images=image, input_boxes=[[entry["box"]]], return_tensors="pt").to("mps")
    with torch.no_grad():
        outputs = model(**inputs, multimask_output=True)
    masks = processor.post_process_masks(outputs.pred_masks.cpu(), inputs["original_sizes"])[0][0].numpy().astype(bool)
    for index, mask in enumerate(masks):
        score = float(outputs.iou_scores[0, 0, index].cpu())
        save_overlay(image, mask, entry["box"], OUT / f"lamp_multimask_{index}.jpg")
        print(f"lamp multimask {index}: score {score:.2f}  area {mask.mean():.1%}")

    folder = OUT / "largest-in-box"
    folder.mkdir(parents=True, exist_ok=True)
    for entry in boxes.values():
        image = load_photo(entry["photo"])
        inputs = processor(images=image, input_boxes=[[entry["box"]]], return_tensors="pt").to("mps")
        with torch.no_grad():
            outputs = model(**inputs, multimask_output=True)
        masks = processor.post_process_masks(outputs.pred_masks.cpu(), inputs["original_sizes"])[0][0].numpy().astype(bool)
        inside = [share_in_box(mask, entry["box"]) for mask in masks]
        candidates = [index for index in range(len(masks)) if inside[index] >= MIN_SHARE_IN_BOX]
        top = int(outputs.iou_scores[0, 0].argmax())
        best = max(candidates, key=lambda index: masks[index].sum()) if candidates else top
        save_overlay(image, masks[best], entry["box"], folder / f"{entry['object'].replace(' ', '_')}.jpg")
        areas = "  ".join(f"{masks[i].mean():.1%}/{inside[i]:.0%}" for i in range(len(masks)))
        print(f"largest in box {entry['object']:<13} picks {best}, top score picks {top}  (area/in box: {areas})")


if __name__ == "__main__":
    main()
