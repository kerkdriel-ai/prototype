import type {
  VideoGenerationInput,
  VideoJobResult,
  VideoPredictionStatus,
  VideoProviderHealth,
} from "@/lib/video-types";
import { getLocalVideoApiUrl } from "@/lib/video-types";

interface LocalJobResponse {
  id: string;
  status?: VideoPredictionStatus;
}

interface LocalJobStatusResponse {
  status: VideoPredictionStatus;
  videoUrl?: string;
  videoBase64?: string;
  error?: string;
  progress?: string;
  progressPercent?: number;
  elapsedSeconds?: number;
}

interface LocalHealthResponse {
  ok: boolean;
  model?: string;
  device?: string;
  error?: string;
}

function localBaseUrl(override?: string): string {
  return override ?? getLocalVideoApiUrl();
}

export async function checkLocalVideoHealth(
  baseUrl?: string
): Promise<VideoProviderHealth> {
  const url = localBaseUrl(baseUrl);
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        message: `Lokale server antwoordde met ${res.status}`,
      };
    }
    const body = (await res.json()) as LocalHealthResponse;
    return {
      ok: body.ok,
      model: body.model,
      device: body.device,
      message: body.error,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Lokale video-server niet bereikbaar",
    };
  }
}

export async function createLocalVideoJob(
  input: VideoGenerationInput,
  baseUrl?: string
): Promise<{ id: string; status: VideoPredictionStatus }> {
  const url = localBaseUrl(baseUrl);
  const res = await fetch(`${url}/v1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: input.imageDataUrl,
      prompt: input.prompt,
      negative_prompt: input.negativePrompt,
      duration: input.duration ?? 5,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const body = (await res.json().catch(() => ({}))) as LocalJobResponse & {
    error?: string;
  };

  if (!res.ok) {
    throw new Error(body.error ?? "Lokale video-server start mislukt");
  }

  return {
    id: body.id,
    status: body.status ?? "starting",
  };
}

function resolveLocalVideoUrl(body: LocalJobStatusResponse): string | null {
  if (body.videoBase64) {
    return `data:video/mp4;base64,${body.videoBase64}`;
  }
  if (body.videoUrl?.startsWith("http")) {
    return body.videoUrl;
  }
  return null;
}

export async function getLocalVideoJob(
  jobId: string,
  baseUrl?: string
): Promise<
  VideoJobResult & {
    progress?: string;
    progressPercent?: number;
    elapsedSeconds?: number;
  }
> {
  const url = localBaseUrl(baseUrl);
  const res = await fetch(`${url}/v1/jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const body = (await res.json().catch(() => ({}))) as LocalJobStatusResponse & {
    error?: string;
  };

  if (!res.ok) {
    return {
      status: "failed",
      videoUrl: null,
      error: body.error ?? "Lokale job-status ophalen mislukt",
    };
  }

  const status = body.status ?? "processing";

  if (status === "succeeded") {
    return {
      status,
      videoUrl: resolveLocalVideoUrl(body),
      error: body.videoUrl || body.videoBase64 ? null : "Geen video ontvangen",
      progress: body.progress,
      progressPercent: body.progressPercent,
      elapsedSeconds: body.elapsedSeconds,
    };
  }

  if (status === "failed" || status === "canceled") {
    return {
      status,
      videoUrl: null,
      error: body.error ?? "Lokale video-generatie mislukt",
      progress: body.progress,
      progressPercent: body.progressPercent,
      elapsedSeconds: body.elapsedSeconds,
    };
  }

  return {
    status,
    videoUrl: null,
    error: null,
    progress: body.progress,
    progressPercent: body.progressPercent,
    elapsedSeconds: body.elapsedSeconds,
  };
}
