import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

blender_dir = Path(__file__).resolve().parents[1]
source_dir = Path(os.environ.get('D1_SOURCE_ROOT', blender_dir))
checker_dir = Path(os.environ.get('D1_CHECKER_ROOT', blender_dir))
blender = os.environ.get('BLENDER', '/Applications/Blender.app/Contents/MacOS/Blender')


def run(script, arguments, rejected=None):
    command = [blender, '--background', '--factory-startup', '--python-exit-code', '1',
               '--python', str(script), '--', *map(str, arguments)]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=180)
    output = completed.stdout + completed.stderr
    if rejected:
        assert completed.returncode != 0 and rejected in output, output
        return
    if completed.returncode != 0:
        raise AssertionError(output)
    results = [json.loads(line[7:]) for line in output.splitlines() if line.startswith('RESULT ')]
    return results[-1] if results else None


def test_case(name, function, *arguments, **options):
    def check():
        function(*arguments, **options)
    check.__name__ = name
    return unittest.FunctionTestCase(check)


with tempfile.TemporaryDirectory(prefix='planner-d1-') as temporary:
    root = Path(temporary)
    os.environ['PLANNER_HOME'] = str(root / 'home')
    os.environ['PLANNER_PROJECTS'] = str(root / 'projects')
    fixtures = root / 'fixtures'
    cases = [
        ('chair', blender_dir / 'fixtures/chair-wrong-axes.glb', ['--source-up=+Z', '--source-front=+X']),
        ('chair-jpeg', blender_dir / 'fixtures/chair-jpeg-texture.glb', ['--source-up=+Z', '--source-front=+X']),
        ('duck', blender_dir / 'fixtures/duck.glb', ['--source-front=+X']),
        *[(name, fixtures / f'{name}.glb', []) for name in ['white', 'black', 'grey', 'factor', 'dense', 'wrong', 'multi', 'default', 'jpeg-alpha', 'png-alpha', 'rgba-alpha', 'neutral', 'vertex', 'multi-jpeg', 'unlit', 'unlit-textured', 'mirror', 'mirror-atlas', 'mixed-wrap', 'external', 'dense-uv', 'vertex-normal', 'multi-alpha', 'external-buffer', 'oversized', 'oversized-alpha', 'oversized-jpeg', 'oversized-atlas', 'oversized-normal']],
    ]
    if sys.argv[1:]:
        cases = [case for case in cases if case[0] in sys.argv[1:]]
        if not cases:
            raise SystemExit('no matching test cases')
    def check_case(name, source, axes):
        if name == 'wrong':
            source = fixtures / 'grey.glb'
        directory = root / name
        directory.mkdir()
        expected = [0.6, 0.9, 0.5] if name != 'wrong' else [0.2, 0.9, 0.8]
        if name == 'duck':
            expected = [0.6268375, 0.8377926, 0.9]
        result = run(source_dir / 'normalize.py', [
            '--input', source, '--output', directory / 'model.glb', '--mount', 'floor',
            '--expected-size', '.9', '--expected-width', expected[0], '--expected-height', expected[1],
            '--expected-depth', expected[2], *axes])
        (directory / 'result.json').write_text(json.dumps(result))
        if name not in ['dense', 'dense-uv', 'wrong']:
            run(source_dir / 'recolor.py', ['--input', directory / 'model.glb',
                '--output', directory / 'recolored.glb', '--color', '#1E50E6', '--strength', '1',
                '--reference-luma', result['referenceLuma']])
        run(checker_dir / 'tests/check.py', ['--case', directory])
        if name in ['multi', 'mirror-atlas']:
            rebuilt = root / f'{name}-rebuilt'
            rebuilt.mkdir()
            manifest = root / f'{name}-manifest.json'
            manifest.write_text(json.dumps([{'folder': str(directory), 'output': str(rebuilt)}]))
            run(source_dir / 'rebuild_masks.py', ['--manifest', manifest])
            run(blender_dir / 'tests/check-rebuilt-mask.py', ['--case', directory, '--rebuilt', rebuilt])
        if name in ['dense-uv', 'grey']:
            kind = 'uv' if name == 'dense-uv' else 'lines'
            path = directory / ('model.glb' if kind == 'uv' else 'lines.bin')
            original = path.read_bytes()
            try:
                run(blender_dir / 'tests/mutate-output.py', ['--case', directory, '--kind', kind])
                message = 'decimation corrupted UV mapping' if kind == 'uv' else 'zero-length segment'
                run(checker_dir / 'tests/check.py', ['--case', directory], rejected=message)
            finally:
                path.write_bytes(original)
    def check_mixed_recolor():
        output = root / 'mixed-recolored.glb'
        run(source_dir / 'recolor.py', ['--input', fixtures / 'mixed-formats.glb', '--output', output, '--color', '#1E50E6'])
        run(blender_dir / 'tests/check-mixed-formats.py', ['--input', fixtures / 'mixed-formats.glb', '--output', output])
    suite = unittest.TestSuite([
        test_case('part-level color masks', run, source_dir / 'tests/check-color-mask.py', []),
        test_case('build fixtures', run, blender_dir / 'tests/build-fixtures.py', ['--output', fixtures]),
        *[test_case(name, check_case, name, source, axes)
          for name, source, axes in cases],
        *([test_case('mixed-format recolor', check_mixed_recolor)] if not sys.argv[1:] or 'multi-jpeg' in sys.argv[1:] else []),
        *[test_case(f'reject {name}', run, source_dir / 'normalize.py',
             ['--input', fixtures / f'{name}.glb', '--output', root / f'{name}.glb',
              '--mount', 'floor', '--expected-size', '.9'], rejected=error)
          for name, error in [('skinned', 'skinned meshes are not supported'), ('morph', 'morph targets are not supported')]],
    ])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        sys.exit(1)
