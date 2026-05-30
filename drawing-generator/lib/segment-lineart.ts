import type { RawMask } from "@/lib/mask-utils";
import { computeBBoxFromIndices } from "@/lib/mask-utils";
import { dedupeMasksByIoU, relabelMasks } from "@/lib/mask-refine";

const INK_LUM = 128;
const PAPER_LUM = 195;

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Segmenteer lijntekeningen (coloring-book) via achtergrond-flood-fill.
 * Alles dat niet via wit bereikbaar is vanaf de rand = een afgesloten object.
 */
export function segmentLineArtFromRaw(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  maxParts = 10,
  minAreaRatio = 0.004
): RawMask[] {
  const total = width * height;
  const isInk = new Uint8Array(total);
  const isLight = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    const o = i * channels;
    const lum = luminance(data[o], data[o + 1], data[o + 2]);
    if (lum < INK_LUM) isInk[i] = 1;
    else if (lum > PAPER_LUM) isLight[i] = 1;
  }

  const isBg = new Uint8Array(total);
  const queue: number[] = [];
  const neighbors = [-1, 1, -width, width];

  function seedBorder(x: number, y: number) {
    const i = y * width + x;
    if (isBg[i] || isInk[i] || !isLight[i]) return;
    isBg[i] = 1;
    queue.push(i);
  }

  for (let x = 0; x < width; x++) {
    seedBorder(x, 0);
    seedBorder(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seedBorder(0, y);
    seedBorder(width - 1, y);
  }

  while (queue.length > 0) {
    const idx = queue.pop()!;
    for (const d of neighbors) {
      const ni = idx + d;
      if (ni < 0 || ni >= total) continue;
      if (isBg[ni] || isInk[ni] || !isLight[ni]) continue;
      isBg[ni] = 1;
      queue.push(ni);
    }
  }

  const isFg = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (!isBg[i]) isFg[i] = 1;
  }

  const visited = new Uint8Array(total);
  const components: number[][] = [];
  const minSize = Math.max(50, total * minAreaRatio);
  const diag = [
    -width - 1,
    -width + 1,
    width - 1,
    width + 1,
    ...neighbors,
  ];

  for (let i = 0; i < total; i++) {
    if (!isFg[i] || visited[i]) continue;

    const component: number[] = [];
    const q = [i];
    visited[i] = 1;

    while (q.length > 0) {
      const idx = q.pop()!;
      component.push(idx);
      const x = idx % width;
      const y = Math.floor(idx / width);

      for (const d of diag) {
        const ni = idx + d;
        if (ni < 0 || ni >= total || !isFg[ni] || visited[ni]) continue;
        const nx = ni % width;
        const ny = Math.floor(ni / width);
        if (Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1) continue;
        visited[ni] = 1;
        q.push(ni);
      }
    }

    if (component.length >= minSize) components.push(component);
  }

  components.sort((a, b) => b.length - a.length);

  const masks: RawMask[] = components.slice(0, maxParts).map((indices, i) => {
    const bbox = computeBBoxFromIndices(indices, width);
    return {
      id: `lineart-${i + 1}`,
      label: `Onderdeel ${i + 1}`,
      bbox,
      center: {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
      },
      maskIndices: indices,
    };
  });

  return relabelMasks(dedupeMasksByIoU(masks, 0.62));
}
