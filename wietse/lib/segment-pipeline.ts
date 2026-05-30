import sharp from "sharp";
import type { RawMask } from "@/lib/mask-utils";
import {
  componentsToMasks,
  findColorConnectedComponents,
  findForegroundComponents,
} from "@/lib/segment-components";
import { mergeProximityMasks, relabelMasks } from "@/lib/mask-refine";
import {
  analyzeImage,
  preprocessForProfile,
  PROFILE_CONFIG,
  profileLabel,
  type ImageProfile,
} from "@/lib/segment-analyze";
import { geminiListObjects, sleep } from "@/lib/segment-gemini";
import {
  assignGeminiLabelsToSamMasks,
  labelLocalMasksFromGemini,
} from "@/lib/segment-label";
import { segmentLineArtFromRaw } from "@/lib/segment-lineart";
import { REPLICATE_CALL_DELAY_MS, type SegmentQuality } from "@/lib/segment-models";
import { groundedSamSegment, sam2AutoSegment } from "@/lib/segment-replicate";
import { readImageRaw } from "@/lib/segment-gemini-masks";
import type { SegmentSource } from "@/types/drawing";
import type { ProgressTracker } from "@/lib/segment-progress";

export interface PipelineResult {
  masks: RawMask[];
  width: number;
  height: number;
  source: SegmentSource;
  profile: ImageProfile;
  processed: Buffer;
}

async function localSegmentByProfile(
  processed: Buffer,
  width: number,
  height: number,
  profile: ImageProfile
): Promise<RawMask[]> {
  const raw = await readImageRaw(processed);
  const config = PROFILE_CONFIG[profile.type];

  if (profile.type === "line-art") {
    const masks = segmentLineArtFromRaw(
      raw.data,
      width,
      height,
      raw.channels,
      config.maxParts,
      config.minAreaRatio
    );
    if (masks.length >= 1) return masks;
  }

  let components = findColorConnectedComponents(
    raw.data,
    width,
    height,
    raw.channels
  );

  if (components.length < 2) {
    const fg = findForegroundComponents(raw.data, width, height, raw.channels);
    if (fg.length > components.length) components = fg;
  }

  let masks = componentsToMasks(components, width);
  if (masks.length > 1 && profile.type === "colored-drawing") {
    masks = mergeProximityMasks(masks, width, 40);
  }

  const minArea = Math.max(60, width * height * config.minAreaRatio);
  masks = masks.filter((m) => m.maskIndices.length >= minArea);

  return relabelMasks(masks.slice(0, config.maxParts));
}

export async function runSegmentPipeline(
  buffer: Buffer,
  replicate: InstanceType<typeof import("replicate").default> | null,
  quality: SegmentQuality,
  tracker?: ProgressTracker
): Promise<PipelineResult> {
  tracker?.tick("preprocess", "Afbeelding analyseren...");

  const { profile } = await analyzeImage(buffer);
  const processed = await preprocessForProfile(buffer, profile);
  const meta = await sharp(processed).metadata();
  const width = meta.width ?? 512;
  const height = meta.height ?? 512;
  const config = PROFILE_CONFIG[profile.type];
  const typeLabel = profileLabel(profile);

  let masks: RawMask[] | null = null;
  let source: SegmentSource = "connected-components";

  if (replicate) {
    tracker?.tick(
      "sam2",
      `${typeLabel}: vormen detecteren (SAM2)...`
    );

    try {
      masks = await sam2AutoSegment(
        replicate,
        processed,
        width,
        height,
        profile
      );
      if (masks && masks.length > 0) source = "replicate";
    } catch (err) {
      console.warn(
        "SAM2 mislukt:",
        err instanceof Error ? err.message.slice(0, 80) : err
      );
    }

    await sleep(REPLICATE_CALL_DELAY_MS);

    tracker?.tick(
      "gemini-vision",
      `${typeLabel}: objecten benoemen (Gemini)...`
    );

    let detections = null;
    try {
      detections = await geminiListObjects(
        replicate,
        processed,
        width,
        height,
        profile.type
      );
    } catch (err) {
      console.warn(
        "Gemini mislukt:",
        err instanceof Error ? err.message.slice(0, 80) : err
      );
    }

    tracker?.tick("merge", "Maskers samenvoegen...");

    if (masks && masks.length > 0 && detections && detections.length > 0) {
      masks = assignGeminiLabelsToSamMasks(
        masks,
        detections,
        width,
        height,
        config,
        profile
      );
      source = "gemini-premium";
    } else if (masks && masks.length > 0) {
      masks = relabelMasks(masks.slice(0, config.maxParts));
    } else if (detections && detections.length > 0) {
      masks = await localSegmentByProfile(processed, width, height, profile);
      masks = labelLocalMasksFromGemini(
        masks,
        detections,
        width,
        height,
        config.maxParts
      );
      source = "gemini-premium";
    }

    const minExpected = profile.type === "photo" ? 2 : 3;

    if (
      quality === "premium" &&
      (!masks || masks.length < minExpected) &&
      profile.type !== "line-art"
    ) {
      await sleep(REPLICATE_CALL_DELAY_MS);
      tracker?.tick("grounded-sam", "Extra objecten zoeken...");

      try {
        const grounded = await groundedSamSegment(
          replicate,
          processed,
          width,
          height
        );
        if (grounded && grounded.length > 0) {
          const local = masks ?? [];
          const combined = [...local, ...grounded];
          combined.sort((a, b) => b.maskIndices.length - a.maskIndices.length);
          masks = relabelMasks(
            combined.slice(0, config.maxParts)
          );
          if (detections?.length) {
            masks = labelLocalMasksFromGemini(
              masks,
              detections,
              width,
              height,
              config.maxParts
            );
          }
          source = "grounded-sam";
        }
      } catch (err) {
        console.warn(
          "Grounded SAM mislukt:",
          err instanceof Error ? err.message.slice(0, 80) : err
        );
      }
    }
  }

  if (!masks || masks.length === 0) {
    tracker?.tick("fallback-local", `Lokaal segmenteren (${typeLabel})...`);
    masks = await localSegmentByProfile(processed, width, height, profile);
    source = "connected-components";
  }

  return {
    masks: relabelMasks(masks),
    width,
    height,
    source,
    profile,
    processed,
  };
}

export async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  const { profile } = await analyzeImage(buffer);
  return preprocessForProfile(buffer, profile);
}
