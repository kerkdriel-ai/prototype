import type { SegmentResponse } from "@/types/drawing";
import type { SegmentQuality } from "@/lib/segment-models";
import type {
  SegmentProgressEvent,
  SegmentStreamEvent,
} from "@/lib/segment-progress";
import { hashDataUrl } from "@/lib/image-utils";
import {
  SegmentApiError,
  formatRetryAfter,
} from "@/lib/segment-errors";

const segmentCache = new Map<string, SegmentResponse>();

function cacheKeyFor(imageDataUrl: string, quality: SegmentQuality): string {
  return `${hashDataUrl(imageDataUrl)}:${quality}`;
}

export function getCachedSegment(
  imageDataUrl: string,
  quality: SegmentQuality
): SegmentResponse | undefined {
  return segmentCache.get(cacheKeyFor(imageDataUrl, quality));
}

export function setCachedSegment(
  imageDataUrl: string,
  result: SegmentResponse
): void {
  segmentCache.set(cacheKeyFor(imageDataUrl, result.quality), result);
}

export async function segmentDrawing(
  imageDataUrl: string,
  options: {
    force?: boolean;
    quality?: SegmentQuality;
    onProgress?: (event: SegmentProgressEvent) => void;
  } = {}
): Promise<SegmentResponse> {
  const { force = false, quality = "standard", onProgress } = options;
  const cacheKey = hashDataUrl(imageDataUrl);

  if (!force) {
    const cached = getCachedSegment(imageDataUrl, quality);
    if (cached) return cached;
  } else {
    segmentCache.delete(cacheKeyFor(imageDataUrl, quality));
  }

  const response = await fetch("/api/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageDataUrl,
      cacheKey,
      force,
      quality,
      stream: Boolean(onProgress),
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      retryAfterMs?: number;
      limit?: number;
    };

    if (response.status === 429 || body.code === "RATE_LIMIT") {
      const retryAfterMs = body.retryAfterMs ?? 3_600_000;
      const base =
        body.error ??
        `Segmentatie-limiet bereikt. Probeer het ${formatRetryAfter(retryAfterMs)} opnieuw.`;
      throw new SegmentApiError({
        message: base,
        code: "RATE_LIMIT",
        retryAfterMs,
        status: 429,
        limit: body.limit,
      });
    }

    throw new SegmentApiError({
      message: body.error ?? "Segmentatie mislukt",
      code: "API_ERROR",
      status: response.status,
    });
  }

  if (onProgress && response.body) {
    const result = await readSegmentStream(response.body, onProgress);
    setCachedSegment(imageDataUrl, result);
    return result;
  }

  const result = (await response.json()) as SegmentResponse;
  setCachedSegment(imageDataUrl, result);
  return result;
}

async function readSegmentStream(
  body: ReadableStream<Uint8Array>,
  onProgress: (event: SegmentProgressEvent) => void
): Promise<SegmentResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: SegmentResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as SegmentStreamEvent;

      if (event.type === "progress") {
        onProgress(event);
      } else if (event.type === "complete") {
        result = event.result;
        onProgress({
          type: "progress",
          step: "sprites",
          label: "Klaar!",
          current: event.result.parts.length > 0 ? 1 : 0,
          total: 1,
          percent: 100,
        });
      } else if (event.type === "error") {
        throw new Error(event.error);
      }
    }
  }

  if (!result) {
    throw new Error("Segmentatie mislukt");
  }

  return result;
}

export { SegmentApiError, formatRetryAfter } from "@/lib/segment-errors";

export async function colorClusterFallback(
  imageDataUrl: string
): Promise<SegmentResponse> {
  const img = await loadImage(imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { width, height } = canvas;
  const data = imageData.data;
  const totalPixels = width * height;
  const minRegionSize = Math.max(50, totalPixels * 0.002);

  const colorRegions = new Map<string, number[]>();

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];

    if (a < 128 || (r > 240 && g > 240 && b > 240)) continue;

    const key = `${Math.floor(r / 32) * 32},${Math.floor(g / 32) * 32},${Math.floor(b / 32) * 32}`;
    if (!colorRegions.has(key)) colorRegions.set(key, []);
    colorRegions.get(key)!.push(i);
  }

  const regions = Array.from(colorRegions.entries())
    .filter(([, indices]) => indices.length >= minRegionSize)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 12);

  const parts = regions.map(([, indices], i) => {
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    for (const idx of indices) {
      const x = idx % width;
      const y = Math.floor(idx / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const spriteCanvas = document.createElement("canvas");
    spriteCanvas.width = bw;
    spriteCanvas.height = bh;
    const spriteCtx = spriteCanvas.getContext("2d")!;
    const indexSet = new Set(indices);

    const spriteData = spriteCtx.createImageData(bw, bh);
    for (let py = 0; py < bh; py++) {
      for (let px = 0; px < bw; px++) {
        const srcIdx = (minY + py) * width + (minX + px);
        const dstOffset = (py * bw + px) * 4;
        if (indexSet.has(srcIdx)) {
          const srcOffset = srcIdx * 4;
          spriteData.data[dstOffset] = data[srcOffset];
          spriteData.data[dstOffset + 1] = data[srcOffset + 1];
          spriteData.data[dstOffset + 2] = data[srcOffset + 2];
          spriteData.data[dstOffset + 3] = data[srcOffset + 3];
        }
      }
    }
    spriteCtx.putImageData(spriteData, 0, 0);

    return {
      id: `part-${i + 1}`,
      label: `Onderdeel ${i + 1}`,
      bbox: { x: minX, y: minY, width: bw, height: bh },
      center: { x: minX + bw / 2, y: minY + bh / 2 },
      imageDataUrl: spriteCanvas.toDataURL("image/png"),
    };
  });

  return { parts, width, height, source: "color-cluster", quality: "standard" };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}
