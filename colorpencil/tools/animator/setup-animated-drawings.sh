#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

REPO="${1:-$HOME/AnimatedDrawings}"
ENV_NAME=animated_drawings
ANIMATOR_DIR="$(pwd)"

if ! command -v conda >/dev/null 2>&1; then
	echo "conda not found. Install Miniconda first:" >&2
	echo "  brew install --cask miniconda && conda init zsh   (open a new terminal after)" >&2
	exit 1
fi

echo "==> AnimatedDrawings repo: $REPO"
if [ ! -d "$REPO" ]; then
	git clone https://github.com/facebookresearch/AnimatedDrawings "$REPO"
fi

echo "==> Conda env '$ENV_NAME' (Python 3.8.13, required by AnimatedDrawings)"
conda env list | grep -q "/$ENV_NAME$" || conda create -y -n "$ENV_NAME" python=3.8.13

echo "==> Installing AnimatedDrawings (editable) and sidecar dependencies"
conda run -n "$ENV_NAME" pip install -q -e "$REPO"
conda run -n "$ENV_NAME" pip install -q tomli platformdirs scikit-image opencv-python fastapi "uvicorn[standard]"

echo "==> Installing the detector + pose models (torch, mmdet/mmpose, mmcv, model downloads; takes a while)"
( cd "$REPO/torchserve" && conda run -n "$ENV_NAME" bash setup_macos.sh )

if ! java -version 2>&1 | grep -qoE '"(1[1-9]|[2-9][0-9])'; then
	echo "!! TorchServe needs Java 11+. Your default java looks older."
	echo "   Install a modern JDK:  brew install openjdk"
fi

cat <<NEXT

==> Setup done. Run the lifelike backend in two terminals:

  # 1) TorchServe (figure detector + pose estimator). Java 11+ required.
  cd "$REPO/torchserve"
  export JAVA_HOME="\$(brew --prefix openjdk)/libexec/openjdk.jdk/Contents/Home"
  conda activate $ENV_NAME
  torchserve --start --ts-config config.local.properties --disable-token-auth --foreground

  # 2) colorpencil sidecar, in the same env, pointing at the repo
  cd "$ANIMATOR_DIR"
  conda activate $ENV_NAME
  ANIMATED_DRAWINGS_DIR="$REPO" uvicorn main:app --host 127.0.0.1 --port 8765

Then GET http://127.0.0.1:8765/health should list "animated_drawings" in backends.
NEXT
