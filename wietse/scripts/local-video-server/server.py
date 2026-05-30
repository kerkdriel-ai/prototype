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
    progress_percent: Optional[int] = None
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
    forced = os.getenv("LOCAL_VIDEO_DEVICE", "").lower()
    if forced in ("cpu", "mps", "cuda"):
        return forced

    import torch

    if torch.cuda.is_available():
        return "cuda"
    # SVD op MPS is fragiel op Mac — default naar CPU tenzij expliciet aan
    if os.getenv("LOCAL_VIDEO_USE_MPS", "").lower() in ("1", "true", "yes"):
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    return "cpu"


def resize_image_for_model(image):
    """SVD verwacht beperkte resolutie; afmetingen moeten veelvoud van 8 zijn."""
    from PIL import Image

    image = image.convert("RGB")
    w, h = image.size
    max_edge = int(os.getenv("LOCAL_VIDEO_MAX_EDGE", "512"))
    max_pixels = int(os.getenv("LOCAL_VIDEO_MAX_PIXELS", str(max_edge * max_edge)))

    scale = min(max_edge / max(w, h), (max_pixels / (w * h)) ** 0.5, 1.0)
    new_w = max(64, int(w * scale) // 8 * 8)
    new_h = max(64, int(h * scale) // 8 * 8)

    if (new_w, new_h) != (w, h):
        image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)

    return image


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
                low_cpu_mem_usage=True,
            )
        else:
            from diffusers import StableVideoDiffusionPipeline

            load_kwargs = {
                "torch_dtype": dtype,
                "low_cpu_mem_usage": True,
            }
            if dtype == torch.float16:
                load_kwargs["variant"] = "fp16"

            pipe = StableVideoDiffusionPipeline.from_pretrained(
                "stabilityai/stable-video-diffusion-img2vid-xt",
                **load_kwargs,
            )

        if device_name == "mps":
            try:
                pipe.enable_sequential_cpu_offload()
            except Exception:
                pipe.to("mps")
            pipe.enable_attention_slicing("max")
            pipe.vae.enable_slicing()
        elif device_name == "cuda":
            pipe.to("cuda")
            try:
                pipe.enable_model_cpu_offload()
            except Exception:
                pass
        else:
            pipe.to("cpu")
            pipe.enable_attention_slicing("max")
            pipe.vae.enable_slicing()

        pipeline = pipe
        return pipeline


def log_job_progress(job_id: str, job: Job):
    elapsed = int(time.time() - job.created_at)
    mins, secs = divmod(elapsed, 60)
    pct = f" {job.progress_percent}%" if job.progress_percent is not None else ""
    print(
        f"[local-video] {job_id[:8]}… [{mins:02d}:{secs:02d}] {job.progress}{pct}",
        flush=True,
    )


def make_step_callback(job_id: str, total_steps: int):
    def on_step_end(pipe, step_index, timestep, callback_kwargs):
        job = jobs[job_id]
        step = step_index + 1
        pct = min(99, int((step / total_steps) * 100))
        job.progress = f"Frames genereren: stap {step}/{total_steps}"
        job.progress_percent = pct
        if step == 1 or step == total_steps or step % 3 == 0:
            log_job_progress(job_id, job)
        return callback_kwargs

    return on_step_end
    import imageio.v3 as iio
    import numpy as np

    arrays = [np.array(f) for f in frames]
    iio.imwrite(path, arrays, fps=fps, codec="libx264", quality=8)


def run_generation(job_id: str, req: GenerateRequest):
    job = jobs[job_id]
    try:
        job.status = "processing"
        job.progress = "Model laden (eerste keer duurt lang)..."
        job.progress_percent = 5
        log_job_progress(job_id, job)
        pipe = load_pipeline()
        image = resize_image_for_model(decode_data_url(req.image))

        job.progress = f"Video frames genereren ({device_name}, {image.size[0]}×{image.size[1]})..."
        job.progress_percent = 10
        log_job_progress(job_id, job)
        import torch

        generator = torch.Generator(device="cpu")
        generator.manual_seed(42)

        if MODEL_NAME == "cogvideox":
            num_frames = 33 if req.duration >= 8 else 25
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
            if device_name == "cpu":
                num_frames = 14 if req.duration >= 8 else 10
                decode_chunk = 1
            else:
                num_frames = 14 if req.duration >= 8 else 10
                decode_chunk = 2 if device_name == "cuda" else 1

            inference_steps = 25
            result = pipe(
                image,
                num_frames=num_frames,
                num_inference_steps=inference_steps,
                decode_chunk_size=decode_chunk,
                motion_bucket_id=127,
                noise_aug_strength=0.02,
                generator=generator,
                callback_on_step_end=make_step_callback(job_id, inference_steps),
            )
            frames = result.frames[0]
            fps = 7

        job.progress = "Video exporteren..."
        job.progress_percent = 95
        log_job_progress(job_id, job)
        out_dir = os.path.join(os.path.dirname(__file__), "outputs")
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, f"{job_id}.mp4")
        export_mp4(frames, out_path, fps=fps)

        file_size = os.path.getsize(out_path)
        job.video_url = f"http://{HOST}:{PORT}/outputs/{job_id}.mp4"
        # Alleen kleine bestanden als base64 — voorkomt geheugenproblemen in de browser
        if file_size <= 12 * 1024 * 1024:
            with open(out_path, "rb") as f:
                job.video_base64 = base64.b64encode(f.read()).decode("ascii")
        job.status = "succeeded"
        job.progress = "Klaar"
        job.progress_percent = 100
        log_job_progress(job_id, job)
    except Exception as exc:
        job.status = "failed"
        err = str(exc)
        if "Invalid buffer size" in err:
            job.error = (
                "Onvoldoende GPU-geheugen voor lokale generatie. "
                "Herstart de server (CPU-modus is standaard) of gebruik Replicate. "
                f"Technisch: {err}"
            )
        else:
            job.error = err
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
    elapsed = int(time.time() - job.created_at)
    return {
        "status": job.status,
        "error": job.error,
        "progress": job.progress,
        "progressPercent": job.progress_percent,
        "elapsedSeconds": elapsed,
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
