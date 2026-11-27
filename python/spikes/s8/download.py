import concurrent.futures
import hashlib
import json
import os
from pathlib import Path

os.environ['HF_HUB_DISABLE_XET'] = '1'
from huggingface_hub import hf_hub_download

models = json.loads(Path(__file__).with_name('models.json').read_text())
assert sum(model['total_bytes'] for model in models if model['name'] != 'flux') < 25_000_000_000
root = Path.home() / '.interior-planner/weights/s8'
for model in models:
    assert model['total_bytes'] == sum(file['size'] for file in model['files'])
    assert model['total_bytes'] < 25_000_000_000
    print(model['repo'], model['revision'], model['total_bytes'], flush=True)
    for file in model['files']:
        print(file['rfilename'], file['size'], flush=True)


def download(task):
    model, file = task
    path = Path(hf_hub_download(repo_id=model['repo'], revision=model['revision'], filename=file['rfilename'], local_dir=root / model['name']))
    assert path.stat().st_size == file['size'], str(path)
    if 'lfs' in file:
        with path.open('rb') as stream:
            assert hashlib.file_digest(stream, 'sha256').hexdigest() == file['lfs']['sha256'], str(path)
    else:
        payload = path.read_bytes()
        assert hashlib.sha1(f'blob {len(payload)}\0'.encode() + payload).hexdigest() == file['blobId'], str(path)
    print('verified', model['name'], file['rfilename'], flush=True)
    return model['name']


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    verified = []
    pending = {pool.submit(download, (model, file)) for model in models for file in model['files']}
    while pending:
        done, pending = concurrent.futures.wait(pending, timeout=8, return_when=concurrent.futures.FIRST_COMPLETED)
        for future in done:
            verified.append(future.result())
        print('downloads remaining', len(pending), flush=True)
summary = [{'name': model['name'], 'files_verified': verified.count(model['name']), 'total_bytes': model['total_bytes']} for model in models]
Path(__file__).resolve().parents[3].joinpath('docs/work-packages/evidence/s8-downloads.json').write_text(json.dumps(summary, indent=2) + '\n')
