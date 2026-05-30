import type { VideoMotionStyle } from "@/lib/video-models";
import type { VideoProvider } from "@/lib/video-types";
import { SegmentApiError, formatRetryAfter } from "@/lib/segment-errors";
import type { AiVideoRecord } from "@/types/drawing";

export type { AiVideoRecord };

export interface StartVideoResponse {
  predictionId: string;
  prompt: string;
  cached?: boolean;
  videoUrl?: string;
  provider?: VideoProvider;
}

export interface VideoStatusResponse {
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  videoUrl?: string;
  error?: string;
  prompt?: string;
  progress?: string;
}

export async function startAiVideoGeneration(opts: {
  imageDataUrl: string;
  partLabels: string[];
  style?: VideoMotionStyle;
  customPrompt?: string;
  elementInstructions?: import("@/lib/video-prompt-suggestions").VideoElementInstruction[];
  sceneNote?: string;
  scriptNarrative?: string;
  force?: boolean;
  cacheKey?: string;
  provider?: VideoProvider;
}): Promise<StartVideoResponse> {
  const response = await fetch("/api/animate-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });

  const body = (await response.json().catch(() => ({}))) as StartVideoResponse & {
    error?: string;
    code?: string;
    retryAfterMs?: number;
    limit?: number;
  };

  if (response.status === 429 || body.code === "RATE_LIMIT") {
    throw new SegmentApiError({
      message:
        body.error ??
        `Video-limiet bereikt. Probeer het ${formatRetryAfter(body.retryAfterMs ?? 3_600_000)} opnieuw.`,
      code: "RATE_LIMIT",
      retryAfterMs: body.retryAfterMs,
      status: 429,
      limit: body.limit,
    });
  }

  if (!response.ok) {
    throw new Error(body.error ?? "Video starten mislukt");
  }

  return body;
}

export async function pollAiVideoStatus(
  predictionId: string
): Promise<VideoStatusResponse> {
  const response = await fetch(
    `/api/animate-video?id=${encodeURIComponent(predictionId)}`
  );

  const body = (await response.json().catch(() => ({}))) as VideoStatusResponse & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(body.error ?? "Status ophalen mislukt");
  }

  return body;
}

export async function waitForAiVideo(
  predictionId: string,
  onProgress?: (status: string) => void,
  intervalMs = 3000,
  maxWaitMs = 600_000
): Promise<string> {
  const isLocal = predictionId.startsWith("local-") || predictionId.startsWith("cached-");
  const waitLimit = isLocal ? 1_800_000 : maxWaitMs;
  const pollInterval = isLocal ? 4000 : intervalMs;
  const start = Date.now();

  while (Date.now() - start < waitLimit) {
    const result = await pollAiVideoStatus(predictionId);

    if (result.status === "succeeded" && result.videoUrl) {
      return result.videoUrl;
    }

    if (result.status === "failed" || result.status === "canceled") {
      throw new Error(result.error ?? "Video-generatie mislukt");
    }

    onProgress?.(
      result.progress ??
        (result.status === "starting"
          ? "Video wordt gestart..."
          : isLocal
            ? "Lokaal model genereert video..."
            : "Video wordt gegenereerd...")
    );

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new Error("Video-generatie duurde te lang. Probeer het later opnieuw.");
}

export function downloadVideoUrl(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".mp4") ? filename : `${filename}.mp4`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.click();
}
