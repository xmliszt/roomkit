import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEIGHTS = Path.home() / ".interior-planner/python/weights"
SPIKE = Path.home() / ".cache/interior-planner-spikes/s2"
OUT = SPIKE / "outputs"
PRODUCTS = SPIKE / "products"
S3_SETS = Path.home() / ".cache/interior-planner-spikes/s3/s2"
S7_RESULTS = Path.home() / ".cache/interior-planner-spikes/s7/results"
RESULTS = SPIKE / "results"


def load_inputs():
    return json.loads((HERE / "inputs.json").read_text())["inputs"]


def input_by_id(input_id: str):
    return next(item for item in load_inputs() if item["id"] == input_id)


def output_dir(model: str, input_id: str) -> Path:
    return OUT / model / input_id
