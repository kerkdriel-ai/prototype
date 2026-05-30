import fs from "fs";
import { preprocessImage, segmentWithBestModel } from "../lib/segment-server";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/test-segment-full.ts <image.png>");
    process.exit(1);
  }
  const buffer = fs.readFileSync(path);
  const processed = await preprocessImage(buffer);
  const result = await segmentWithBestModel(processed, true);
  console.log("Source:", result.source);
  console.log("Parts:", result.masks.length);
  for (const m of result.masks) {
    console.log(
      ` - ${m.label}: ${m.bbox.width}x${m.bbox.height} (${m.maskIndices.length}px)`
    );
  }
}

main().catch(console.error);
