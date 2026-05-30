import type { RawMask } from "@/lib/mask-utils";
import { computeBBoxFromIndices } from "@/lib/mask-utils";
import {
  findColorConnectedComponents,
  isBackgroundPixel,
} from "@/lib/segment-components";
import { dedupeMasksByIoU, relabelMasks } from "@/lib/mask-refine";
import type { GeminiDetection } from "@/lib/segment-gemini";
import {
  MIN_MASK_AREA_RATIO,
  PREMIUM_MAX_PARTS,
} from "@/lib/segment-models";
import type { BBox } from "@/types/drawing";
import { isGenericPartLabel, normalizePartLabel } from "@/lib/part-intelligence";

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

function clipIndicesToBBox(
  indices: number[],
  bbox: BBox,
  width: number,
  padding = 0.1
): number[] {
  const x0 = bbox.x - bbox.width * padding;
  const y0 = bbox.y - bbox.height * padding;
  const x1 = bbox.x + bbox.width * (1 + padding);
  const y1 = bbox.y + bbox.height * (1 + padding);

  return indices.filter((idx) => {
    const x = idx % width;
    const y = Math.floor(idx / width);
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  });
}

function componentCentroid(indices: number[], width: number) {
  let sx = 0;
  let sy = 0;
  for (const idx of indices) {
    sx += idx % width;
    sy += Math.floor(idx / width);
  }
  const n = Math.max(1, indices.length);
  return { x: sx / n, y: sy / n };
}

/** Kleurcomponenten binnen detectie — echte inktvorm, geen rechthoek. */
function extractColorComponentsForDetection(
  det: GeminiDetection,
  components: number[][],
  width: number,
  height: number,
  minPixels: number,
  maxPixels: number
): number[] {
  const bbox = detectionToBBox(det, width, height);
  const pad = 0.06;
  const x0 = Math.max(0, Math.floor(bbox.x - bbox.width * pad));
  const y0 = Math.max(0, Math.floor(bbox.y - bbox.height * pad));
  const x1 = Math.min(width - 1, Math.ceil(bbox.x + bbox.width * (1 + pad)));
  const y1 = Math.min(height - 1, Math.ceil(bbox.y + bbox.height * (1 + pad)));
  const { cx, cy } = detectionCenter(det, width, height);
  const centerIdx = cy * width + cx;

  const matched = new Set<number>();

  for (const comp of components) {
    let inBbox = 0;
    let hitsCenter = false;

    for (const idx of comp) {
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      inBbox++;
      if (idx === centerIdx) hitsCenter = true;
    }

    if (inBbox === 0) continue;

    const overlapFrac = inBbox / comp.length;
    const centroid = componentCentroid(comp, width);
    const centroidInside =
      centroid.x >= bbox.x &&
      centroid.x <= bbox.x + bbox.width &&
      centroid.y >= bbox.y &&
      centroid.y <= bbox.y + bbox.height;

    if (
      hitsCenter ||
      overlapFrac > 0.3 ||
      (centroidInside && overlapFrac > 0.08)
    ) {
      for (const idx of comp) {
        const x = idx % width;
        const y = Math.floor(idx / width);
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) matched.add(idx);
      }
    }
  }

  const indices = Array.from(matched);
  if (indices.length > maxPixels) {
    indices.sort((a, b) => {
      const ax = a % width;
      const ay = Math.floor(a / width);
      const bx = b % width;
      const by = Math.floor(b / width);
      const da = (ax - cx) ** 2 + (ay - cy) ** 2;
      const db = (bx - cx) ** 2 + (by - cy) ** 2;
      return da - db;
    });
    return indices.slice(0, maxPixels);
  }

  return indices.length >= minPixels ? indices : [];
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

/** Vervang bbox-maskers door SAM2-silhouetten; behoud Gemini-labels. */
export function applySamShapesToDetections(
  detections: GeminiDetection[],
  samMasks: RawMask[],
  fallbackMasks: RawMask[],
  width: number,
  height: number,
  maxParts = PREMIUM_MAX_PARTS
): RawMask[] {
  const largeSam = filterLargeMasks(samMasks, width, height, samMasks.length);
  const usedSam = new Set<string>();
  const usedFallback = new Set<string>();
  const result: RawMask[] = [];

  const sortedDets = [...detections].sort((a, b) => b.w * b.h - a.w * a.h);

  for (const det of sortedDets) {
    if (!det.label || isGenericPartLabel(det.label)) continue;

    const detBbox = detectionToBBox(det, width, height);
    const { cx, cy } = detectionCenter(det, width, height);
    const centerIdx = cy * width + cx;

    let bestSam: RawMask | null = null;
    let bestScore = 0;

    for (const sam of largeSam) {
      if (usedSam.has(sam.id)) continue;
      const score = scoreSamForDetection(detBbox, centerIdx, sam, width);
      if (score > bestScore) {
        bestScore = score;
        bestSam = sam;
      }
    }

    if (bestSam && bestScore >= 0.18) {
      usedSam.add(bestSam.id);
      let indices = clipIndicesToBBox(
        bestSam.maskIndices,
        detBbox,
        width,
        0.15
      );
      if (indices.length < 40) indices = bestSam.maskIndices;

      const computed = computeBBoxFromIndices(indices, width);
      result.push({
        id: `gemini-${result.length + 1}`,
        label: normalizePartLabel(det.label, 0),
        bbox: computed,
        center: {
          x: computed.x + computed.width / 2,
          y: computed.y + computed.height / 2,
        },
        maskIndices: indices,
      });
      continue;
    }

    let bestFb: RawMask | null = null;
    let bestFbScore = 0;
    for (const fb of fallbackMasks) {
      if (usedFallback.has(fb.id)) continue;
      const score =
        bboxIoU(detBbox, fb.bbox) * 0.6 +
        (fb.maskIndices.includes(centerIdx) ? 0.4 : 0);
      if (score > bestFbScore) {
        bestFbScore = score;
        bestFb = fb;
      }
    }

    if (bestFb && bestFbScore >= 0.12) {
      usedFallback.add(bestFb.id);
      result.push({
        ...bestFb,
        id: `gemini-${result.length + 1}`,
        label: normalizePartLabel(det.label, 0),
      });
    }
  }

  const deduped = dedupeMasksByIoU(result, 0.55);
  return filterLargeMasks(deduped, width, height, maxParts);
}

function detectionToBBox(
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

function detectionCenter(det: GeminiDetection, width: number, height: number) {
  return {
    cx: Math.round(((det.x + det.w / 2) / 100) * width),
    cy: Math.round(((det.y + det.h / 2) / 100) * height),
  };
}

function colorDistance(
  data: Buffer,
  offset: number,
  channels: number,
  r: number,
  g: number,
  b: number
): number {
  return Math.sqrt(
    (data[offset] - r) ** 2 +
      (data[offset + 1] - g) ** 2 +
      (data[offset + 2] - b) ** 2
  );
}

function floodFillFromPoint(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  startX: number,
  startY: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tolerance: number,
  minPixels: number,
  maxPixels: number
): number[] {
  const sx = Math.max(0, Math.min(width - 1, startX));
  const sy = Math.max(0, Math.min(height - 1, startY));
  const startIdx = sy * width + sx;
  const startOffset = startIdx * channels;

  if (
    isBackgroundPixel(
      data[startOffset],
      data[startOffset + 1],
      data[startOffset + 2],
      data[startOffset + 3]
    )
  ) {
    return [];
  }

  const seedR = data[startOffset];
  const seedG = data[startOffset + 1];
  const seedB = data[startOffset + 2];
  const visited = new Uint8Array(width * height);
  const indices: number[] = [];
  const queue = [startIdx];
  const neighbors = [-1, 1, -width, width];

  while (queue.length > 0 && indices.length < maxPixels) {
    const idx = queue.pop()!;
    if (visited[idx]) continue;

    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;

    const offset = idx * channels;
    if (
      isBackgroundPixel(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3]
      )
    ) {
      continue;
    }

    if (colorDistance(data, offset, channels, seedR, seedG, seedB) > tolerance) {
      continue;
    }

    visited[idx] = 1;
    indices.push(idx);

    for (const delta of neighbors) {
      const ni = idx + delta;
      if (ni >= 0 && ni < width * height && !visited[ni]) {
        queue.push(ni);
      }
    }
  }

  return indices.length >= minPixels ? indices : [];
}

/** Flood fill op elke aangrenzende niet-achtergrond pixel — vangt meerkleurige objecten. */
function floodFillForeground(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  startX: number,
  startY: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  maxPixels: number
): number[] {
  const sx = Math.max(0, Math.min(width - 1, startX));
  const sy = Math.max(0, Math.min(height - 1, startY));
  const startIdx = sy * width + sx;
  const startOffset = startIdx * channels;

  if (
    isBackgroundPixel(
      data[startOffset],
      data[startOffset + 1],
      data[startOffset + 2],
      data[startOffset + 3]
    )
  ) {
    return [];
  }

  const visited = new Uint8Array(width * height);
  const indices: number[] = [];
  const queue = [startIdx];
  const neighbors = [-1, 1, -width, width];

  while (queue.length > 0 && indices.length < maxPixels) {
    const idx = queue.pop()!;
    if (visited[idx]) continue;

    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;

    const offset = idx * channels;
    if (
      isBackgroundPixel(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3]
      )
    ) {
      continue;
    }

    visited[idx] = 1;
    indices.push(idx);

    for (const delta of neighbors) {
      const ni = idx + delta;
      if (ni >= 0 && ni < width * height && !visited[ni]) {
        queue.push(ni);
      }
    }
  }

  return indices;
}

function findSeedPointsInBBox(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number
): Array<{ x: number; y: number }> {
  const seeds: Array<{ x: number; y: number }> = [];
  const seen = new Set<number>();

  function tryAdd(x: number, y: number) {
    const sx = Math.max(x0, Math.min(x1, x));
    const sy = Math.max(y0, Math.min(y1, y));
    const idx = sy * width + sx;
    if (seen.has(idx)) return;
    const offset = idx * channels;
    if (
      isBackgroundPixel(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3]
      )
    ) {
      return;
    }
    seen.add(idx);
    seeds.push({ x: sx, y: sy });
  }

  tryAdd(cx, cy);

  const steps = 5;
  for (let gy = 0; gy < steps; gy++) {
    for (let gx = 0; gx < steps; gx++) {
      const x = Math.round(x0 + ((gx + 0.5) / steps) * (x1 - x0));
      const y = Math.round(y0 + ((gy + 0.5) / steps) * (y1 - y0));
      tryAdd(x, y);
    }
  }

  return seeds;
}

function extractConnectedComponentAt(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  startIdx: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  maxPixels: number
): number[] {
  const sx = startIdx % width;
  const sy = Math.floor(startIdx / width);
  return floodFillForeground(
    data,
    width,
    height,
    channels,
    sx,
    sy,
    x0,
    y0,
    x1,
    y1,
    maxPixels
  );
}

/** Grootste foreground-component in bbox die het detectiecentrum raakt. */
function extractLargestComponentInBBox(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  minPixels: number,
  maxPixels: number
): number[] {
  const visited = new Uint8Array(width * height);
  let best: number[] = [];

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = y * width + x;
      if (visited[idx]) continue;

      const offset = idx * channels;
      if (
        isBackgroundPixel(
          data[offset],
          data[offset + 1],
          data[offset + 2],
          data[offset + 3]
        )
      ) {
        continue;
      }

      const component = extractConnectedComponentAt(
        data,
        width,
        height,
        channels,
        idx,
        x0,
        y0,
        x1,
        y1,
        maxPixels
      );
      for (const pi of component) visited[pi] = 1;

      if (component.length <= best.length) continue;

      const containsCenter = component.some((pi) => {
        const px = pi % width;
        const py = Math.floor(pi / width);
        return Math.abs(px - cx) <= 2 && Math.abs(py - cy) <= 2;
      });
      if (containsCenter || component.length > best.length * 1.4) {
        best = component;
      }
    }
  }

  return best.length >= minPixels ? best : [];
}

function maskFillRatio(indices: number[], bbox: BBox): number {
  const bboxArea = Math.max(1, bbox.width * bbox.height);
  return indices.length / bboxArea;
}

function extractMaskForDetection(
  det: GeminiDetection,
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  minPixels: number,
  maxPixels: number
): number[] {
  const bbox = detectionToBBox(det, width, height);
  const pad = 0.05;
  const x0 = Math.max(0, Math.floor(bbox.x - bbox.width * pad));
  const y0 = Math.max(0, Math.floor(bbox.y - bbox.height * pad));
  const x1 = Math.min(width - 1, Math.ceil(bbox.x + bbox.width * (1 + pad)));
  const y1 = Math.min(height - 1, Math.ceil(bbox.y + bbox.height * (1 + pad)));

  const { cx, cy } = detectionCenter(det, width, height);
  const minFill = Math.max(40, minPixels * 0.35);
  const seeds = findSeedPointsInBBox(
    data,
    width,
    height,
    channels,
    x0,
    y0,
    x1,
    y1,
    cx,
    cy
  );

  let best: number[] = [];

  for (const seed of seeds) {
    const fg = floodFillForeground(
      data,
      width,
      height,
      channels,
      seed.x,
      seed.y,
      x0,
      y0,
      x1,
      y1,
      maxPixels
    );
    if (fg.length > best.length) best = fg;
    if (best.length >= minPixels) break;
  }

  if (best.length >= minFill && maskFillRatio(best, bbox) < 0.82) {
    return best;
  }

  for (const tolerance of [35, 55, 80]) {
    for (const seed of seeds.slice(0, 8)) {
      const indices = floodFillFromPoint(
        data,
        width,
        height,
        channels,
        seed.x,
        seed.y,
        x0,
        y0,
        x1,
        y1,
        tolerance,
        minFill,
        maxPixels
      );
      if (indices.length > best.length) best = indices;
      if (best.length >= minPixels && maskFillRatio(best, bbox) < 0.82) {
        return best;
      }
    }
  }

  const connected = extractLargestComponentInBBox(
    data,
    width,
    height,
    channels,
    x0,
    y0,
    x1,
    y1,
    cx,
    cy,
    minFill,
    maxPixels
  );
  if (connected.length >= minFill) return connected;

  return best.length >= minFill ? best : [];
}

function maskIoU(a: RawMask, b: RawMask): number {
  const bSet = new Set(b.maskIndices);
  let intersection = 0;
  for (const idx of a.maskIndices) {
    if (bSet.has(idx)) intersection++;
  }
  const union = a.maskIndices.length + b.maskIndices.length - intersection;
  return union > 0 ? intersection / union : 0;
}

export function filterLargeMasks(
  masks: RawMask[],
  width: number,
  height: number,
  maxParts = PREMIUM_MAX_PARTS
): RawMask[] {
  const totalPixels = width * height;
  const minPixels = Math.max(80, totalPixels * MIN_MASK_AREA_RATIO);
  const minDim = Math.max(18, Math.min(width, height) * 0.028);

  const large = masks.filter((m) => {
    if (m.maskIndices.length < minPixels) return false;
    if (m.bbox.width < minDim && m.bbox.height < minDim) return false;
    return true;
  });

  large.sort((a, b) => b.maskIndices.length - a.maskIndices.length);
  return large.slice(0, maxParts);
}

export function buildMasksFromDetections(
  detections: GeminiDetection[],
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  maxParts = PREMIUM_MAX_PARTS
): RawMask[] {
  const totalPixels = width * height;
  const globalMinPixels = Math.max(80, totalPixels * MIN_MASK_AREA_RATIO);
  const masks: RawMask[] = [];
  const colorComponents = findColorConnectedComponents(
    data,
    width,
    height,
    channels
  );

  for (const det of detections) {
    if (!det.label || isGenericPartLabel(det.label)) continue;

    const detPixels = (det.w / 100) * width * ((det.h / 100) * height);
    const minPixels = Math.max(
      globalMinPixels,
      Math.min(detPixels * 0.03, totalPixels * 0.002)
    );
    const maxPixels = Math.max(minPixels * 6, detPixels * 2.2);

    let indices = extractColorComponentsForDetection(
      det,
      colorComponents,
      width,
      height,
      minPixels,
      maxPixels
    );

    const detBbox = detectionToBBox(det, width, height);
    if (
      indices.length < minPixels * 0.5 ||
      maskFillRatio(indices, detBbox) > 0.78
    ) {
      const filled = extractMaskForDetection(
        det,
        data,
        width,
        height,
        channels,
        minPixels,
        maxPixels
      );
      if (
        filled.length > indices.length &&
        maskFillRatio(filled, detBbox) < 0.78
      ) {
        indices = filled;
      } else if (indices.length < minPixels * 0.5) {
        indices = filled;
      }
    }

    if (indices.length < minPixels * 0.7) continue;

    const computed = computeBBoxFromIndices(indices, width);

    masks.push({
      id: `gemini-${masks.length + 1}`,
      label: normalizePartLabel(det.label, 0),
      bbox: computed,
      center: {
        x: computed.x + computed.width / 2,
        y: computed.y + computed.height / 2,
      },
      maskIndices: indices,
    });
  }

  const deduped = dedupeMasksByIoU(masks, 0.55);
  return filterLargeMasks(deduped, width, height, maxParts);
}

export function mergeGeminiAndSam(
  geminiMasks: RawMask[],
  samMasks: RawMask[] | null | undefined,
  width: number,
  height: number,
  maxParts = PREMIUM_MAX_PARTS
): RawMask[] {
  const kept = [...geminiMasks];

  if (samMasks) {
    const largeSam = filterLargeMasks(samMasks, width, height, maxParts);
    for (const sam of largeSam) {
      const dominated = kept.some((g) => maskIoU(g, sam) > 0.38);
      if (!dominated) kept.push(sam);
    }
  }

  kept.sort((a, b) => b.maskIndices.length - a.maskIndices.length);
  const deduped = dedupeMasksByIoU(kept, 0.68);
  return relabelMasks(filterLargeMasks(deduped, width, height, maxParts));
}

export async function readImageRaw(processed: Buffer): Promise<{
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(processed)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}
