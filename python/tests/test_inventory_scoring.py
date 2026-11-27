import json
from pathlib import Path
import subprocess

import pytest


def score_names(names):
    scene = {
        "room": {"ceilingHeightM": 2.8, "walls": [
            {"id": "left", "startM": {"x": -3, "z": -4}, "kind": "solid"},
            {"id": "front", "startM": {"x": -3, "z": 4}, "kind": "solid"},
            {"id": "right", "startM": {"x": 3, "z": 4}, "kind": "solid"},
            {"id": "back", "startM": {"x": 3, "z": -4}, "kind": "solid"},
        ]},
        "items": [{"id": str(index), "name": name, "sizeM": {"width": 1, "height": 1, "depth": 0.5}, "placement": {"kind": "floor", "xM": 0, "zM": 0, "elevationM": 0, "rotationRad": 0}} for index, name in enumerate(names)],
    }
    patterns = {
        "sofa": r"\b(?:sofa|couch)$",
        "desk": r"^(?!.*\b(?:coffee|side|end|bedside|lamp)\b).*\b(?:desk|table)$",
        "fridge": r"\b(?:fridge|refrigerator)$",
        "tv": r"\b(?:tv|television)$",
        "tv console": r"\b(?:tv|television) (?:console|cabinet)$",
        "coffee table": r"\bcoffee table$",
        "floor lamp": r"\bfloor lamp$",
    }
    targets = [{"name": name, "pattern": pattern, "walls": []} for name, pattern in patterns.items()]
    script = (
        "import { readFileSync } from 'node:fs';"
        "import { scoreInventory } from './scripts/b7-real-inventory.ts';"
        "const {scene, targets} = JSON.parse(readFileSync(0, 'utf8'));"
        "process.stdout.write(JSON.stringify(scoreInventory({scene, targets, expectedSizes: [], floorOrder: [], axes: {right: {x: 1, z: 0}, forward: {x: 0, z: -1}}})));"
    )
    process = subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps({"scene": scene, "targets": targets}), capture_output=True, text=True, check=True, timeout=10, cwd=Path(__file__).parents[2])
    return {score["name"]: score for score in json.loads(process.stdout)["scores"]}


@pytest.mark.parametrize("reverse", [False, True])
def test_chair_by_fridge_does_not_claim_fridge(reverse):
    names = ["Dining chair (cream, metal legs), by fridge", "Refrigerator (silver)"]
    if reverse:
        names.reverse()
    scores = score_names(names)
    assert scores["fridge"]["itemId"] == str(names.index("Refrigerator (silver)"))
    assert not score_names(["Dining chair by fridge"])["fridge"]["found"]


@pytest.mark.parametrize("name", ["Desk (oval, fluted legs)", "Table", "Dining table", "Work table", "Oval dining table with fluted legs"])
def test_desk_aliases_still_match_head_noun(name):
    assert score_names([name])["desk"]["found"]


def test_names_only_match_the_object_before_location_or_description():
    scores = score_names(["Chair beside sofa", "Chair by desk", "Fridge magnet", "TV cabinet", "Coffee table lamp", "Lamp by floor lamp", "Sofa table"])
    assert [name for name, score in scores.items() if score["found"]] == ["desk", "tv console"]


def test_compound_objects_are_not_reused_for_other_targets():
    scores = score_names(["TV console", "Coffee table", "Floor lamp with round tray side table"])
    matched = [score for score in scores.values() if score["found"]]
    assert [score["name"] for score in matched] == ["tv console", "coffee table", "floor lamp"]
    assert len({score["itemId"] for score in matched}) == len(matched)


def test_shorter_object_name_wins_over_an_ambiguous_longer_name():
    scores = score_names(["Dining chair and fridge", "Fridge"])
    assert scores["fridge"]["itemId"] == "1"


@pytest.mark.parametrize("location", ["adjacent to", "to the left of", "to the right of", "at", "below"])
def test_location_phrases_do_not_claim_the_named_target(location):
    scores = score_names([f"Dining chair {location} fridge", f"TV console {location} television", f"Floor lamp {location} window"])
    assert not scores["fridge"]["found"]
    assert not scores["tv"]["found"]
    assert scores["tv console"]["found"]
    assert scores["floor lamp"]["found"]
