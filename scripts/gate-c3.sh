#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec uv run --project python --frozen python python/gate_c3.py "$@"
