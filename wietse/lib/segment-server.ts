import sharp from "sharp";
import type { RawMask } from "@/lib/mask-utils";
import {
  componentsToMasks,
  findColorConnectedComponents,
  findForegroundComponents,
} from "@/lib/segment-components";
import { mergeProximityMasks, relabelMasks } from "@/lib/mask-refine";
import {
  runSegmentPipeline,
  preprocessImage as adaptivePreprocess,
} from "@/lib/segment-pipeline";
import {
  type SegmentQuality,
  getDefaultSegmentQuality,
} from "@/lib/segment-models";
import {
  emitProgress,
  type ProgressTracker,
  type SegmentProgressCallback,
  type SegmentProgressStep,
} from "@/lib/segment-progress";

export function createProgressTracker(
  total: number,
  onProgress?: SegmentProgressCallback
): ProgressTracker {
  let current = 0;
  return {
    tick(step, label) {
      current++;
      emitProgress(onProgress, step, label, current, total);
    },
  };
}

export function getSegmentStepTotal(quality: SegmentQuality): number {
  return quality === "premium" ? 6 : 5;
}

/** @deprecated gebruik adaptivePreprocess via pipeline */
export { adaptivePreprocess as preprocessImage };

export async function connectedComponentSegment(
  buffer: Buffer,
  alreadyProcessed = false
): Promise<{ masks: RawMask[]; width: number; height: number }> {
  const processed = alreadyProcessed ? buffer : await adaptivePreprocess(buffer);
  const { data, info } = await sharp(processed)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

  const colorComponents = findColorConnectedComponents(
    data,
    width,
    height,
    channels
  );
  let components = colorComponents;
  if (components.length < 2) {
    const fg = findForegroundComponents(data, width, height, channels);
    if (fg.length > components.length) components = fg;
  }

  let masks = componentsToMasks(components, width);
  if (masks.length > 1) {
    masks = mergeProximityMasks(masks, width, 36);
  }
  masks = relabelMasks(masks.slice(0, 16));

  return { masks, width, height };
}

export async function colorClusterSegment(
  buffer: Buffer
): Promise<{ masks: RawMask[]; width: number; height: number }> {
  return connectedComponentSegment(buffer);
}

export async function extractSprites(
  buffer: Buffer,
  masks: RawMask[],
  width: number
): Promise<Array<{ mask: RawMask; imageDataUrl: string }>> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const results: Array<{ mask: RawMask; imageDataUrl: string }> = [];

  for (const mask of masks) {
    const { x, y, width: bw, height: bh } = mask.bbox;
    const spriteData = Buffer.alloc(bw * bh * 4, 0);
    const maskSet = new Set(mask.maskIndices);

    for (let py = 0; py < bh; py++) {
      for (let px = 0; px < bw; px++) {
        const srcIdx = (y + py) * width + (x + px);
        if (!maskSet.has(srcIdx)) continue;

        const srcOffset = srcIdx * channels;
        const dstOffset = (py * bw + px) * 4;
        spriteData[dstOffset] = data[srcOffset];
        spriteData[dstOffset + 1] = data[srcOffset + 1];
        spriteData[dstOffset + 2] = data[srcOffset + 2];
        spriteData[dstOffset + 3] = 255;
      }
    }

    const pngBuffer = await sharp(spriteData, {
      raw: { width: bw, height: bh, channels: 4 },
    })
      .png()
      .toBuffer();

    results.push({
      mask,
      imageDataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
    });
  }

  return results;
}

export type SegmentSource =
  | "gemini-premium"
  | "grounded-sam"
  | "replicate"
  | "connected-components"
  | "color-cluster";

export async function segmentWithBestModel(
  buffer: Buffer,
  _alreadyProcessed = false,
  quality: SegmentQuality = getDefaultSegmentQuality(),
  tracker?: ProgressTracker
): Promise<{
  masks: RawMask[];
  width: number;
  height: number;
  source: SegmentSource;
  quality: SegmentQuality;
  processed: Buffer;
}> {
  const token = process.env.REPLICATE_API_TOKEN;
  let replicate: InstanceType<typeof import("replicate").default> | null =
    null;

  if (token) {
    try {
      const Replicate = (await import("replicate")).default;
      replicate = new Replicate({ auth: token });
    } catch (err) {
      console.warn("Replicate init mislukt:", err);
    }
  }

  const result = await runSegmentPipeline(buffer, replicate, quality, tracker);

  return {
    masks: result.masks,
    width: result.width,
    height: result.height,
    source: result.source,
    quality,
    processed: result.processed,
  };
}

/** @deprecated gebruik segmentWithBestModel */
export async function replicateSegment(
  buffer: Buffer,
  alreadyProcessed = false
): Promise<{ masks: RawMask[]; width: number; height: number } | null> {
  const result = await segmentWithBestModel(buffer, alreadyProcessed);
  return { masks: result.masks, width: result.width, height: result.height };
}
