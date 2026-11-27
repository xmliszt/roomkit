from pathlib import Path
import socket
import sys
import tempfile

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "workers"))


@pytest.fixture(autouse=True)
def isolated_planner(monkeypatch):
    with tempfile.TemporaryDirectory(prefix="planner-unit-") as temporary:
        monkeypatch.setenv("PLANNER_HOME", str(Path(temporary) / "home"))
        monkeypatch.setenv("PLANNER_PROJECTS", str(Path(temporary) / "projects"))
        for name in ("PLANNER_PORT", "PLANNER_WEB_PORT"):
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                monkeypatch.setenv(name, str(listener.getsockname()[1]))
        monkeypatch.setenv("HF_HUB_OFFLINE", "1")
