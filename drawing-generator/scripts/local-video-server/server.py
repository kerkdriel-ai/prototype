#!/usr/bin/env python3
"""
Lokale image-to-video server voor Tekening Animator.

Modellen (LOCAL_VIDEO_MODEL):
  svd       — Stable Video Diffusion XT (default, ~9GB, beweging uit afbeelding)
  cogvideox — CogVideoX-2b I2V (prompt + afbeelding, zwaarder)

Start:
  pip install -r requirements.txt
  python server.py

Of: npm run local-video
"""
from __future__ import annotations

import base64
import io
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Literal, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Tekening Animator Local Video")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_NAME = os.getenv("LOCAL_VIDEO_MODEL", "svd").lower()
HOST = os.getenv("LOCAL_VIDEO_HOST", "127.0.0.1")
PORT = int(os.getenv("LOCAL_VIDEO_PORT", "8765"))

JobStatus = Literal["starting", "processing", "succeeded", "failed", "canceled"]


@dataclass
class Job:
    status: JobStatus = "starting"
    error: Optional[str] = None
    progress: str = "Wachtrij..."
    video_base64: Optional[str] = None
    video_url: Optional[str] = None
    created_at: float = field(default_factory=time.time)


jobs: Dict[str, Job] = {}
jobs_lock = threading.Lock()
pipeline = None
pipeline_lock = threading.Lock()
device_name = "cpu"


class GenerateRequest(BaseModel):
    image: str
    prompt: str
    negative_prompt: Optional[str] = None
    duration: int = Field(default=5, ge=3, le=15)


def decode_data_url(data_url: str):
    from PIL import Image

    if "," not in data_url:
        raise ValueError("Ongeldige data URL")
    header, encoded = data_url.split(",", 1)
    raw = base64.b64decode(encoded)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    return img


def pick_device():
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_pipeline():
    global pipeline, device_name
    with pipeline_lock:
        if pipeline is not None:
            return pipeline

        import torch

        device_name = pick_device()
        dtype = torch.float16 if device_name in ("cuda", "mps") else torch.float32

        if MODEL_NAME == "cogvideox":
            from diffusers import CogVideoXImageToVideoPipeline

            pipe = CogVideoXImageToVideoPipeline.from_pretrained(
                "THUDM/CogVideoX-2b-I2V",
                torch_dtype=dtype,
            )
        else:
            from diffusers import StableVideoDiffusionPipeline

            pipe = StableVideoDiffusionPipeline.from_pretrained(
                "stabilityai/stable-video-diffusion-img2vid-xt",
                torch_dtype=dtype,
                variant="fp16" if dtype == torch.float16 else None,
            )

        if device_name == "mps":
            pipe.to("mps")
            pipe.enable_attention_slicing()
        elif device_name == "cuda":
            pipe.to("cuda")
            try:
                pipe.enable_model_cpu_offload()
            except Exception:
                pass
        else:
            pipe.to("cpu")
            pipe.enable_attention_slicing()

        pipeline = pipe
        return pipeline


def export_mp4(frames, path: str, fps: int = 8):
    import imageio.v3 as iio
    import numpy as np

    arrays = [np.array(f) for f in frames]
    iio.imwrite(path, arrays, fps=fps, codec="libx264", quality=8)


def run_generation(job_id: str, req: GenerateRequest):
    job = jobs[job_id]
    try:
        job.status = "processing"
        job.progress = "Model laden (eerste keer duurt lang)..."
        pipe = load_pipeline()
        image = decode_data_url(req.image)

        max_edge = 768 if MODEL_NAME == "cogvideox" else 576
        w, h = image.size
        scale = min(max_edge / w, max_edge / h, 1.0)
        if scale < 1.0:
            from PIL import Image

            image = image.resize(
                (int(w * scale), int(h * scale)), Image.Resampling.LANCZOS
            )

        job.progress = "Video frames genereren..."
        import torch

        generator = torch.Generator(device=device_name if device_name != "mps" else "cpu")
        generator.manual_seed(42)

        if MODEL_NAME == "cogvideox":
            num_frames = 49 if req.duration >= 8 else 33
            result = pipe(
                prompt=req.prompt,
                image=image,
                num_frames=num_frames,
                guidance_scale=6.0,
                generator=generator,
            )
            frames = result.frames[0]
            fps = 8
        else:
            num_frames = 25 if req.duration >= 8 else 14
            result = pipe(
                image,
                num_frames=num_frames,
                decode_chunk_size=2 if device_name == "cpu" else 4,
                motion_bucket_id=127,
                noise_aug_strength=0.02,
                generator=generator,
            )
            frames = result.frames[0]
            fps = 7

        job.progress = "Video exporteren..."
        out_dir = os.path.join(os.path.dirname(__file__), "outputs")
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, f"{job_id}.mp4")
        export_mp4(frames, out_path, fps=fps)

        with open(out_path, "rb") as f:
            job.video_base64 = base64.b64encode(f.read()).decode("ascii")
        job.video_url = f"http://{HOST}:{PORT}/outputs/{job_id}.mp4"
        job.status = "succeeded"
        job.progress = "Klaar"
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc)
        job.progress = "Mislukt"


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_NAME,
        "device": device_name,
        "pipeline_loaded": pipeline is not None,
    }


@app.post("/v1/jobs")
def create_job(req: GenerateRequest):
    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = Job(status="starting", progress="Gestart...")
    thread = threading.Thread(target=run_generation, args=(job_id, req), daemon=True)
    thread.start()
    return {"id": job_id, "status": "starting"}


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return {"status": "failed", "error": "Job niet gevonden"}
    return {
        "status": job.status,
        "error": job.error,
        "progress": job.progress,
        "videoBase64": job.video_base64,
        "videoUrl": job.video_url,
    }


@app.get("/outputs/{filename}")
def serve_output(filename: str):
    from fastapi.responses import FileResponse

    safe = os.path.basename(filename)
    path = os.path.join(os.path.dirname(__file__), "outputs", safe)
    if not os.path.isfile(path):
        from fastapi import HTTPException

        raise HTTPException(status_code=404)
    return FileResponse(path, media_type="video/mp4")


if __name__ == "__main__":
    import uvicorn

    print(f"Local video server — model={MODEL_NAME} http://{HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
