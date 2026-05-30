#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Starting the STUB sidecar (procedural placeholder only)."
echo "For lifelike AnimatedDrawings motion, use setup-animated-drawings.sh instead."

if [ ! -d .venv ]; then
	python3 -m venv .venv
fi
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

exec uvicorn main:app --host 127.0.0.1 --port 8765
