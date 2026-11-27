from pathlib import Path

from diffusers import AutoencoderKL, DDIMScheduler
from transformers import CLIPImageProcessor, CLIPTextModel, CLIPTokenizer


class LocalPaintPipeline:
    @staticmethod
    def from_pretrained(model_path, *, torch_dtype, custom_pipeline):
        from hunyuanpaintpbr.pipeline import HunyuanPaintPipeline
        from hunyuanpaintpbr.unet.modules import UNet2p5DConditionModel

        path = Path(model_path)
        return HunyuanPaintPipeline(
            vae=AutoencoderKL.from_pretrained(
                path / "vae", dtype=torch_dtype, local_files_only=True
            ),
            text_encoder=CLIPTextModel.from_pretrained(
                path / "text_encoder", dtype=torch_dtype, local_files_only=True
            ),
            tokenizer=CLIPTokenizer.from_pretrained(
                path / "tokenizer", local_files_only=True
            ),
            unet=UNet2p5DConditionModel.from_pretrained(
                path / "unet", torch_dtype=torch_dtype
            ),
            scheduler=DDIMScheduler.from_pretrained(
                path / "scheduler", local_files_only=True
            ),
            feature_extractor=CLIPImageProcessor.from_pretrained(
                path / "feature_extractor", local_files_only=True
            ),
        )
