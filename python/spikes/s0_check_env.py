"""Check the S0 environment: exit 0 when `mlx_spatial`, its submodules and `REQUIRED_PIPELINES` all import.

The other packages are reported with their version or their error and never change the exit code.
"""

import importlib
import pkgutil
import platform
import sys
from importlib import metadata

REQUIRED_PIPELINES = (
    "MapAnythingScenePipeline",
    "Trellis2InferencePipeline",
    "Sam3dInferencePipeline",
)

MLX_SPATIAL_RUNTIME_MODULES = ("scipy.ndimage", "xatlas", "fast_simplification")

REPORTED_PACKAGES = (
    {"distribution": "mlx", "module": "mlx.core"},
    {"distribution": "torch", "module": "torch"},
    {"distribution": "opencv-contrib-python", "module": "cv2"},
    {"distribution": "numpy", "module": "numpy"},
    {"distribution": "pillow", "module": "PIL"},
    {"distribution": "pillow-heif", "module": "pillow_heif"},
)


def describe_error(error):
    """Return the error as one line of text."""
    return f"{type(error).__name__}: {error}".replace("\n", " ")


def check_mlx_spatial():
    """Import `mlx_spatial`, every submodule, `MLX_SPATIAL_RUNTIME_MODULES` and each name in `REQUIRED_PIPELINES`, print the imported count, and return the failures."""
    try:
        package = importlib.import_module("mlx_spatial")
        version = metadata.version("mlx-spatial")
    except (Exception, SystemExit) as error:
        return [f"mlx_spatial: {describe_error(error)}"]

    try:
        module_names = [
            module.name
            for module in pkgutil.walk_packages(
                package.__path__,
                "mlx_spatial.",
                onerror=lambda name: None,
            )
        ]
    except SystemExit as error:
        return [f"mlx_spatial: package walk stopped: {describe_error(error)}"]

    import_failures = []
    for module_name in module_names:
        try:
            importlib.import_module(module_name)
        except (Exception, SystemExit) as error:
            import_failures.append(f"{module_name}: {describe_error(error)}")

    runtime_failures = []
    for module_name in MLX_SPATIAL_RUNTIME_MODULES:
        try:
            importlib.import_module(module_name)
        except (Exception, SystemExit) as error:
            runtime_failures.append(f"{module_name}: {describe_error(error)}")

    missing_pipelines = [
        f"mlx_spatial.{name}: missing"
        for name in REQUIRED_PIPELINES
        if not hasattr(package, name)
    ]

    print(
        f"mlx-spatial {version}: "
        f"{len(module_names) - len(import_failures)} of {len(module_names)} submodules imported"
    )
    return import_failures + runtime_failures + missing_pipelines


def report_package(*, distribution, module):
    """Print the version of `distribution`, or the error raised by importing `module`."""
    try:
        importlib.import_module(module)
        print(f"{distribution} {metadata.version(distribution)}")
    except (Exception, SystemExit) as error:
        print(f"{distribution} FAILED {describe_error(error)}")


def report_check(*, label, read):
    """Print `label` with the value `read` returns, or the error it raises."""
    try:
        print(f"{label}: {read()}")
    except (Exception, SystemExit) as error:
        print(f"{label}: FAILED {describe_error(error)}")


def read_mlx_device():
    import mlx.core as mx

    return mx.default_device()


def read_mps_available():
    import torch

    return torch.backends.mps.is_available()


def read_aruco_marker_count():
    import cv2

    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    return len(dictionary.bytesList)


def main():
    print(f"python {platform.python_version()} {platform.machine()} macOS {platform.mac_ver()[0]}")

    failures = check_mlx_spatial()
    for failure in failures:
        print(f"FAILED {failure}")

    for package in REPORTED_PACKAGES:
        report_package(**package)
    report_check(label="mlx default device", read=read_mlx_device)
    report_check(label="torch.backends.mps.is_available()", read=read_mps_available)
    report_check(label="cv2.aruco DICT_4X4_50 markers", read=read_aruco_marker_count)

    if failures:
        print(f"S0 gate: FAIL ({len(failures)} mlx-spatial failures)")
        return 1
    print("S0 gate: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
