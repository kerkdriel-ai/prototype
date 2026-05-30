import type { RawMask } from "@/lib/mask-utils";
import { computeBBoxFromIndices } from "@/lib/mask-utils";
import type { BBox } from "@/types/drawing";
import { isBackgroundPixel } from "@/lib/segment-components";
import { isGenericPartLabel, normalizePartLabel } from "@/lib/part-intelligence";
import { replicateRunWithRetry } from "@/lib/replicate-retry";
import { buildMasksFromDetections } from "@/lib/segment-gemini-masks";
import type { ImageType } from "@/lib/segment-analyze";
import { PROFILE_CONFIG } from "@/lib/segment-analyze";
import {
  GEMINI_VISION_MODEL,
  MIN_DETECTION_AREA_PCT,
  MIN_DETECTION_H_PCT,
  MIN_DETECTION_W_PCT,
} from "@/lib/segment-models";

export interface GeminiDetection {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const GEMINI_PROMPTS: Record<
  ImageType,
  { system: string; user: string; maxPerLabel: Record<string, number>; maxItems: number }
> = {
  "line-art": {
    system: `You analyze line-art / coloring-book images. Return ONLY a valid JSON array.
Each item: {"label":"Dutch noun","x":0-100,"y":0-100,"w":0-100,"h":0-100}
x,y = top-left in percent. w,h = size in percent.

List each DISTINCT main character or object (max 8):
- Each cartoon character separately (e.g. Stitch, Pikachu)
- Large standalone objects only

Skip: tiny stars, sparkles, background, paper.
Each bbox at least 4% wide AND 4% tall. Valid JSON only.`,
    user: "List each main character or large object in this line drawing as JSON array.",
    maxPerLabel: {},
    maxItems: 8,
  },
  "colored-drawing": {
    system: `You analyze children's drawings. Return ONLY a valid complete JSON array.
Each item: {"label":"Dutch noun","x":0-100,"y":0-100,"w":0-100,"h":0-100}
x,y = top-left corner in percent. w,h = size in percent.

List ONLY the main LARGE objects (max 14):
- Zon, bomen (één bbox per boom)
- Huis, Persoon, Hangmat, Vlinder, Tafel, Stoel
- Bloemen: één bbox voor alle bloemen op de voorgrond

Do NOT list: sky, grass, ground, tiny details, signature.
Each bbox at least 2.5% wide AND 2.5% tall. Valid JSON only.`,
    user: "List the main large objects in this children's drawing as JSON array.",
    maxPerLabel: { bloemen: 1, bloem: 1, vogel: 1, boom: 5, pot: 1 },
    maxItems: 14,
  },
  photo: {
    system: `You analyze photos. Return ONLY a valid JSON array.
Each item: {"label":"Dutch noun","x":0-100,"y":0-100,"w":0-100,"h":0-100}
x,y = top-left in percent. w,h = size in percent.

List visible people and main objects (max 18):
- Each person separately: "Persoon" or descriptive name
- Boat, brug, boom, etc. if prominent

Skip: sky, water surface, grass, tiny background details.
Each bbox at least 2% wide AND 2% tall. Valid JSON only.`,
    user: "List each visible person and main object in this photo as JSON array.",
    maxPerLabel: { persoon: 12, boom: 2 },
    maxItems: 18,
  },
};

export function parseGeminiDetections(
  text: string,
  imageType: ImageType = "colored-drawing"
): GeminiDetection[] {
  const cleaned = text.replace(/```json\s*|```/gi, "").trim();

  const fromArray = tryParseArray(cleaned, imageType);
  if (fromArray.length > 0) return fromArray;

  return prioritizeLargeDetections(parseDetectionObjects(cleaned), imageType);
}

function tryParseArray(
  cleaned: string,
  imageType: ImageType
): GeminiDetection[] {
  const start = cleaned.indexOf("[");
  if (start < 0) return [];

  let json = cleaned.slice(start);
  if (!json.trimEnd().endsWith("]")) {
    json = json.replace(/,\s*$/, "");
    json = json.replace(/,\s*\{[^}]*$/, "");
    if (!json.endsWith("]")) json += "]";
  }

  try {
    const arr = JSON.parse(json) as unknown[];
    const results = arr
      .filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object"
      )
      .map(mapDetectionItem)
      .filter((d): d is GeminiDetection => d !== null);
    return prioritizeLargeDetections(results, imageType);
  } catch {
    return [];
  }
}

function parseDetectionObjects(cleaned: string): GeminiDetection[] {
  const results: GeminiDetection[] = [];
  const re =
    /\{\s*"label"\s*:\s*"([^"]+)"\s*,\s*"x"\s*:\s*([\d.]+)\s*,\s*"y"\s*:\s*([\d.]+)\s*,\s*"w"\s*:\s*([\d.]+)\s*,\s*"h"\s*:\s*([\d.]+)\s*\}/g;

  for (const m of cleaned.matchAll(re)) {
    const det = mapDetectionItem({
      label: m[1],
      x: m[2],
      y: m[3],
      w: m[4],
      h: m[5],
    });
    if (det) results.push(det);
  }
  return results;
}

function mapDetectionItem(item: Record<string, unknown>): GeminiDetection | null {
  const label = sanitizeGeminiLabel(String(item.label ?? ""));
  const x = clampPct(Number(item.x));
  const y = clampPct(Number(item.y));
  const w = clampPct(Number(item.w));
  const h = clampPct(Number(item.h));
  if (!label || w <= 0 || h <= 0) return null;
  if (isBackgroundDetection({ label, x, y, w, h })) return null;
  if (w < MIN_DETECTION_W_PCT || h < MIN_DETECTION_H_PCT) {
    const area = w * h;
    if (area < MIN_DETECTION_AREA_PCT * 1.5) return null;
  }
  if (w * h < MIN_DETECTION_AREA_PCT) return null;
  return { label, x, y, w, h };
}

function isBackgroundDetection(det: GeminiDetection): boolean {
  const lower = det.label.toLowerCase();
  const blocked = [
    "lucht",
    "sky",
    "gras",
    "grass",
    "heuvel",
    "hill",
    "achtergrond",
    "background",
    "handtekening",
    "signature",
    "papier",
    "paper",
    "ground",
    "bodem",
    "landschap",
  ];
  if (blocked.some((b) => lower.includes(b))) return true;
  if (det.w >= 85 && det.h >= 50) return true;
  if (det.w * det.h >= 4500) return true;
  return false;
}

function bboxIoUPct(a: GeminiDetection, b: GeminiDetection): number {
  const ax1 = a.x;
  const ay1 = a.y;
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx1 = b.x;
  const by1 = b.y;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const x0 = Math.max(ax1, bx1);
  const y0 = Math.max(ay1, by1);
  const x1 = Math.min(ax2, bx2);
  const y1 = Math.min(ay2, by2);
  if (x1 <= x0 || y1 <= y0) return 0;
  const inter = (x1 - x0) * (y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function dedupeDetections(detections: GeminiDetection[]): GeminiDetection[] {
  const sorted = [...detections].sort((a, b) => b.w * b.h - a.w * a.h);
  const kept: GeminiDetection[] = [];

  for (const det of sorted) {
    const dup = kept.some((k) => bboxIoUPct(k, det) > 0.35);
    if (!dup) kept.push(det);
  }
  return kept;
}

function prioritizeLargeDetections(
  detections: GeminiDetection[],
  imageType: ImageType = "colored-drawing"
): GeminiDetection[] {
  const cfg = GEMINI_PROMPTS[imageType];
  const deduped = dedupeDetections(detections);
  const sorted = [...deduped].sort((a, b) => b.w * b.h - a.w * a.h);

  const kept: GeminiDetection[] = [];
  const labelCounts = new Map<string, number>();

  for (const det of sorted) {
    const key = det.label.toLowerCase();
    const limit = cfg.maxPerLabel[key] ?? (imageType === "photo" ? 3 : 1);
    const count = labelCounts.get(key) ?? 0;
    if (count >= limit) continue;
    kept.push(det);
    labelCounts.set(key, count + 1);
    if (kept.length >= cfg.maxItems) break;
  }

  return kept;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function sanitizeGeminiLabel(raw: string): string {
  let trimmed = raw.trim().slice(0, 40);
  trimmed = trimmed.replace(/\s*\([^)]*\)/g, "").trim();

  const lower = trimmed.toLowerCase();
  if (lower.includes("hangmat")) return "Hangmat";
  if (lower.includes("persoon") || lower.includes("man") || lower.includes("vrouw")) {
    return "Persoon";
  }
  if (lower.includes("bloempot") || lower.includes("pot")) return "Pot";
  if (lower.startsWith("zon")) return "Zon";
  if (lower.includes("bloem")) return "Bloemen";
  if (lower.includes("boom")) return "Boom";
  if (lower.includes("stitch")) return "Stitch";
  if (lower.includes("pikachu")) return "Pikachu";
  if (lower.includes("boot") || lower.includes("boat")) return "Boot";

  trimmed = trimmed.replace(/^\d+\s*/, "").trim();
  if (!trimmed || isGenericPartLabel(trimmed)) return "";
  const blocked = new Set([
    "object",
    "objects",
    "item",
    "items",
    "thing",
    "drawing",
    "tekening",
    "figuur",
    "shape",
    "vorm",
    "element",
    "onderdeel",
  ]);
  if (blocked.has(lower)) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function detectionToBBox(
  detection: GeminiDetection,
  width: number,
  height: number
): BBox {
  return {
    x: (detection.x / 100) * width,
    y: (detection.y / 100) * height,
    width: (detection.w / 100) * width,
    height: (detection.h / 100) * height,
  };
}

function bboxIoU(a: BBox, b: BBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return 0;
  const inter = (x1 - x0) * (y1 - y0);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function centerInBBox(
  cx: number,
  cy: number,
  bbox: BBox,
  paddingRatio = 0.35
): boolean {
  const padX = bbox.width * paddingRatio;
  const padY = bbox.height * paddingRatio;
  return (
    cx >= bbox.x - padX &&
    cx <= bbox.x + bbox.width + padX &&
    cy >= bbox.y - padY &&
    cy <= bbox.y + bbox.height + padY
  );
}

/** Ken labels toe via bounding-box matching (betrouwbaarder dan pixel-overlap). */
export function labelMasksFromDetections(
  masks: RawMask[],
  detections: GeminiDetection[],
  width: number,
  height: number
): RawMask[] {
  const dets = detections
    .filter((d) => d.label && !isGenericPartLabel(d.label))
    .map((det) => ({ det, bbox: detectionToBBox(det, width, height) }));

  if (dets.length === 0) return masks;

  return masks.map((m) => {
    if (!isGenericPartLabel(m.label)) {
      return { ...m, label: normalizePartLabel(m.label, 0) };
    }

    let bestLabel = "";
    let bestScore = 0.12;

    for (const { det, bbox } of dets) {
      const iou = bboxIoU(m.bbox, bbox);
      const centerHit = centerInBBox(m.center.x, m.center.y, bbox) ? 0.35 : 0;
      const score = iou + centerHit;
      if (score > bestScore) {
        bestScore = score;
        bestLabel = det.label;
      }
    }

    if (bestLabel) {
      return { ...m, label: normalizePartLabel(bestLabel, 0) };
    }

    let bestDist = Infinity;
    for (const { det, bbox } of dets) {
      const cx = bbox.x + bbox.width / 2;
      const cy = bbox.y + bbox.height / 2;
      const dist = (m.center.x - cx) ** 2 + (m.center.y - cy) ** 2;
      const maxDist = Math.max(width, height) * 0.35;
      if (dist < maxDist ** 2 && dist < bestDist) {
        bestDist = dist;
        bestLabel = det.label;
      }
    }

    if (bestLabel) {
      return { ...m, label: normalizePartLabel(bestLabel, 0) };
    }

    return m;
  });
}

async function runGeminiDetection(
  replicate: InstanceType<typeof import("replicate").default>,
  processed: Buffer,
  width: number,
  height: number,
  imageType: ImageType = "colored-drawing"
): Promise<GeminiDetection[] | null> {
  const prompts = GEMINI_PROMPTS[imageType];
  const dataUri = `data:image/png;base64,${processed.toString("base64")}`;

  const output = await replicateRunWithRetry(
    replicate,
    GEMINI_VISION_MODEL as `${string}/${string}:${string}`,
    {
      prompt: prompts.user,
      system_instruction: prompts.system,
      images: [dataUri],
      temperature: 0.1,
      max_output_tokens: 8192,
    },
    "Gemini Vision"
  );

  const text = collectGeminiText(output);
  if (!text) return null;

  const detections = parseGeminiDetections(text, imageType);
  return detections.length > 0 ? detections : null;
}

export async function geminiListObjects(
  replicate: InstanceType<typeof import("replicate").default>,
  processed: Buffer,
  width: number,
  height: number,
  imageType: ImageType = "colored-drawing"
): Promise<GeminiDetection[] | null> {
  return runGeminiDetection(replicate, processed, width, height, imageType);
}

/** @deprecated gebruik geminiListObjects */
export async function geminiDetectObjects(
  replicate: InstanceType<typeof import("replicate").default>,
  processed: Buffer,
  width: number,
  height: number
): Promise<{ detections: GeminiDetection[]; masks: RawMask[] } | null> {
  const detections = await runGeminiDetection(
    replicate,
    processed,
    width,
    height,
    "colored-drawing"
  );
  if (!detections) return null;

  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(processed)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const masks = buildMasksFromDetections(
    detections,
    data,
    width,
    height,
    info.channels,
    PROFILE_CONFIG["colored-drawing"].maxParts
  );

  return { detections, masks };
}

export function detectionToMaskIndices(
  detection: GeminiDetection,
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  paddingPct = 3
): number[] {
  const x0 = Math.max(
    0,
    Math.floor(((detection.x - paddingPct) / 100) * width)
  );
  const y0 = Math.max(
    0,
    Math.floor(((detection.y - paddingPct) / 100) * height)
  );
  const x1 = Math.min(
    width - 1,
    Math.ceil(((detection.x + detection.w + paddingPct) / 100) * width)
  );
  const y1 = Math.min(
    height - 1,
    Math.ceil(((detection.y + detection.h + paddingPct) / 100) * height)
  );

  const indices: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      const offset = i * channels;
      if (
        !isBackgroundPixel(
          data[offset],
          data[offset + 1],
          data[offset + 2],
          data[offset + 3]
        )
      ) {
        indices.push(i);
      }
    }
  }
  return indices;
}

export function detectionsToRawMasks(
  detections: GeminiDetection[],
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  minArea: number
): RawMask[] {
  const masks: RawMask[] = [];

  for (const det of detections) {
    const indices = detectionToMaskIndices(det, data, width, height, channels);
    if (indices.length < minArea) continue;

    const bbox = computeBBoxFromIndices(indices, width);
    masks.push({
      id: `gemini-${masks.length + 1}`,
      label: det.label,
      bbox,
      center: {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
      },
      maskIndices: indices,
    });
  }

  return masks;
}

export async function geminiVisionSegment(
  replicate: InstanceType<typeof import("replicate").default>,
  processed: Buffer,
  width: number,
  height: number,
  imageType: ImageType = "colored-drawing"
): Promise<RawMask[] | null> {
  const detections = await runGeminiDetection(
    replicate,
    processed,
    width,
    height,
    imageType
  );
  if (!detections) return null;

  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(processed)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return buildMasksFromDetections(
    detections,
    data,
    width,
    height,
    info.channels,
    PROFILE_CONFIG[imageType].maxParts
  );
}

function collectGeminiText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output
      .map((chunk) => {
        if (typeof chunk === "string") return chunk;
        if (chunk && typeof chunk === "object" && "text" in chunk) {
          return String((chunk as { text: string }).text);
        }
        return "";
      })
      .join("");
  }
  return JSON.stringify(output);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
