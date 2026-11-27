import os


def load(weights):
    os.environ["HF_HUB_OFFLINE"] = "1"
    import torch
    from transformers import Sam2Model, Sam2Processor

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    processor = Sam2Processor.from_pretrained(weights, local_files_only=True)
    model = Sam2Model.from_pretrained(weights, local_files_only=True, use_safetensors=True).to(device).eval()

    def predict(*, image, box, name):
        inputs = processor(images=image, input_boxes=[[box]], return_tensors="pt").to(device)
        with torch.no_grad():
            embeddings = model.get_image_embeddings(inputs["pixel_values"])
            outputs = model(input_boxes=inputs["input_boxes"], image_embeddings=embeddings, multimask_output=True)
            masks = processor.post_process_masks(outputs.pred_masks.cpu(), inputs["original_sizes"])[0][0].numpy().astype(bool)
            scores = outputs.iou_scores[0, 0].cpu().numpy()
            x0, y0, x1, y1 = box
            candidates = [index for index in range(len(masks)) if scores[index] >= scores.max() - 0.1 and masks[index][y0:y1, x0:x1].sum() / max(1, masks[index].sum()) >= 0.95]
            best = max(candidates, key=lambda index: masks[index].sum()) if candidates else int(scores.argmax())
        return masks[best], float(scores[best])

    return predict
