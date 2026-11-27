"""S3 step 4: masks for the 4 measured pieces in every photo that shows them, by a box per photo and by SAM 2.1 video propagation."""

import json
import pathlib
import time

import numpy as np
import torch
from PIL import Image

from segment import OUT, load_photo, save_overlay, slug
from segment_sam21 import WEIGHTS, load_model, segment

HERE = pathlib.Path(__file__).resolve().parent
FRAME_SIZE = 1024
VIEWPOINTS = json.loads((HERE / "viewpoints.json").read_text())
VIEWPOINT_ORDER = VIEWPOINTS["order"]
BEST_PHOTO = VIEWPOINTS["bestPhoto"]


def pixel_box(entry, image):
    f = entry["boxFrac"]
    return [round(f[0] * image.width), round(f[1] * image.height), round(f[2] * image.width), round(f[3] * image.height)]


def iou(a, b):
    return (a & b).sum() / max(1, (a | b).sum())


def per_photo_boxes(processor, model):
    entries = json.loads((HERE / "boxes-all-photos.json").read_text())
    folder = OUT / "all-photos"
    folder.mkdir(parents=True, exist_ok=True)
    masks = {}
    warm_up = load_photo(entries[0]["photo"])
    segment(processor, model, "mps", warm_up, pixel_box(entries[0], warm_up))
    for entry in entries:
        image = load_photo(entry["photo"])
        box = pixel_box(entry, image)
        mask, score, encode_s, decode_s = segment(processor, model, "mps", image, box)
        stem = pathlib.Path(entry["photo"]).stem
        masks[(entry["object"], stem)] = mask
        save_overlay(image, mask, box, folder / f"{slug(entry['object'])}_{stem}.jpg")
        fill = mask.sum() / ((box[2] - box[0]) * (box[3] - box[1]))
        print(f"box   {entry['object']:<7} {stem}  {encode_s + decode_s:5.2f} s  score {score:.2f}  area {mask.mean():.1%}  mask/box {fill:.2f}")
    return masks


def propagate(processor, model, name, order, box_masks, label):
    """Propagate the mask of `name` from its best photo to the other photos in `order`, forward and backward, and print each frame's IoU with the per-photo box mask."""
    photos = [load_photo(f"{stem}.HEIC") for stem in order]
    frames = [np.asarray(photo.resize((FRAME_SIZE, FRAME_SIZE), Image.BILINEAR)) for photo in photos]
    session = processor.init_video_session(video=frames, inference_device="mps", dtype=torch.float32)
    prompt_index = order.index(BEST_PHOTO[name])
    first = box_masks[(name, order[prompt_index])]
    ys, xs = np.nonzero(first)
    sx, sy = FRAME_SIZE / photos[prompt_index].width, FRAME_SIZE / photos[prompt_index].height
    box = [float(xs.min() * sx), float(ys.min() * sy), float(xs.max() * sx), float(ys.max() * sy)]
    processor.add_inputs_to_inference_session(inference_session=session, frame_idx=prompt_index, obj_ids=1, input_boxes=[[box]])
    folder = OUT / "propagation" / label
    folder.mkdir(parents=True, exist_ok=True)
    start = time.perf_counter()
    results = {}
    with torch.no_grad():
        model(inference_session=session, frame_idx=prompt_index)
        for reverse in [False, True]:
            for output in model.propagate_in_video_iterator(session, start_frame_idx=prompt_index, reverse=reverse):
                low = processor.post_process_masks([output.pred_masks], original_sizes=[[FRAME_SIZE, FRAME_SIZE]], binarize=True)[0]
                results[output.frame_idx] = low[0, 0].cpu().numpy().astype(np.uint8) * 255
    for index in sorted(results):
        photo = photos[index]
        mask = np.asarray(Image.fromarray(results[index]).resize(photo.size, Image.NEAREST)) > 0
        reference = box_masks.get((name, order[index]))
        overlap = iou(mask, reference) if reference is not None else float("nan")
        ys, xs = np.nonzero(mask)
        crop = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if mask.any() else [0, 0, photo.width, photo.height]
        save_overlay(photo, mask, crop, folder / f"{slug(name)}_{index:02d}_{order[index]}.jpg")
        print(f"video {label:<9} {name:<7} {order[index]}  area {mask.mean():.1%}  IoU with box mask {overlap:.2f}")
    print(f"video {label} {name}: {len(order)} frames in {time.perf_counter() - start:.1f} s")


def main():
    from transformers import Sam2VideoModel, Sam2VideoProcessor

    processor, model = load_model("mps")
    box_masks = per_photo_boxes(processor, model)
    del model
    video_processor = Sam2VideoProcessor.from_pretrained(WEIGHTS)
    video_model = Sam2VideoModel.from_pretrained(WEIGHTS).to("mps").eval()
    propagate(video_processor, video_model, "sofa", VIEWPOINT_ORDER, box_masks, "viewpoint")
    for name in BEST_PHOTO:
        order = sorted(stem for (object_name, stem) in box_masks if object_name == name)
        propagate(video_processor, video_model, name, order, box_masks, "file-name")


if __name__ == "__main__":
    main()
