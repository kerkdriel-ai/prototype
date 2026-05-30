/**
 * Test segmentatie op voorbeeldafbeeldingen (lokaal + optioneel Replicate).
 * Gebruik: npx tsx scripts/test-segment-samples.ts [--local-only]
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { analyzeImage, profileLabel } from "../lib/segment-analyze";
import { preprocessForProfile } from "../lib/segment-analyze";
import { segmentLineArtFromRaw } from "../lib/segment-lineart";
import { readImageRaw } from "../lib/segment-gemini-masks";
import { connectedComponentSegment } from "../lib/segment-server";

const SAMPLES = [
  "download-d7c50298-75a6-42ba-bd93-2e203ea45ff7.png",
  "zomer-in-het-bos-klein-c7c8b31f-06f5-452b-90e8-26c36fb25bef.png",
  "IMG_0134-f0140c53-1513-482a-a57a-8638a0e659a4.png",
];

const assetsDir =
  process.env.SEGMENT_ASSETS_DIR ??
  path.join(
    process.env.HOME ?? "",
    ".cursor/projects/Users-wietseneven-Projects-drawing-generator/assets"
  );

async function testSample(filename: string) {
  const filePath = path.join(assetsDir, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`SKIP ${filename} (not found)`);
    return;
  }

  const buffer = fs.readFileSync(filePath);
  const { profile } = await analyzeImage(buffer);
  const processed = await preprocessForProfile(buffer, profile);
  const meta = await sharp(processed).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  console.log(`\n=== ${filename} ===`);
  console.log(
    `Type: ${profileLabel(profile)} | ink=${(profile.inkRatio * 100).toFixed(1)}% colors=${profile.colorCount}`
  );

  let masks;
  if (profile.type === "line-art") {
    const raw = await readImageRaw(processed);
    masks = segmentLineArtFromRaw(raw.data, w, h, raw.channels, 10, 0.004);
  } else {
    const result = await connectedComponentSegment(processed, true);
    masks = result.masks;
  }

  console.log(`Parts: ${masks.length}`);
  for (const m of masks.slice(0, 12)) {
    const fill = (
      (m.maskIndices.length / (m.bbox.width * m.bbox.height)) *
      100
    ).toFixed(0);
    console.log(
      `  ${m.label}: ${Math.round(m.bbox.width)}×${Math.round(m.bbox.height)} fill=${fill}% px=${m.maskIndices.length}`
    );
  }
}

async function main() {
  for (const f of SAMPLES) await testSample(f);
}

main();
