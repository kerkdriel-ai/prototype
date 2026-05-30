import sharp from "sharp";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dynamically import TS modules via building - use inline test instead
async function createTestImage() {
  const width = 400;
  const height = 300;
  const data = Buffer.alloc(width * height * 4, 255);

  function fillRect(x, y, w, h, r, g, b) {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const i = (py * width + px) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
  }

  // Rode cirkel-achtig blok
  fillRect(50, 50, 80, 80, 220, 50, 50);
  // Blauw blok
  fillRect(200, 60, 100, 70, 50, 100, 220);
  // Geel zon
  fillRect(300, 180, 60, 60, 240, 200, 30);
  // Zwart lijn (dun)
  for (let x = 50; x < 350; x++) {
    const i = (250 * width + x) * 4;
    data[i] = 20;
    data[i + 1] = 20;
    data[i + 2] = 20;
  }

  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

const img = await createTestImage();
const base64 = img.toString("base64");
const res = await fetch("http://localhost:3000/api/segment", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    imageDataUrl: `data:image/png;base64,${base64}`,
    force: true,
  }),
});

const json = await res.json();
console.log("Status:", res.status);
console.log("Source:", json.source);
console.log("Parts:", json.parts?.length ?? 0);
json.parts?.forEach((p, i) =>
  console.log(`  ${i + 1}. ${p.label} — ${p.bbox.width}x${p.bbox.height}`)
);
