import { VIDEO_MOTION_STYLES } from "@/lib/video-models";
import { VIDEO_PROVIDER_OPTIONS, type VideoProvider } from "@/lib/video-types";
import type { AiVideoRecord, Drawing } from "@/types/drawing";

export function ensureVideoId(video: AiVideoRecord): AiVideoRecord {
  if (video.id) return video;
  return { ...video, id: `legacy-${video.createdAt}` };
}

/** Alle opgeslagen video's (inclusief legacy enkelvoudig veld). */
export function getDrawingVideos(
  drawing: Pick<Drawing, "aiVideo" | "aiVideos">
): AiVideoRecord[] {
  const list = (drawing.aiVideos ?? []).map(ensureVideoId);

  if (drawing.aiVideo) {
    const legacy = ensureVideoId(drawing.aiVideo);
    const exists = list.some(
      (v) => v.id === legacy.id || (v.url === legacy.url && v.createdAt === legacy.createdAt)
    );
    if (!exists) list.push(legacy);
  }

  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export function createVideoRecord(
  partial: Omit<AiVideoRecord, "id"> & { id?: string }
): AiVideoRecord {
  return ensureVideoId({
    ...partial,
    id: partial.id ?? crypto.randomUUID(),
  });
}

export function appendVideoToDrawing<T extends Pick<Drawing, "aiVideo" | "aiVideos">>(
  drawing: T,
  video: AiVideoRecord
): T & { aiVideos: AiVideoRecord[]; aiVideo?: undefined } {
  const record = createVideoRecord(video);
  const existing = getDrawingVideos(drawing).filter((v) => v.id !== record.id);

  return {
    ...drawing,
    aiVideos: [record, ...existing],
    aiVideo: undefined,
  };
}

export function formatVideoDate(createdAt: number): string {
  return new Date(createdAt).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatVideoProvider(provider?: VideoProvider): string {
  if (!provider) return "Onbekend";
  return VIDEO_PROVIDER_OPTIONS[provider].label;
}

export function formatVideoModel(video: AiVideoRecord): string {
  const provider = video.provider ?? (video.model.startsWith("local/") ? "local" : "replicate");

  if (provider === "local") {
    const variant =
      video.model.includes("cogvideox") ? "CogVideoX" : "Stable Video Diffusion";
    return `Lokaal · ${variant}`;
  }

  if (video.model.includes("wan")) return "Replicate · Wan 2.6 Flash I2V";
  if (video.model.includes("/")) return video.model.split("/").pop() ?? video.model;

  return video.model;
}

export function formatVideoSource(video: AiVideoRecord): string {
  if (video.fromScript) return "Van animatiescript";
  return "Handmatige prompt";
}

export function formatVideoStyle(video: AiVideoRecord): string {
  return VIDEO_MOTION_STYLES[video.style]?.label ?? video.style;
}

export function videoDownloadFilename(
  drawingName: string,
  video: AiVideoRecord
): string {
  const safe = drawingName.replace(/\s+/g, "-").toLowerCase();
  const stamp = new Date(video.createdAt)
    .toISOString()
    .slice(0, 16)
    .replace(/[:T]/g, "-");
  return `${safe}-${stamp}.mp4`;
}
