"""Write a cold modeler job folder: job.json, the object's photos and the helper library, nothing else.

python3 make-job.py --object fridge --photos <dir of JPEGs> --job <new folder>
"""

import argparse
import json
import pathlib
import shutil

HERE = pathlib.Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--object", required=True)
    parser.add_argument("--photos", required=True, type=pathlib.Path)
    parser.add_argument("--job", required=True, type=pathlib.Path)
    args = parser.parse_args()

    spec = next(entry for entry in json.loads((HERE / "objects.json").read_text())["objects"] if entry["name"] == args.object)
    args.job.mkdir(parents=True)
    (args.job / "photos").mkdir()
    (args.job / "lib").mkdir()
    for photo in spec["photos"]:
        shutil.copy(args.photos / f"{photo}.jpg", args.job / "photos" / f"{photo}.jpg")
    shutil.copy(HERE / "modeler_lib.py", args.job / "lib" / "modeler_lib.py")
    shutil.copy(HERE.parent / "glb_io.py", args.job / "lib" / "glb_io.py")
    job = {
        "name": spec["name"],
        "mount": spec["mount"],
        "sizeM": spec["sizeM"],
        "sizeSource": spec.get("sizeSourceForJob", "measured by the user" if spec["sizeSource"] == "measured" else "estimated from the photos"),
        "photos": [f"photos/{photo}.jpg" for photo in spec["photos"]],
        "bestPhoto": f"photos/{spec['bestPhoto']}.jpg",
        "boxInBestPhoto": spec["box"],
        "output": "raw.glb",
        "helperLibrary": "lib/modeler_lib.py",
        "commands": {
            "blender": f"{HERE}/blender-run.sh <script.py> job.json",
            "preview": f"{HERE}/preview.sh --glb raw.glb --out <shot.png> --azimuth <deg> --elevation <deg> [--zoom-out 1.05] [--size 900x900] [--mount {spec['mount']}] [--environment]",
        },
        "previewAngles": "azimuth 0 looks straight at the object's front; positive azimuth moves the camera toward the object's right side (+X), negative toward its left. Elevation is degrees above horizontal.",
    }
    (args.job / "job.json").write_text(json.dumps(job, indent=2) + "\n")
    print(args.job)


main()
