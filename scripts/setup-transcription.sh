#!/usr/bin/env bash
# Creates the Python environment the local transcriber runs in.
# Run once after cloning; .venv/ and models/ are gitignored.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d .venv ]; then
  echo "Creating .venv..."
  python3 -m venv .venv
fi

echo "Installing faster-whisper..."
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet faster-whisper

echo
echo "Done. Model weights download automatically on the first transcription"
echo "(large-v3 is ~3GB) and are cached in ./models."
