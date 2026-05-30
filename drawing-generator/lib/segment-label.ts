import type { RawMask } from "@/lib/mask-utils";
import { computeBBoxFromIndices } from "@/lib/mask-utils";
import type { GeminiDetection } from "@/lib/segment-gemini";
import {
  detectionToBBox,
  labelMasksFromDetections,
} from "@/lib/segment-gemini";
import {
  dedupeMasksByIoU,
  filterMasksByAreaBand,
  relabelMasks,
} from "@/lib/mask-refine";
import type { ImageProfile, ImageProfileConfig } from "@/lib/segment-analyze";
import { isGenericPartLabel, normalizePartLabel } from "@/lib/part-intelligence";
import type { BBox } from "@/types/drawing";

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

function scoreSamForDetection(
  detBbox: BBox,
  centerIdx: number,
  sam: RawMask,
  width: number
): number {
  const centerHit = sam.maskIndices.includes(centerIdx) ? 1 : 0;
  let insideDet = 0;

  for (const idx of sam.maskIndices) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (
      x >= detBbox.x &&
      x <= detBbox.x + detBbox.width &&
      y >= detBbox.y &&
      y <= detBbox.y + detBbox.height
    ) {
      insideDet++;
    }
  }

  const insideFrac = insideDet / Math.max(1, sam.maskIndices.length);
  const iou = bboxIoU(detBbox, sam.bbox);
  return centerHit * 0.35 + insideFrac * 0.45 + iou * 0.2;
}

export function filterSamMasksForProfile(
  masks: RawMask[],
  width: number,
  height: number,
  config: ImageProfileConfig
): RawMask[] {
  let filtered = filterMasksByAreaBand(
    masks,
    width,
    height,
    config.minAreaRatio,
    config.maxAreaRatio
  );
  filtered = dedupeMasksByIoU(filtered, 0.68);
  filtered.sort((a, b) => b.maskIndices.length - a.maskIndices.length);
  return filtered.slice(0, config.maxParts + 8);
}

/** Koppel Gemini-detecties aan SAM2-silhouetten (één-op-één). */
export function assignGeminiLabelsToSamMasks(
  samMasks: RawMask[],
  detections: GeminiDetection[],
  width: number,
  height: number,
  config: ImageProfileConfig,
  profile: ImageProfile
): RawMask[] {
  const filtered = filterSamMasksForProfile(samMasks, width, height, config);
  const usedSam = new Set<string>();
  const result: RawMask[] = [];
  const total = width * height;

  const sortedDets = [...detections]
    .filter((d) => d.label && !isGenericPartLabel(d.label))
    .sort((a, b) => b.w * b.h - a.w * a.h);

  for (const det of sortedDets) {
    const detBbox = detectionToBBox(det, width, height);
    const cx = Math.round(((det.x + det.w / 2) / 100) * width);
    const cy = Math.round(((det.y + det.h / 2) / 100) * height);
    const centerIdx = cy * width + cx;

    let bestSam: RawMask | null = null;
    let bestScore = profile.type === "photo" ? 0.12 : 0.16;

    for (const sam of filtered) {
      if (usedSam.has(sam.id)) continue;
      const score = scoreSamForDetection(detBbox, centerIdx, sam, width);
      if (score > bestScore) {
        bestScore = score;
        bestSam = sam;
      }
    }

    if (bestSam) {
      usedSam.add(bestSam.id);
      const bbox = computeBBoxFromIndices(bestSam.maskIndices, width);
      result.push({
        ...bestSam,
        id: `part-${result.length + 1}`,
        label: normalizePartLabel(det.label, 0),
        bbox,
        center: {
          x: bbox.x + bbox.width / 2,
          y: bbox.y + bbox.height / 2,
        },
      });
    }
  }

  const unlabeledMin =
    profile.type === "photo" ? config.minAreaRatio * 0.85 : config.minAreaRatio;

  for (const sam of filtered) {
    if (usedSam.has(sam.id)) continue;
    if (sam.maskIndices.length < total * unlabeledMin) continue;
    if (result.length >= config.maxParts) break;

    const bbox = computeBBoxFromIndices(sam.maskIndices, width);
    result.push({
      ...sam,
      id: `part-${result.length + 1}`,
      label: profile.type === "photo" ? "Persoon" : sam.label,
      bbox,
      center: {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
      },
    });
  }

  result.sort((a, b) => b.maskIndices.length - a.maskIndices.length);
  return relabelMasks(dedupeMasksByIoU(result, 0.55).slice(0, config.maxParts));
}

/** Label lokale maskers via Gemini-bboxes. */
export function labelLocalMasksFromGemini(
  masks: RawMask[],
  detections: GeminiDetection[],
  width: number,
  height: number,
  maxParts: number
): RawMask[] {
  if (detections.length === 0) return relabelMasks(masks.slice(0, maxParts));
  return relabelMasks(
    labelMasksFromDetections(masks, detections, width, height).slice(0, maxParts)
  );
}
