import argparse
import json
import math
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time

from score_room import score_room


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return str(listener.getsockname()[1])


def execute(*, name, request, output):
    log = output / f"{name}-{time.time_ns()}.log"
    request_path = log.with_suffix(".request.json")
    request_path.write_text(json.dumps(request, indent=2))
    worker = Path(__file__).parent / "workers" / f"{name}.py"
    finished = threading.Event()

    def heartbeat():
        while not finished.wait(5):
            print(f"gate-c1: {name} running", flush=True)

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        with log.open("w") as stderr:
            with subprocess.Popen(["/usr/bin/time", "-l", sys.executable, str(worker)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, text=True, start_new_session=True) as process:
                try:
                    stdout, _ = process.communicate(json.dumps(request), timeout=600)
                except BaseException:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.communicate()
                    raise
    finally:
        finished.set()
        thread.join()
    log.with_suffix(".jsonl").write_text(stdout)
    messages = [json.loads(line) for line in stdout.splitlines()]
    if process.returncode != 0 or not messages or messages[-1]["kind"] != "result":
        raise RuntimeError(f"{name} failed: {messages[-1] if messages else log.read_text()}; log: {log}")
    usage = log.read_text()
    readings = re.findall(r"(\d+)\s+(?:maximum resident set size|peak memory footprint)", usage)
    if not readings:
        raise RuntimeError(f"No peak memory measurement in {log}")
    peak_gb = max(map(int, readings)) / 1e9
    if peak_gb >= 24:
        raise AssertionError(f"{name} peak {peak_gb:.2f} GB exceeds 24 GB")
    print(f"gate-c1: {name} passed, peak {peak_gb:.2f} GB", flush=True)
    return messages[-1]["result"], peak_gb


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--photos", type=Path, required=True)
    parser.add_argument("--weights", type=Path, default=Path.home() / ".interior-planner/python/weights")
    parser.add_argument("--room-size", type=float, nargs=3, required=True, metavar=("WIDTH", "LENGTH", "HEIGHT"))
    parser.add_argument("--scale-height-m", type=float, required=True)
    args = parser.parse_args()
    if any(not math.isfinite(value) or value <= 0 for value in (*args.room_size, args.scale_height_m)):
        parser.error("Room dimensions and scale height must be positive and finite")
    output = Path(tempfile.mkdtemp(prefix="planner-c1-"))
    os.environ.update({"PLANNER_HOME": str(output / "home"), "PLANNER_PROJECTS": str(output / "projects"), "PLANNER_PORT": free_port(), "PLANNER_WEB_PORT": free_port(), "HF_HUB_OFFLINE": "1"})
    print(f"gate-c1: output {output}", flush=True)
    photos = sorted(args.photos.glob("*.HEIC"))
    if not photos:
        parser.error("--photos must contain the HEIC inputs for the box annotations")
    boxes = json.loads((Path(__file__).parent / "spikes/s3/boxes.json").read_text())
    objects = [{"objectId": box["object"].replace(" ", "-"), "name": box["object"], "views": [{"photoId": Path(box["photo"]).stem, "path": str(args.photos / box["photo"]), "box": box["box"]}]} for box in boxes]
    fridge = next(obj for obj in objects if obj["name"] == "fridge")
    started = time.monotonic()
    intake, intake_peak = execute(name="intake", request={"photos": [{"photoId": path.stem, "path": str(path)} for path in photos], "outputDir": str(output / "intake")}, output=output)
    if len(intake["photos"]) != len(photos):
        raise AssertionError("Intake did not describe every input photo")
    scale_masks, mask_peak = execute(name="segment", request={"objects": [fridge], "weightsDir": str(args.weights), "outputDir": str(output / "scale-masks")}, output=output)
    mask_path = output / "scale-masks" / scale_masks["objects"][0]["views"][0]["maskPath"]
    room, room_peak = execute(name="reconstruct", request={"photosPath": str(output / "intake/photos.json"), "weightsDir": str(args.weights), "outputDir": str(output / "recon"), "scaleSources": [{"kind": "furniture", "label": "fridge", "axis": "height", "lengthM": args.scale_height_m, "floorStanding": True, "photoId": fridge["views"][0]["photoId"], "maskPath": str(mask_path)}]}, output=output)
    coverage, coverage_peak = execute(name="coverage", request={"reconDir": str(output / "recon")}, output=output)
    duration = time.monotonic() - started
    if len(room["walls"]) != 4 or not all(w["planeFound"] for w in room["confidence"]):
        raise AssertionError("Expected four fitted wall planes")
    width_m, length_m, height_m = args.room_size
    geometry = score_room(room=room, width_m=width_m, length_m=length_m, height_m=height_m)
    dimensions = [*geometry["widthSidesM"], *geometry["lengthSidesM"], geometry["ceilingHeightM"]]
    errors = geometry["signedErrors"]
    peak = max(intake_peak, mask_peak, room_peak, coverage_peak)
    print(f"gate-c1: room {geometry}; 4 planes; {duration:.1f} s; peak {peak:.2f} GB", flush=True)
    if duration >= 600:
        raise AssertionError("Room failed the 600 s gate")
    if len(coverage["surfaces"]) != 5:
        raise AssertionError("Coverage must report four walls and floor")
    warmup = {**fridge, "objectId": "warmup"}
    masks, segment_peak = execute(name="segment", request={"objects": [warmup, *objects], "weightsDir": str(args.weights), "outputDir": str(output / "masks")}, output=output)
    timings = []
    for obj in masks["objects"][1:]:
        view = obj["views"][0]
        timings.append(view["durationSeconds"])
        if view["durationSeconds"] >= 30 or view["shareInBox"] < 0.8:
            raise AssertionError(f"Mask gate failed: {obj['name']}: {view}")
        print(f"gate-c1: {obj['name']} {view['durationSeconds']:.2f} s, {view['shareInBox']:.1%} in box, {view['model']}", flush=True)
    summary = {"kind": "passed", "roomDimensionsM": dimensions, "geometry": geometry, "errors": errors, "durationSeconds": duration, "peakGb": max(peak, segment_peak), "warmMaskSeconds": timings, "outputDir": str(output)}
    (output / "gate.json").write_text(json.dumps(summary, indent=2))
    print(f"C1 gate: PASS; evidence {output / 'gate.json'}", flush=True)


if __name__ == "__main__":
    main()
