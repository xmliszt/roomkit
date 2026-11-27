import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from protocol import write_json


WORKERS = Path(__file__).resolve().parents[1] / "workers"


def run_script(*, code, payload):
    return subprocess.run([sys.executable, "-c", code], input=payload, text=True, capture_output=True, timeout=20, env={**os.environ, "PYTHONPATH": str(WORKERS)})


def test_json_protocol_keeps_library_prints_off_stdout():
    result = run_script(code="from protocol import run_worker, emit\ndef work(request):\n print('library log')\n emit({'kind':'progress','stage':'fixture','progress':1})\n return {'value': request['value'] + 1}\nrun_worker(work)", payload='{"value": 2}')
    assert result.returncode == 0
    events = [json.loads(line) for line in result.stdout.splitlines()]
    assert events == [{"kind": "progress", "stage": "fixture", "progress": 1}, {"kind": "result", "result": {"value": 3}}]
    assert "library log" in result.stderr


@pytest.mark.parametrize("payload", ['{"broken":', '[]', 'null'])
def test_bad_json_input_has_a_final_error_and_nonzero_exit(payload):
    result = run_script(code="from protocol import run_worker\nrun_worker(lambda request: request)", payload=payload)
    assert result.returncode != 0
    events = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(events) == 1
    assert events[0]["kind"] == "error"
    assert events[0]["message"]


def test_worker_failure_keeps_stdout_json_only():
    result = run_script(code="from protocol import run_worker\ndef work(request):\n print('before failure')\n raise ValueError('fixture failed')\nrun_worker(work)", payload='{}')
    assert result.returncode == 1
    assert json.loads(result.stdout) == {"kind": "error", "message": "fixture failed"}
    assert "before failure" in result.stderr


def test_nonfinite_result_fails_instead_of_writing_invalid_json():
    result = run_script(code="from protocol import run_worker\nrun_worker(lambda request: {'value': float('nan')})", payload='{}')
    assert result.returncode == 1
    assert json.loads(result.stdout)["kind"] == "error"


def test_json_write_preserves_existing_file_on_invalid_data(tmp_path):
    path = tmp_path / "result.json"
    write_json(path, {"value": 3})
    with pytest.raises(ValueError):
        write_json(path, {"value": float("nan")})
    assert json.loads(path.read_text()) == {"value": 3}
    assert list(tmp_path.iterdir()) == [path]
