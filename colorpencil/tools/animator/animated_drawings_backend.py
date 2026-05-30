import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List, Tuple

import requests
import yaml
from PIL import Image, ImageSequence

ANIMATED_DRAWINGS_DIR = os.environ.get("ANIMATED_DRAWINGS_DIR", "")
MAX_MOTION_FRAMES = 120
DETECTOR_URL = "http://localhost:8080/predictions/drawn_humanoid_detector"
MIN_DETECT_SCORE = 0.4


def detect_figures(png_bytes: bytes) -> List[dict]:
    response = requests.post(DETECTOR_URL, files={"data": png_bytes}, verify=False)
    response.raise_for_status()
    figures = []
    for detection in response.json():
        if detection.get("score", 0) < MIN_DETECT_SCORE:
            continue
        left, top, right, bottom = [round(value) for value in detection["bbox"]]
        figures.append({"bbox": [left, top, right, bottom], "score": detection["score"]})
    return figures


def _ensure_on_path() -> bool:
    if not ANIMATED_DRAWINGS_DIR or not Path(ANIMATED_DRAWINGS_DIR).exists():
        return False
    if ANIMATED_DRAWINGS_DIR not in sys.path:
        sys.path.insert(0, ANIMATED_DRAWINGS_DIR)
    return True


def is_available() -> bool:
    if not _ensure_on_path():
        return False
    try:
        import animated_drawings  # noqa: F401

        return True
    except Exception:
        return False


def _configs(motion: str) -> Tuple[str, str]:
    mapping = json.loads((Path(__file__).parent / "motions.json").read_text())
    if motion not in mapping:
        raise ValueError(f"Unknown motion '{motion}'. Known: {sorted(mapping)}")
    entry = mapping[motion]
    base = Path(ANIMATED_DRAWINGS_DIR)
    return str(base / entry["motion_cfg"]), str(base / entry["retarget_cfg"])


MAX_FRAME_SIZE = 512


def _trim_motion(motion_cfg: str, work: Path) -> str:
    cfg = yaml.safe_load(Path(motion_cfg).read_text())
    start = cfg.get("start_frame_idx", 0) or 0
    end = cfg.get("end_frame_idx")
    if end is None or end - start > MAX_MOTION_FRAMES:
        cfg["end_frame_idx"] = start + MAX_MOTION_FRAMES
    trimmed = work / "motion.yaml"
    trimmed.write_text(yaml.safe_dump(cfg))
    return str(trimmed)


def _frames_from_gif(path: str) -> List[Image.Image]:
    gif = Image.open(path)
    return [frame.convert("RGBA").copy() for frame in ImageSequence.Iterator(gif)]


def _crop_to_content(frames: List[Image.Image]) -> List[Image.Image]:
    boxes = [frame.getchannel("A").getbbox() for frame in frames]
    boxes = [box for box in boxes if box]
    if not boxes:
        return frames
    left = min(box[0] for box in boxes)
    top = min(box[1] for box in boxes)
    right = max(box[2] for box in boxes)
    bottom = max(box[3] for box in boxes)
    return [frame.crop((left, top, right, bottom)) for frame in frames]


def _downsample(frames: List[Image.Image], target_count: int) -> List[Image.Image]:
    if len(frames) > target_count:
        step = len(frames) / target_count
        frames = [frames[int(i * step)] for i in range(target_count)]
    resized = []
    for frame in frames:
        longest = max(frame.size)
        if longest > MAX_FRAME_SIZE:
            scale = MAX_FRAME_SIZE / longest
            frame = frame.resize((round(frame.width * scale), round(frame.height * scale)))
        resized.append(frame)
    return resized


def animate(figure_png: bytes, motion: str, fps: int, frame_count: int) -> List[Image.Image]:
    if not _ensure_on_path():
        raise RuntimeError("ANIMATED_DRAWINGS_DIR is not set or does not exist")

    motion_cfg, retarget_cfg = _configs(motion)
    examples_dir = Path(ANIMATED_DRAWINGS_DIR) / "examples"
    runner = examples_dir / "image_to_animation.py"

    with tempfile.TemporaryDirectory() as work:
        figure = Image.open(io.BytesIO(figure_png)).convert("RGBA")
        on_white = Image.new("RGBA", figure.size, (255, 255, 255, 255))
        on_white.alpha_composite(figure)
        image_path = Path(work) / "figure.png"
        on_white.convert("RGB").save(image_path)

        trimmed_motion = _trim_motion(motion_cfg, Path(work))
        char_dir = Path(work) / "char"
        result = subprocess.run(
            [sys.executable, str(runner), str(image_path), str(char_dir), trimmed_motion, retarget_cfg],
            cwd=str(examples_dir),
            capture_output=True,
            text=True,
        )

        gif_path = char_dir / "video.gif"
        if not gif_path.exists():
            raise RuntimeError(f"AnimatedDrawings render failed:\n{result.stderr[-1000:]}")
        return _downsample(_crop_to_content(_frames_from_gif(str(gif_path))), frame_count)
