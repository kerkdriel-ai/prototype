import { replicateRunWithRetry } from "@/lib/replicate-retry";
import {
  getVideoModelRunRef,
  getVideoModelVersion,
  normalizeVideoDuration,
  VIDEO_DEFAULT_RESOLUTION,
} from "@/lib/video-models";
import type {
  VideoGenerationInput,
  VideoPredictionStatus,
} from "@/lib/video-types";

function buildVideoInput(input: VideoGenerationInput) {
  return {
    image: input.imageDataUrl,
    prompt: input.prompt,
    negative_prompt: input.negativePrompt,
    duration: normalizeVideoDuration(input.duration),
    resolution: input.resolution ?? VIDEO_DEFAULT_RESOLUTION,
    enable_prompt_expansion: true,
    audio_enabled: false,
  };
}

export function extractVideoUrl(output: unknown): string | null {
  if (typeof output === "string" && output.startsWith("http")) return output;
  if (Array.isArray(output)) {
    const url = output.find((x) => typeof x === "string" && x.startsWith("http"));
    if (url) return url as string;
  }
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    for (const key of ["video", "output", "url"]) {
      const val = obj[key];
      if (typeof val === "string" && val.startsWith("http")) return val;
    }
  }
  return null;
}

export async function createVideoPrediction(
  replicate: InstanceType<typeof import("replicate").default>,
  input: VideoGenerationInput
): Promise<{ id: string; status: VideoPredictionStatus }> {
  const prediction = await replicate.predictions.create({
    version: getVideoModelVersion(),
    input: buildVideoInput(input),
  });

  return {
    id: prediction.id,
    status: (prediction.status ?? "starting") as VideoPredictionStatus,
  };
}

export async function getVideoPrediction(
  replicate: InstanceType<typeof import("replicate").default>,
  predictionId: string
): Promise<{
  status: VideoPredictionStatus;
  videoUrl: string | null;
  error: string | null;
}> {
  const prediction = await replicate.predictions.get(predictionId);
  const status = (prediction.status ?? "processing") as VideoPredictionStatus;

  if (status === "succeeded") {
    return {
      status,
      videoUrl: extractVideoUrl(prediction.output),
      error: null,
    };
  }

  if (status === "failed" || status === "canceled") {
    return {
      status,
      videoUrl: null,
      error:
        typeof prediction.error === "string"
          ? prediction.error
          : "Video-generatie mislukt",
    };
  }

  return { status, videoUrl: null, error: null };
}

/** Synchrone run (dev/tests) — wacht tot klaar. */
export async function generateVideoSync(
  replicate: InstanceType<typeof import("replicate").default>,
  input: VideoGenerationInput
): Promise<string> {
  const output = await replicateRunWithRetry(
    replicate,
    getVideoModelRunRef(),
    buildVideoInput(input),
    "Wan I2V"
  );

  const url = extractVideoUrl(output);
  if (!url) throw new Error("Geen video-URL ontvangen van Replicate");
  return url;
}
