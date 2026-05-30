import sharp from "sharp";
import type { RawMask } from "@/lib/mask-utils";
import { computeBBoxFromIndices } from "@/lib/mask-utils";
import { sleep } from "@/lib/segment-gemini";
import {
  DRAWING_OBJECT_PROMPT,
  DRAWING_PROMPT_GROUPS,
  GROUNDED_SAM_MODEL,
  PREMIUM_MAX_PARTS,
  REPLICATE_CALL_DELAY_MS,
  SAM2_AUTO_MODEL,
  STANDARD_MAX_PARTS,
} from "@/lib/segment-models";
import {
  SAM_PASS_LABELS,
} from "@/lib/segment-progress";
import { replicateRunWithRetry } from "@/lib/replicate-retry";
import {
  dedupeMasksByIoU,
  extractGroundedMaskUrl,
  extractSamMaskUrls,
  filterMasksByAreaBand,
  findBinaryMaskComponents,
  maskComponentsToRawMasks,
  refineGroundedMasks,
  refineSamMasks,
  relabelMasks,
} from "@/lib/mask-refine";

async function loadMaskPixels(
  url: string,
  width: number,
  height: number
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mask download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { data } = await sharp(buf)
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function maskUrlToRawMasks(
  url: string,
  width: number,
  height: number,
  minRegionSize: number
): Promise<RawMask[]> {
  const maskData = await loadMaskPixels(url, width, height);
  const components = findBinaryMaskComponents(
    maskData,
    width,
    height,
    minRegionSize
  );
  return maskComponentsToRawMasks(components, width, PREMIUM_MAX_PARTS);
}

async function maskUrlsToRawMasks(
  urls: string[],
  width: number,
  height: number,
  minRegionSize: number
): Promise<RawMask[]> {
  const all: RawMask[] = [];
  for (const url of urls) {
    const masks = await maskUrlToRawMasks(url, width, height, minRegionSize);
    all.push(...masks);
  }
  return all;
}

async function groundedSamWithPrompt(
  replicate: InstanceType<typeof import("replicate").default>,
  processed: Buffer,
  width: number,
  height: number,
  maskPrompt: string,
  maxParts: number
): Promise<RawMask[] | null> {
  const dataUri = `data:image/png;base64,${processed.toString("base64")}`;
  const totalPixels = width * height;
  const minRegionSize = Math.max(30, totalPixels * 0.0008);

  const output = await replicateRunWithRetry(
    replicate,
    GROUNDED_SAM_MODEL as `${string}/${string}:${string}`,
    {
      image: dataUri,
      mask_prompt: maskPrompt,
      negative_mask_prompt: "paper, background, white, blank, empty",
      adjustment_factor: 3,
    },
    "Grounded SAM"
  );

  const maskUrl = extractGroundedMaskUrl(output);
  if (!maskUrl) return null;

  const masks = await maskUrlToRawMasks(
    maskUrl,
    width,
    height,
    minRegionSize
  );
  if (masks.length === 0) return null;

  return refineGroundedMasks(masks, width, height).slice(0, maxParts);
}

export async function groundedSamSegment(
  replicate: InstanceType<typeof import("replicate").default>,
  processed: Buffer,
  width: number,
  height: number
): Promise<RawMask[] | null> {
  return groundedSamWithPrompt(
    replicate,
    processed,
    width,
    height,
    DRAWING_OBJECT_PROMPT,
    STANDARD_MAX_PARTS
  );
}

export async function multiPassGroundedSamSegment(
  replicate: InstanceType<typeof import("replicate").default>,
  processed: Buffer,
  width: number,
  height: number,
  onPass?: (passIndex: number, label: string) => void
): Promise<RawMask[] | null> {
  const allLists: RawMask[][] = [];
  const total = DRAWING_PROMPT_GROUPS.length;

  for (let i = 0; i < DRAWING_PROMPT_GROUPS.length; i++) {
    if (i > 0) await sleep(REPLICATE_CALL_DELAY_MS);

    onPass?.(
      i,
      SAM_PASS_LABELS[i] ?? `Scannen (${i + 1}/${total})...`
    );

    try {
      const masks = await groundedSamWithPrompt(
        replicate,
        processed,
        width,
        height,
        DRAWING_PROMPT_GROUPS[i],
        PREMIUM_MAX_PARTS
      );
      if (masks && masks.length > 0) allLists.push(masks);
    } catch (err) {
      console.warn(
        `Grounded SAM pass ${i + 1} mislukt:`,
        err instanceof Error ? err.message.slice(0, 80) : err
      );
    }
  }

  return mergeMaskLists(allLists, width, height, PREMIUM_MAX_PARTS);
}

export async function sam2AutoSegment(
  replicate: InstanceType<typeof import("replicate").default>,
  processed: Buffer,
  width: number,
  height: number,
  profile?: import("@/lib/segment-analyze").ImageProfile
): Promise<RawMask[] | null> {
  const { PROFILE_CONFIG } = await import("@/lib/segment-analyze");
  const cfg = PROFILE_CONFIG[profile?.type ?? "colored-drawing"];
  const dataUri = `data:image/png;base64,${processed.toString("base64")}`;
  const totalPixels = width * height;
  const minRegionSize = Math.max(30, totalPixels * cfg.minAreaRatio * 0.6);

  const output = await replicateRunWithRetry(
    replicate,
    SAM2_AUTO_MODEL as `${string}/${string}:${string}`,
    {
      image: dataUri,
      points_per_side: cfg.samPointsPerSide,
      pred_iou_thresh: cfg.samPredIou,
      stability_score_thresh: cfg.samStability,
      use_m2m: true,
    },
    "SAM 2"
  );

  const maskUrls = extractSamMaskUrls(output);
  if (maskUrls.length === 0) return null;

  const rawMasks = await maskUrlsToRawMasks(
    maskUrls,
    width,
    height,
    minRegionSize
  );
  if (rawMasks.length === 0) return null;

  return refineSamMasksForProfile(rawMasks, width, height, cfg);
}

function refineSamMasksForProfile(
  masks: RawMask[],
  width: number,
  height: number,
  cfg: import("@/lib/segment-analyze").ImageProfileConfig
): RawMask[] {
  let result = filterMasksByAreaBand(
    masks,
    width,
    height,
    cfg.minAreaRatio,
    cfg.maxAreaRatio
  );
  result = dedupeMasksByIoU(result, 0.68);
  result.sort((a, b) => b.maskIndices.length - a.maskIndices.length);
  return relabelMasks(result.slice(0, cfg.maxParts + 6));
}

export function mergeMaskLists(
  lists: RawMask[][],
  width: number,
  height: number,
  maxParts = PREMIUM_MAX_PARTS
): RawMask[] | null {
  const combined = lists.flat();
  if (combined.length === 0) return null;

  const deduped = dedupeMasksByIoU(combined, 0.55);
  deduped.sort((a, b) => b.maskIndices.length - a.maskIndices.length);

  return relabelMasks(deduped.slice(0, maxParts));
}

/** @deprecated */
export function applyGeminiLabels(
  _masks: RawMask[],
  _geminiMasks: RawMask[]
): RawMask[] {
  return _masks;
}

export function indicesToRawMask(indices: number[], width: number): RawMask {
  const bbox = computeBBoxFromIndices(indices, width);
  return {
    id: "part",
    label: "part",
    bbox,
    center: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 },
    maskIndices: indices,
  };
}
