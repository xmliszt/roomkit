import contextlib
import json
import os
from pathlib import Path
import sys
import tempfile
import threading


class UserFacingError(ValueError):
    """An error whose message is written for the person using the app."""


def emit(event):
    sys.__stdout__.write(json.dumps(event, allow_nan=False) + "\n")
    sys.__stdout__.flush()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, indent=2, allow_nan=False)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}-")
    try:
        with os.fdopen(descriptor, "w") as stream:
            stream.write(data + "\n")
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def run_worker(worker):
    finished = threading.Event()

    def heartbeat():
        while not finished.wait(5):
            emit({"kind": "progress", "stage": "running"})

    thread = threading.Thread(target=heartbeat, daemon=True)
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError("Worker input must be a JSON object")
        thread.start()
        with contextlib.redirect_stdout(sys.stderr):
            result = worker(request)
        finished.set()
        thread.join()
        emit({"kind": "result", "result": result})
    except Exception as error:
        finished.set()
        if thread.is_alive():
            thread.join()
        emit({"kind": "error", "message": str(error), **({"isUserFacing": True} if isinstance(error, UserFacingError) else {})})
        raise SystemExit(1) from error
