/** Waar de video gegenereerd wordt. */
export type VideoProvider = "replicate" | "local";

export interface VideoGenerationInput {
  imageDataUrl: string;
  prompt: string;
  negativePrompt?: string;
  duration?: number;
  resolution?: string;
}

export type VideoPredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export interface VideoJobResult {
  status: VideoPredictionStatus;
  videoUrl: string | null;
  error: string | null;
}

export interface VideoProviderHealth {
  ok: boolean;
  model?: string;
  device?: string;
  message?: string;
}

export const VIDEO_PROVIDER_OPTIONS: Record<
  VideoProvider,
  { label: string; description: string }
> = {
  replicate: {
    label: "Replicate (cloud)",
    description: "Wan 2.6 Flash — snel, volgt prompts en scripts goed",
  },
  local: {
    label: "Lokaal (mijn computer)",
    description:
      "Python-server op je Mac/GPU — geen cloudkosten, langzamer opstart",
  },
};

export function getDefaultVideoProvider(): VideoProvider {
  const v = process.env.DEFAULT_VIDEO_PROVIDER?.toLowerCase();
  return v === "local" ? "local" : "replicate";
}

export function getLocalVideoApiUrl(): string {
  return (
    process.env.LOCAL_VIDEO_API_URL?.replace(/\/$/, "") ??
    "http://127.0.0.1:8765"
  );
}

export function isLocalPredictionId(id: string): boolean {
  return id.startsWith("local-");
}

export function stripLocalPredictionPrefix(id: string): string {
  return id.startsWith("local-") ? id.slice("local-".length) : id;
}

export const LOCAL_VIDEO_PROVIDER_STORAGE_KEY = "tekening-animator-video-provider";
