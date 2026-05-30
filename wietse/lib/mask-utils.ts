import type { BBox, SegmentPartResponse } from "@/types/drawing";

export interface RawMask {
  id: string;
  label: string;
  bbox: BBox;
  center: { x: number; y: number };
  maskIndices: number[];
}

export function mergeNearbyMasks(
  masks: RawMask[],
  width: number,
  height: number,
  distanceThreshold = 30
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
      const a = masks[i];
      const b = masks[j];
      const dx = a.center.x - b.center.x;
      const dy = a.center.y - b.center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const overlapX =
        a.bbox.x < b.bbox.x + b.bbox.width && a.bbox.x + a.bbox.width > b.bbox.x;
      const overlapY =
        a.bbox.y < b.bbox.y + b.bbox.height && a.bbox.y + a.bbox.height > b.bbox.y;
      if (dist < distanceThreshold || (overlapX && overlapY)) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < masks.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  const merged: RawMask[] = [];
  let labelIndex = 1;
  for (const indices of groups.values()) {
    const combinedIndices = new Set<number>();
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    for (const idx of indices) {
      for (const pi of masks[idx].maskIndices) {
        combinedIndices.add(pi);
        const x = pi % width;
        const y = Math.floor(pi / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    merged.push({
      id: `part-${labelIndex++}`,
      label: `Onderdeel ${labelIndex - 1}`,
      bbox: {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      },
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      maskIndices: Array.from(combinedIndices),
    });
  }

  return merged;
}

export function computeBBoxFromIndices(
  indices: number[],
  width: number
): BBox {
  let minX = width;
  let minY = Infinity;
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

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function mergePartsClient(
  parts: SegmentPartResponse[],
  selectedIds: string[]
): Promise<SegmentPartResponse[]> {
  if (selectedIds.length < 2) return parts;

  const selected = parts.filter((p) => selectedIds.includes(p.id));
  const remaining = parts.filter((p) => !selectedIds.includes(p.id));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = 0;

  for (const part of selected) {
    minX = Math.min(minX, part.bbox.x);
    minY = Math.min(minY, part.bbox.y);
    maxX = Math.max(maxX, part.bbox.x + part.bbox.width);
    maxY = Math.max(maxY, part.bbox.y + part.bbox.height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = maxX - minX;
  canvas.height = maxY - minY;
  const ctx = canvas.getContext("2d")!;

  const images = await Promise.all(
    selected.map((part) => loadImageElement(part.imageDataUrl))
  );

  images.forEach((img, i) => {
    ctx.drawImage(
      img,
      selected[i].bbox.x - minX,
      selected[i].bbox.y - minY
    );
  });

  const merged: SegmentPartResponse = {
    id: `merged-${Date.now()}`,
    label: `Samengevoegd (${selected.length})`,
    bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    imageDataUrl: canvas.toDataURL("image/png"),
  };

  return [...remaining, merged];
}
