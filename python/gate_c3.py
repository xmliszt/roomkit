import argparse
import json
import math
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time


ROOT = Path(__file__).resolve().parents[1]
VALIDATE = """
import { readFileSync } from 'node:fs';
import validator from 'gltf-validator';
const report = await validator.validateBytes(new Uint8Array(readFileSync(process.argv[1])));
process.stdout.write(JSON.stringify(report));
process.exitCode = report.issues.numErrors === 0 ? 0 : 1;
"""


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return str(listener.getsockname()[1])


def run_case(*, model, case, request, evidence):
    folder = evidence / f"{model}-{case}"
    folder.mkdir()
    request = {**request, "outputDir": str(folder / "asset")}
    (folder / "request.json").write_text(json.dumps(request, indent=2) + "\n")
    events = []
    started = time.perf_counter()
    print(f"{model} {case}: starting", flush=True)
    with (folder / "stderr.log").open("w") as stderr:
        process = subprocess.Popen(
            [sys.executable, str(ROOT / f"python/workers/generate_{model}.py")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr,
            text=True, start_new_session=True,
        )

        def read_output():
            with (folder / "stdout.jsonl").open("w") as log:
                for line in process.stdout:
                    log.write(line)
                    log.flush()
                    events.append(line)
                    try:
                        event = json.loads(line)
                        if event.get("stage") != "running":
                            print(f"{model} {case}: {event.get('stage', event.get('kind'))}", flush=True)
                    except (ValueError, AttributeError):
                        pass

        reader = threading.Thread(target=read_output, daemon=True)
        reader.start()
        try:
            process.stdin.write(json.dumps(request))
            process.stdin.close()
            process.wait(timeout=900)
        except BaseException:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise
        finally:
            reader.join(timeout=10)
    elapsed = time.perf_counter() - started
    decoded = [json.loads(line) for line in events]
    terminal = [event for event in decoded if event["kind"] in ("result", "error")]
    if process.returncode != 0 or len(terminal) != 1 or terminal[0]["kind"] != "result" or decoded[-1] != terminal[0]:
        raise RuntimeError(f"{model} {case} failed: {terminal}; see {folder / 'stderr.log'}")
    result = terminal[0]["result"]
    assert result["sourceUp"] == "+Z" and result["sourceFront"] == "-Y", result
    for key in ("durationSeconds", "peakRssGb", "mlxPeakGb", "peakMemoryGb"):
        assert math.isfinite(result[key]) and result[key] > 0, (key, result)
    assert result["durationSeconds"] < 900 and elapsed < 900, result
    validation = subprocess.run(
        ["node", "--input-type=module", "-e", VALIDATE, result["glbPath"]],
        cwd=ROOT, text=True, capture_output=True, timeout=60,
    )
    (folder / "validator.json").write_text(validation.stdout)
    assert validation.returncode == 0, validation.stdout + validation.stderr
    report = json.loads(validation.stdout)
    assert report["issues"]["numErrors"] == 0, report
    summary = {
        "model": model, "input": case, **result, "wallSeconds": elapsed,
        "validatorErrors": report["issues"]["numErrors"],
        "validatorWarnings": report["issues"]["numWarnings"],
    }
    print(json.dumps(summary), flush=True)
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights-dir", type=Path, default=Path.home() / ".interior-planner/python/weights")
    parser.add_argument("--sofa-dir", type=Path, default=Path.home() / ".cache/interior-planner-spikes/s3/s2/sofa")
    parser.add_argument("--product-photo", type=Path, default=Path.home() / ".cache/interior-planner-spikes/s2/products/floor_lamp.jpg")
    args = parser.parse_args()
    evidence = Path(tempfile.mkdtemp(prefix="planner-c3-"))
    os.environ.update({
        "PLANNER_HOME": str(evidence / "home"), "PLANNER_PROJECTS": str(evidence / "projects"),
        "PLANNER_PORT": free_port(), "PLANNER_WEB_PORT": free_port(), "HF_HUB_OFFLINE": "1",
    })
    print(f"C3 evidence: {evidence}", flush=True)
    cases = [
        ("sofa", {"name": "Sofa", "photoPath": str((args.sofa_dir / "photo.jpg").resolve()), "maskPath": str((args.sofa_dir / "mask.png").resolve())}),
        ("product", {"name": "Floor lamp", "photoPath": str(args.product_photo.resolve())}),
    ]
    summaries = []
    try:
        for model in ("trellis", "sam3d"):
            for case, inputs in cases:
                summaries.append(run_case(model=model, case=case, request={**inputs, "weightsDir": str(args.weights_dir.resolve())}, evidence=evidence))
    except Exception as error:
        (evidence / "gate.json").write_text(json.dumps({"passed": False, "runs": summaries, "error": str(error)}, indent=2) + "\n")
        raise
    (evidence / "gate.json").write_text(json.dumps({"passed": True, "runs": summaries}, indent=2) + "\n")
    print(f"C3 gate: PASS (4 GLBs, 0 validator errors); {evidence / 'gate.json'}", flush=True)


if __name__ == "__main__":
    main()
