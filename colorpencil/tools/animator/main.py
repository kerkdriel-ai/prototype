import base64
import hashlib
import io
import json
import math
from pathlib import Path
from typing import List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

import animated_drawings_backend as lifelike

CACHE_DIR = Path.home() / ".cache" / "colorpencil-animator"

app = FastAPI(title="colorpencil animator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def detect_device() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


DEVICE = detect_device()


def available_backends() -> List[str]:
    backends = ["stub"]
    if lifelike.is_available():
        backends.append("animated_drawings")
    return backends


class AnimateRequest(BaseModel):
    keyframes: List[str]
    motion: str = "wave"
    fps: int = 12
    frame_count: int = 24
    loop: bool = True
    backend: str = "stub"


class DetectRequest(BaseModel):
    image: str


def decode_png(encoded: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGBA")


def encode_png(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def cache_path(request: "AnimateRequest") -> Path:
    image = decode_png(request.keyframes[0])
    digest = hashlib.sha256()
    digest.update(image.tobytes())
    digest.update(f"{image.width}x{image.height}|{request.backend}|{request.motion}|{request.frame_count}".encode())
    return CACHE_DIR / f"{digest.hexdigest()}.json"


def placeholder_animation(figure: Image.Image, motion: str, frame_count: int) -> List[Image.Image]:
    width, height = figure.size
    headroom = max(1, round(0.3 * height))
    padded_height = height + headroom
    feet = (width // 2, headroom + int(0.85 * height))
    middle = (width // 2, headroom + height // 2)

    base = Image.new("RGBA", (width, padded_height), (0, 0, 0, 0))
    base.paste(figure, (0, headroom), figure)

    frames = []
    for i in range(frame_count):
        phase = 2 * math.pi * (i / max(1, frame_count))
        rise = (1 - math.cos(phase)) / 2
        transformed = base
        offset_y = 0

        if motion == "jump":
            offset_y = int(-0.2 * height * rise)
        elif motion == "jumpingjacks":
            transformed = base.rotate(8 * math.sin(phase), center=feet, resample=Image.BICUBIC)
            offset_y = int(-0.1 * height * rise)
        elif motion == "wave":
            transformed = base.rotate(9 * math.sin(phase), center=feet, resample=Image.BICUBIC)
        elif motion == "dance":
            transformed = base.rotate(7 * math.sin(phase), center=middle, resample=Image.BICUBIC)
            offset_y = int(-0.06 * height * rise)
        elif motion == "zombie":
            transformed = base.rotate(5 * math.sin(phase), center=feet, resample=Image.BICUBIC)
        else:
            offset_y = int(-0.05 * height * rise)

        canvas = Image.new("RGBA", (width, padded_height), (0, 0, 0, 0))
        canvas.paste(transformed, (0, offset_y), transformed)
        frames.append(canvas)

    return frames


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "device": DEVICE, "backends": available_backends()}


@app.post("/detect")
def detect(request: DetectRequest) -> dict:
    if not lifelike.is_available():
        return {"figures": []}
    return {"figures": lifelike.detect_figures(base64.b64decode(request.image))}


@app.post("/animate")
def animate(request: AnimateRequest) -> dict:
    cached = cache_path(request)
    if cached.exists():
        return json.loads(cached.read_text())

    if request.backend == "animated_drawings" and lifelike.is_available():
        figure = base64.b64decode(request.keyframes[0])
        frames = lifelike.animate(figure, request.motion, request.fps, request.frame_count)
    else:
        figure = decode_png(request.keyframes[0])
        frames = placeholder_animation(figure, request.motion, request.frame_count)

    result = {
        "frames": [encode_png(frame) for frame in frames],
        "fps": request.fps,
        "loop": request.loop,
    }
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(result))
    return result
