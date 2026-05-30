import sharp from "sharp";
import { quantizeColor } from "@/lib/segment-components";

export type ImageType = "line-art" | "colored-drawing" | "photo";

export interface ImageProfile {
  type: ImageType;
  inkRatio: number;
  colorCount: number;
  meanSaturation: number;
  meanLuminance: number;
  luminanceStd: number;
}

export interface ImageProfileConfig {
  maxParts: number;
  minAreaRatio: number;
  maxAreaRatio: number;
  samPointsPerSide: number;
  samPredIou: number;
  samStability: number;
}

export const PROFILE_CONFIG: Record<ImageType, ImageProfileConfig> = {
  "line-art": {
    maxParts: 10,
    minAreaRatio: 0.004,
    maxAreaRatio: 0.45,
    samPointsPerSide: 32,
    samPredIou: 0.5,
    samStability: 0.65,
  },
  "colored-drawing": {
    maxParts: 16,
    minAreaRatio: 0.0025,
    maxAreaRatio: 0.38,
    samPointsPerSide: 48,
    samPredIou: 0.55,
    samStability: 0.72,
  },
  photo: {
    maxParts: 20,
    minAreaRatio: 0.0012,
    maxAreaRatio: 0.42,
    samPointsPerSide: 64,
    samPredIou: 0.48,
    samStability: 0.68,
  },
};

function pixelLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function pixelSaturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

export function computeImageProfile(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): ImageProfile {
  const total = width * height;
  let inkCount = 0;
  let satSum = 0;
  let lumSum = 0;
  const lumSamples: number[] = [];
  const colors = new Set<number>();

  for (let i = 0; i < total; i++) {
    const o = i * channels;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const lum = pixelLuminance(r, g, b);
    const sat = pixelSaturation(r, g, b);

    lumSum += lum;
    satSum += sat;
    lumSamples.push(lum);

    if (lum < 115) inkCount++;
    if (lum < 240) colors.add(quantizeColor(r, g, b));
  }

  const inkRatio = inkCount / total;
  const meanLuminance = lumSum / total;
  const meanSaturation = satSum / total;
  const lumMean = meanLuminance;
  let lumVar = 0;
  for (const l of lumSamples) lumVar += (l - lumMean) ** 2;
  const luminanceStd = Math.sqrt(lumVar / total);

  let type: ImageType = "colored-drawing";

  const lowColor = colors.size < 28;
  const sparseInk = inkRatio > 0.008 && inkRatio < 0.22;
  const highContrast = luminanceStd > 55;
  const lowSat = meanSaturation < 0.18;
  const paperLike = meanLuminance > 175;

  if (sparseInk && lowColor && highContrast && lowSat && paperLike) {
    type = "line-art";
  } else if (
    inkRatio >= 0.3 ||
    (inkRatio >= 0.24 && colors.size > 250 && meanSaturation > 0.22)
  ) {
    type = "photo";
  } else if (paperLike && inkRatio < 0.28) {
    type = "colored-drawing";
  }

  return {
    type,
    inkRatio,
    colorCount: colors.size,
    meanSaturation,
    meanLuminance,
    luminanceStd,
  };
}

export async function analyzeImage(buffer: Buffer): Promise<{
  profile: ImageProfile;
  sampleWidth: number;
  sampleHeight: number;
}> {
  const { data, info } = await sharp(buffer)
    .resize(640, 640, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const profile = computeImageProfile(
    data,
    info.width,
    info.height,
    info.channels
  );

  return { profile, sampleWidth: info.width, sampleHeight: info.height };
}

export async function preprocessForProfile(
  buffer: Buffer,
  profile: ImageProfile
): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const maxDim = profile.type === "photo" ? 1280 : 1024;
  let pipeline = sharp(buffer);

  if ((meta.width ?? 0) > maxDim || (meta.height ?? 0) > maxDim) {
    pipeline = pipeline.resize(maxDim, maxDim, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  switch (profile.type) {
    case "line-art":
      return pipeline
        .sharpen({ sigma: 0.6 })
        .linear(1.08, -12)
        .png()
        .toBuffer();
    case "colored-drawing":
      return pipeline
        .normalize()
        .modulate({ brightness: 1.04, saturation: 1.2 })
        .png()
        .toBuffer();
    case "photo":
      return pipeline.png().toBuffer();
  }
}

export function profileLabel(profile: ImageProfile): string {
  switch (profile.type) {
    case "line-art":
      return "Lijntekening";
    case "photo":
      return "Foto";
    default:
      return "Kleurtekening";
  }
}
