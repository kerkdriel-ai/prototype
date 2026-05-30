import type { RawMask } from "@/lib/mask-utils";
import { computeBBoxFromIndices } from "@/lib/mask-utils";
import { isGenericPartLabel } from "@/lib/part-intelligence";

function bboxGap(a: RawMask["bbox"], b: RawMask["bbox"]): number {
  const dx = Math.max(
    0,
    Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width))
  );
  const dy = Math.max(
    0,
    Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height))
  );
  return Math.sqrt(dx * dx + dy * dy);
}

function mergeMaskGroup(group: RawMask[], width: number): RawMask {
  const combined = new Set<number>();
  for (const m of group) {
    for (const idx of m.maskIndices) combined.add(idx);
  }
  const indices = Array.from(combined);
  const bbox = computeBBoxFromIndices(indices, width);
  const semantic = group.find((m) => !isGenericPartLabel(m.label));
  return {
    id: "merged",
    label: semantic?.label ?? "merged",
    bbox,
    center: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 },
    maskIndices: indices,
  };
}

/** Voeg nabije kleurvlakken samen tot object-clusters (lokale fallback). */
export function mergeProximityMasks(
  masks: RawMask[],
  width: number,
  gapThreshold = 28
): RawMask[] {
  if (masks.length <= 1) return masks;

  const parent = masks.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (let i = 0; i < masks.length; i++) {
    for (let j = i + 1; j < masks.length; j++) {
      if (bboxGap(masks[i].bbox, masks[j].bbox) <= gapThreshold) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, RawMask[]>();
  for (let i = 0; i < masks.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(masks[i]);
  }

  let labelIndex = 1;
  return Array.from(groups.values()).map((group) => {
    const merged = mergeMaskGroup(group, width);
    return {
      ...merged,
      id: `part-${labelIndex}`,
      label: `Onderdeel ${labelIndex++}`,
    };
  });
}

/** Connected components op een binair mask (8-connected). */
export function findBinaryMaskComponents(
  maskData: Uint8Array,
  width: number,
  height: number,
  minSize: number
): number[][] {
  const total = width * height;
  const visited = new Uint8Array(total);
  const components: number[][] = [];
  const neighbors = [
    -1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1,
  ];

  for (let i = 0; i < total; i++) {
    if (maskData[i] < 128 || visited[i]) continue;

    const component: number[] = [];
    const queue = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const idx = queue.pop()!;
      component.push(idx);
      const x = idx % width;
      const y = Math.floor(idx / width);

      for (const delta of neighbors) {
        const ni = idx + delta;
        if (ni < 0 || ni >= total || visited[ni] || maskData[ni] < 128) continue;
        const nx = ni % width;
        const ny = Math.floor(ni / width);
        if (Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1) continue;
        visited[ni] = 1;
        queue.push(ni);
      }
    }

    if (component.length >= minSize) components.push(component);
  }

  return components;
}

export function maskComponentsToRawMasks(
  components: number[][],
  width: number,
  maxParts = 24
): RawMask[] {
  const sorted = [...components].sort((a, b) => b.length - a.length);
  return sorted.slice(0, maxParts).map((indices, i) => {
    const bbox = computeBBoxFromIndices(indices, width);
    return {
      id: `part-${i + 1}`,
      label: `Onderdeel ${i + 1}`,
      bbox,
      center: {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
      },
      maskIndices: indices,
    };
  });
}

/** IoU-deduplicatie: verwijder bijna-identieke masks (niet containment van deeltjes). */
export function dedupeMasksByIoU(
  masks: RawMask[],
  iouThreshold = 0.75
): RawMask[] {
  if (masks.length <= 1) return masks;

  const sorted = [...masks].sort(
    (a, b) => b.maskIndices.length - a.maskIndices.length
  );
  const kept: RawMask[] = [];

  for (const candidate of sorted) {
    const candSet = new Set(candidate.maskIndices);
    const duplicate = kept.some((k) => {
      const kSet = new Set(k.maskIndices);
      let intersection = 0;
      for (const idx of candidate.maskIndices) {
        if (kSet.has(idx)) intersection++;
      }
      const union = candSet.size + kSet.size - intersection;
      return union > 0 && intersection / union >= iouThreshold;
    });
    if (!duplicate) {
      kept.push(candidate);
    } else {
      const matchIdx = kept.findIndex((k) => {
        const kSet = new Set(k.maskIndices);
        let intersection = 0;
        for (const idx of candidate.maskIndices) {
          if (kSet.has(idx)) intersection++;
        }
        const union = candSet.size + kSet.size - intersection;
        return union > 0 && intersection / union >= iouThreshold;
      });
      if (
        matchIdx >= 0 &&
        isGenericPartLabel(kept[matchIdx].label) &&
        !isGenericPartLabel(candidate.label)
      ) {
        kept[matchIdx] = { ...kept[matchIdx], label: candidate.label };
      }
    }
  }

  return kept;
}

export function filterMasksByAreaBand(
  masks: RawMask[],
  width: number,
  height: number,
  minRatio = 0.003,
  maxRatio = 0.4
): RawMask[] {
  const total = width * height;
  const minArea = Math.max(60, total * minRatio);
  const maxArea = total * maxRatio;
  return masks.filter((m) => {
    const a = m.maskIndices.length;
    return a >= minArea && a <= maxArea;
  });
}

export function relabelMasks(masks: RawMask[]): RawMask[] {
  return masks.map((m, i) => ({
    ...m,
    id: `part-${i + 1}`,
    label: isGenericPartLabel(m.label) ? `Onderdeel ${i + 1}` : m.label,
  }));
}

/** SAM auto-masks: behoud object-grote masks, dedupe duplicaten. */
export function refineSamMasks(
  masks: RawMask[],
  width: number,
  height: number
): RawMask[] {
  let result = filterMasksByAreaBand(masks, width, height, 0.003, 0.35);
  result = dedupeMasksByIoU(result, 0.7);
  result.sort((a, b) => b.maskIndices.length - a.maskIndices.length);
  return relabelMasks(result.slice(0, 24));
}

/** Grounded SAM mask → splits disconnected objecten via CC. */
export function refineGroundedMasks(
  masks: RawMask[],
  width: number,
  height: number
): RawMask[] {
  let result = filterMasksByAreaBand(masks, width, height, 0.0004, 0.5);
  result = dedupeMasksByIoU(result, 0.72);
  result.sort((a, b) => b.maskIndices.length - a.maskIndices.length);
  return relabelMasks(result.slice(0, 24));
}

export function extractGroundedMaskUrl(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  const urls = output.map(String);
  return (
    urls.find(
      (u) =>
        u.includes("mask.jpg") &&
        !u.includes("inverted") &&
        !u.includes("annotated") &&
        !u.includes("neg_")
    ) ?? null
  );
}

export function extractSamMaskUrls(output: unknown): string[] {
  if (Array.isArray(output)) {
    return output.filter((x): x is string => typeof x === "string");
  }
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    if (Array.isArray(obj.individual_masks)) {
      return obj.individual_masks.filter(
        (x): x is string => typeof x === "string"
      );
    }
  }
  return [];
}
