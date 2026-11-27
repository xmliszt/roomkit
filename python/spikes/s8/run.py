import argparse
import hashlib
import json
import os
import resource
import threading
import time
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('candidate', choices=('flux', 'sdxl', 'depth'))
parser.add_argument('--input', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--weights', type=Path, required=True)
parser.add_argument('--strength', type=float, default=0.2)
args = parser.parse_args()
assert 0 < args.strength < 1
image = Image.open(args.input).convert('RGB')
assert image.size == (1920, 1280)
args.output.parent.mkdir(parents=True, exist_ok=True)
started = time.perf_counter()
stop = threading.Event()


def heartbeat():
    while not stop.wait(8):
        print(f'{args.candidate}: elapsed {time.perf_counter() - started:.1f}s', flush=True)


threading.Thread(target=heartbeat, daemon=True).start()
prompt = 'Photorealistic interior photograph, natural soft daylight, realistic materials, preserve the furniture, orange mushroom table lamp with a chrome base, green ribbed lounge chair, white cabinet, sheer curtains.'
result = dict(candidate=args.candidate, strength=args.strength, seed=42, size=image.size, prompt=prompt, input_pixel_sha256=hashlib.sha256(image.tobytes()).hexdigest())
if args.candidate == 'flux':
    os.environ.setdefault('MLX_MAX_OPS_PER_BUFFER', '1')
    os.environ.setdefault('MLX_MAX_MB_PER_BUFFER', '16')
    import mlx.core as mx
    from mflux.callbacks.instances.memory_saver import MemorySaver
    from mflux.models.common.config.model_config import ModelConfig
    from mflux.models.common.vae.tiling_config import TilingConfig
    from mflux.models.flux.variants.txt2img.flux import Flux1
    from chunk_attention import install_chunked_attention

    install_chunked_attention()
    mx.set_memory_limit(24 * 1024**3)
    mx.set_cache_limit(512 * 1024**2)
    model = Flux1(model_config=ModelConfig.schnell(), quantize=4, model_path=str(args.weights / 'flux'))
    model.tiling_config = TilingConfig()
    model.callbacks.register(MemorySaver(model=model, keep_transformer=False, cache_limit_bytes=None))
    loaded = time.perf_counter()
    output = model.generate_image(seed=42, prompt=prompt, width=1920, height=1280, num_inference_steps=4, image_path=args.input, image_strength=1 - args.strength)
    output.image.save(args.output)
    result.update(mlx_peak_bytes=mx.get_peak_memory(), image_strength=1 - args.strength, denoise_steps=4 - max(1, int(4 * (1 - args.strength))))
elif args.candidate == 'depth':
    import numpy as np
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    processor = AutoImageProcessor.from_pretrained(args.weights / 'estimator', local_files_only=True)
    model = AutoModelForDepthEstimation.from_pretrained(args.weights / 'estimator', local_files_only=True).to('mps')
    loaded = time.perf_counter()
    with torch.inference_mode():
        depth = model(**processor(images=image, return_tensors='pt').to('mps')).predicted_depth
        depth = torch.nn.functional.interpolate(depth.unsqueeze(1), size=(1280, 1920), mode='bicubic', align_corners=False)[0, 0].cpu().numpy()
    depth = ((depth - depth.min()) / (depth.max() - depth.min()) * 255).astype(np.uint8)
    Image.fromarray(depth).convert('RGB').save(args.output)
else:
    import torch
    from diffusers import ControlNetModel, StableDiffusionXLControlNetImg2ImgPipeline

    torch.mps.set_per_process_memory_fraction(1.0)
    controlnet = ControlNetModel.from_pretrained(args.weights / 'depth', variant='fp16', dtype=torch.float16, use_safetensors=True, local_files_only=True)
    model = StableDiffusionXLControlNetImg2ImgPipeline.from_pretrained(args.weights / 'sdxl', controlnet=controlnet, variant='fp16', dtype=torch.float16, use_safetensors=True, local_files_only=True).to('mps')
    model.enable_attention_slicing('auto')
    model.vae.enable_tiling()
    loaded = time.perf_counter()
    with torch.inference_mode():
        output = model(prompt=prompt, image=image, control_image=Image.open(args.input.with_name('s8-depth.png')).convert('RGB'), strength=args.strength, num_inference_steps=30, guidance_scale=5, controlnet_conditioning_scale=0.5, width=1920, height=1280, generator=torch.Generator(device='cpu').manual_seed(42)).images[0]
    output.save(args.output)
    result.update(denoise_steps=int(30 * args.strength), mps_driver_bytes=torch.mps.driver_allocated_memory())
finished = time.perf_counter()
stop.set()
result.update(load_seconds=loaded - started, image_seconds=finished - loaded, total_seconds=finished - started, max_rss_bytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, pixel_sha256=hashlib.sha256(Image.open(args.output).tobytes()).hexdigest())
args.output.with_suffix('.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result), flush=True)
