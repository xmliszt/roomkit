import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('--weights', type=Path, required=True)
parser.add_argument('--logs', type=Path, required=True)
parser.add_argument('--candidate', choices=('depth', 'flux', 'sdxl', 'all'), default='all')
parser.add_argument('--evidence', type=Path, default=repo / 'docs/work-packages/evidence')
args = parser.parse_args()
evidence = args.evidence.resolve()
args.logs.mkdir(parents=True, exist_ok=True)
models = json.loads(Path(__file__).with_name('models.json').read_text())
candidates = ('depth', 'flux', 'sdxl') if args.candidate == 'all' else (args.candidate,)
for candidate in candidates:
    components = ('estimator',) if candidate == 'depth' else ('flux',) if candidate == 'flux' else ('sdxl', 'depth', 'estimator')
    for model in models:
        if model['name'] in components:
            for file in model['files']:
                path = args.weights / model['name'] / file['rfilename']
                assert path.stat().st_size == file['size'], str(path)
    for strength in ((20,) if candidate == 'depth' else (20, 35, 50)):
        output = evidence / ('s8-depth.png' if candidate == 'depth' else f's8-{candidate}-{strength:03}.png')
        output.unlink(missing_ok=True)
        output.with_suffix('.json').unlink(missing_ok=True)
        log = args.logs / f'{output.stem}.log'
        command = [str(repo / 'scripts/machine-lock.sh'), 's8', '/usr/bin/time', '-l', sys.executable, str(Path(__file__).with_name('run.py')), candidate, '--input', str(evidence / 's8-input.png'), '--output', str(output), '--weights', str(args.weights), '--strength', str(strength / 100)]
        print('measuring', output.name, log, flush=True)
        with log.open('w') as file:
            subprocess.run(command, cwd=repo, stdout=file, stderr=subprocess.STDOUT, check=True)
        measurement = json.loads(output.with_suffix('.json').read_text())
        timing = log.read_text()
        measurement['peak_footprint_bytes'] = int(re.search(r'(\d+)  peak memory footprint', timing)[1])
        measurement['time_max_rss_bytes'] = int(re.search(r'(\d+)  maximum resident set size', timing)[1])
        output.with_suffix('.json').write_text(json.dumps(measurement, indent=2) + '\n')
        print('measured', output.name, measurement['total_seconds'], flush=True)
