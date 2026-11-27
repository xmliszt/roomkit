import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import mlx.core as mx
from chunk_attention import install_chunked_attention
from mflux.models.flux.model.flux_transformer.common.attention_utils import AttentionUtils

mx.random.seed(42)
query = mx.random.normal((1, 2, 513, 128))
key = mx.random.normal((1, 2, 513, 128))
value = mx.random.normal((1, 2, 513, 128))
reference = AttentionUtils.compute_attention(query=query, key=key, value=value, batch_size=1, num_heads=2, head_dim=128)
mx.eval(reference)
install_chunked_attention()
chunked = AttentionUtils.compute_attention(query=query, key=key, value=value, batch_size=1, num_heads=2, head_dim=128)
assert float(mx.max(mx.abs(reference - chunked))) < 0.0001

evidence = Path(__file__).resolve().parents[3] / 'docs/work-packages/evidence'
original = Image.open(evidence / 's8-input.png').convert('RGB')
assert original.size == (1920, 1280)
input_hash = hashlib.sha256(original.tobytes()).hexdigest()
depth = Image.open(evidence / 's8-depth.png').convert('RGB')
depth_measurement = json.loads((evidence / 's8-depth.json').read_text())
assert depth.size == original.size
assert depth_measurement['candidate'] == 'depth'
assert depth_measurement['pixel_sha256'] == hashlib.sha256(depth.tobytes()).hexdigest()
assert depth_measurement['image_seconds'] > 0
assert depth_measurement['load_seconds'] > 0
assert depth_measurement['peak_footprint_bytes'] > 0
assert depth_measurement['time_max_rss_bytes'] > 0
assert abs(depth_measurement['total_seconds'] - depth_measurement['load_seconds'] - depth_measurement['image_seconds']) < 0.001
models = json.loads(Path(__file__).with_name('models.json').read_text())
downloads = json.loads((evidence / 's8-downloads.json').read_text())
assert len(downloads) == len(models)
for model, download in zip(models, downloads):
    assert download['name'] == model['name']
    assert download['files_verified'] == len(model['files'])
    assert download['total_bytes'] == model['total_bytes']
font = ImageFont.load_default(size=18)
crop_boxes = {'lamp': (340, 560, 480, 760), 'chair': (1120, 800, 1840, 1240)}
measurements = []
for candidate in ('flux', 'sdxl'):
    outputs = []
    for strength in (20, 35, 50):
        path = evidence / f's8-{candidate}-{strength:03}.png'
        output = Image.open(path).convert('RGB')
        measurement = json.loads(path.with_suffix('.json').read_text())
        assert output.size == original.size
        assert float(np.asarray(output, dtype=np.float32).std()) > 1
        assert measurement['candidate'] == candidate
        assert measurement['strength'] == strength / 100
        assert measurement['input_pixel_sha256'] == input_hash
        assert measurement['pixel_sha256'] == hashlib.sha256(output.tobytes()).hexdigest()
        assert measurement['image_seconds'] > 0
        assert measurement['peak_footprint_bytes'] > 0
        outputs.append(output)
        measurements.append(measurement)
    for name, box in crop_boxes.items():
        scale = 2 if name == 'lamp' else 1
        width = (box[2] - box[0]) * scale
        height = (box[3] - box[1]) * scale
        sheet = Image.new('RGB', (width * 4, height + 46), 'white')
        draw = ImageDraw.Draw(sheet)
        for index, (label, image) in enumerate(zip(('Input', 'Polish 0.20', 'Polish 0.35', 'Polish 0.50'), (original, *outputs))):
            crop = image.crop(box)
            if scale != 1:
                crop = crop.resize((width, height), Image.Resampling.NEAREST)
            sheet.paste(crop, (index * width, 46))
            draw.text((index * width + 8, 10), label, font=font, fill='black')
        sheet.save(evidence / f's8-{candidate}-{name}-crops.png')
        before = np.array(original.crop(box), dtype=np.float32)
        for measurement, output in zip(measurements[-3:], outputs):
            after = np.array(output.crop(box), dtype=np.float32)
            measurement[f'{name}_mae_255'] = float(np.abs(after - before).mean())
    hashes = [measurement['pixel_sha256'] for measurement in measurements[-3:]]
    if candidate == 'flux':
        assert hashes[0] != hashes[1]
        assert hashes[1] == hashes[2]
    else:
        assert len(set(hashes)) == 3
(evidence / 's8-measurements.json').write_text(json.dumps(measurements, indent=2) + '\n')
print('gate:s8 passed: six 1920px outputs, input hashes, measured timings and memory, strength differences, four comparison sheets')
