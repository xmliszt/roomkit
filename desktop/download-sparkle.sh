#!/bin/bash
set -euo pipefail

if [[ $# != 1 || ! -d "$1" ]]; then
  printf '%s\n' 'Usage: desktop/download-sparkle.sh existing-directory' >&2
  exit 1
fi

cd "$1"
version=2.10.1
archive="Sparkle-$version.tar.xz"
sha256=1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27
curl --proto '=https' --fail --silent --show-error --location --retry 2 \
  --output "$archive" "https://github.com/sparkle-project/Sparkle/releases/download/$version/$archive"
printf '%s  %s\n' "$sha256" "$archive" | shasum -a 256 --check
tar -xf "$archive"
