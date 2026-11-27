import numpy as np
import torch
from PIL import Image
from spandrel import ImageModelDescriptor, ModelLoader


def patch_super_resolution(backend):
    from utils.image_super_utils import imageSuperNet

    def initialize(upsampler, config):
        checkpoint = torch.load(
            config.realesrgan_ckpt_path, map_location="cpu", weights_only=True
        )
        state_dict = (
            checkpoint["params_ema"] if "params_ema" in checkpoint else checkpoint["params"]
        )
        model = ModelLoader(backend.device).load_from_state_dict(state_dict)
        if not isinstance(model, ImageModelDescriptor) or model.scale != 4:
            raise ValueError("Expected a 4× RealESRGAN image model")
        upsampler.model = model.half() if backend.is_cuda_like else model

    def upscale(upsampler, image):
        model = upsampler.model
        pixels = torch.from_numpy(np.array(image.convert("RGB")))
        bgr = pixels[..., [2, 1, 0]].permute(2, 0, 1).unsqueeze(0)
        tensor = (bgr.to(device=model.device, dtype=torch.float32) / 255).to(
            dtype=model.dtype
        )
        output = model(tensor)[0].float().cpu()
        rgb = output[[2, 1, 0]].permute(1, 2, 0).mul(255).round().to(torch.uint8)
        return Image.fromarray(rgb.numpy())

    imageSuperNet.__init__ = initialize
    imageSuperNet.__call__ = upscale
