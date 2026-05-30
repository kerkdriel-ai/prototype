/** Image-to-video — snel, goed voor kindertekeningen (Wan 2.6 Flash). */
const DEFAULT_VIDEO_VERSION =
  "735e10a03f2576105c76169aa10afc22179ce07c94001ec7aaaaf9c6b99af47f";

const DEFAULT_VIDEO_MODEL = "wan-video/wan2.6-i2v-flash";

/** Voor replicate.run — formaat owner/name:version */
export const VIDEO_I2V_MODEL =
  process.env.REPLICATE_VIDEO_MODEL ??
  `${DEFAULT_VIDEO_MODEL}:${DEFAULT_VIDEO_VERSION}`;

export function getVideoModelVersion(): string {
  const raw = process.env.REPLICATE_VIDEO_MODEL ?? DEFAULT_VIDEO_MODEL;
  const colon = raw.indexOf(":");
  if (colon > 0) return raw.slice(colon + 1);
  return process.env.REPLICATE_VIDEO_VERSION ?? DEFAULT_VIDEO_VERSION;
}

export function getVideoModelRunRef(): `${string}/${string}:${string}` {
  const raw = process.env.REPLICATE_VIDEO_MODEL ?? DEFAULT_VIDEO_MODEL;
  const colon = raw.indexOf(":");
  const name = colon > 0 ? raw.slice(0, colon) : raw;
  return `${name}:${getVideoModelVersion()}` as `${string}/${string}:${string}`;
}

/** Wan 2.6 Flash: alleen 5, 10 of 15 seconden. */
export function normalizeVideoDuration(seconds?: number): 5 | 10 | 15 {
  const n = seconds ?? Number(process.env.REPLICATE_VIDEO_DURATION ?? "5");
  if (n >= 13) return 15;
  if (n >= 8) return 10;
  return 5;
}

export type VideoMotionStyle = "magical" | "playful" | "gentle";

export const VIDEO_MOTION_STYLES: Record<
  VideoMotionStyle,
  { label: string; hint: string }
> = {
  magical: {
    label: "Magisch",
    hint: "zachte magische beweging, fonkelende details",
  },
  playful: {
    label: "Vrolijk",
    hint: "speelse, vrolijke bewegingen, levendig",
  },
  gentle: {
    label: "Rustig",
    hint: "kalme, subtiele beweging, rustig",
  },
};

export const VIDEO_DEFAULT_DURATION = normalizeVideoDuration(
  Number(process.env.REPLICATE_VIDEO_DURATION ?? "5")
);

export const VIDEO_DEFAULT_RESOLUTION =
  process.env.REPLICATE_VIDEO_RESOLUTION ?? "720p";

export function getVideoRateLimit(): number {
  return Number(process.env.SEGMENT_RATE_LIMIT_VIDEO ?? "40");
}
