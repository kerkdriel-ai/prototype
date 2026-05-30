import type { RawMask } from "@/lib/mask-utils";
import { computeBBoxFromIndices } from "@/lib/mask-utils";

const WHITE_THRESHOLD = 235;
const COLOR_STEP = 22;
const MIN_REGION_RATIO = 0.00035;
const MAX_PARTS = 30;
const MIN_PARTS = 2;

export function isBackgroundPixel(
  r: number,
  g: number,
  b: number,
  a: number
): boolean {
  if (a < 128) return true;
  if (r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD) {
    return true;
  }
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum > 230 && Math.max(r, g, b) - Math.min(r, g, b) < 20) return true;
  return false;
}

export function quantizeColor(r: number, g: number, b: number): number {
  const qr = Math.floor(r / COLOR_STEP) * COLOR_STEP;
  const qg = Math.floor(g / COLOR_STEP) * COLOR_STEP;
  const qb = Math.floor(b / COLOR_STEP) * COLOR_STEP;
  return (qr << 16) | (qg << 8) | qb;
}

export function findColorConnectedComponents(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): number[][] {
  const totalPixels = width * height;
  const colorLabel = new Int32Array(totalPixels).fill(-1);
  const visited = new Uint8Array(totalPixels);
  const minRegionSize = Math.max(30, totalPixels * MIN_REGION_RATIO);
  const components: number[][] = [];

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];

    if (isBackgroundPixel(r, g, b, a)) continue;
    colorLabel[i] = quantizeColor(r, g, b);
  }

  const neighbors = [
    -1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1,
  ];

  for (let i = 0; i < totalPixels; i++) {
    if (visited[i] || colorLabel[i] < 0) continue;

    const targetColor = colorLabel[i];
    const component: number[] = [];
    const queue: number[] = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const idx = queue.pop()!;
      component.push(idx);

      const x = idx % width;
      const y = Math.floor(idx / width);

      for (const delta of neighbors) {
        const ni = idx + delta;
        if (ni < 0 || ni >= totalPixels) continue;
        if (visited[ni] || colorLabel[ni] !== targetColor) continue;

        const nx = ni % width;
        const ny = Math.floor(ni / width);
        if (Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1) continue;

        visited[ni] = 1;
        queue.push(ni);
      }
    }

    if (component.length >= minRegionSize) {
      components.push(component);
    }
  }

  return components;
}

export function findForegroundComponents(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): number[][] {
  const totalPixels = width * height;
  const isFg = new Uint8Array(totalPixels);
  const visited = new Uint8Array(totalPixels);
  const minRegionSize = Math.max(30, totalPixels * MIN_REGION_RATIO);
  const components: number[][] = [];

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * channels;
    if (
      !isBackgroundPixel(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3]
      )
    ) {
      isFg[i] = 1;
    }
  }

  const neighbors = [
    -1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1,
  ];

  for (let i = 0; i < totalPixels; i++) {
    if (!isFg[i] || visited[i]) continue;

    const component: number[] = [];
    const queue: number[] = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const idx = queue.pop()!;
      component.push(idx);
      const x = idx % width;
      const y = Math.floor(idx / width);

      for (const delta of neighbors) {
        const ni = idx + delta;
        if (ni < 0 || ni >= totalPixels || !isFg[ni] || visited[ni]) continue;
        const nx = ni % width;
        const ny = Math.floor(ni / width);
        if (Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1) continue;
        visited[ni] = 1;
        queue.push(ni);
      }
    }

    if (component.length >= minRegionSize) {
      components.push(component);
    }
  }

  return components;
}

export function componentsToMasks(
  components: number[][],
  width: number
): RawMask[] {
  const sorted = [...components].sort((a, b) => b.length - a.length);
  const top = sorted.slice(0, MAX_PARTS);

  return top
    .map((indices, i) => {
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
    })
    .filter((m) => m.bbox.width >= 5 && m.bbox.height >= 5);
}

export function pickBestComponents(
  colorComponents: number[][],
  foregroundComponents: number[][]
): number[][] {
  const colorCount = colorComponents.length;
  const fgCount = foregroundComponents.length;

  if (colorCount >= MIN_PARTS) return colorComponents;
  if (fgCount >= MIN_PARTS) return foregroundComponents;
  return colorCount >= fgCount ? colorComponents : foregroundComponents;
}
