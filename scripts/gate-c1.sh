#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec uv run --project python python python/gate_c1.py "$@"
