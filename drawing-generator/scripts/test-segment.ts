import sharp from "sharp";
import { connectedComponentSegment } from "../lib/segment-server";

async function main() {
  const width = 400;
  const height = 300;
  const data = Buffer.alloc(width * height * 4, 255);

  function fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number
  ) {
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

  fillRect(50, 50, 80, 80, 220, 50, 50);
  fillRect(200, 60, 100, 70, 50, 100, 220);
  fillRect(300, 180, 60, 60, 240, 200, 30);
  for (let x = 50; x < 350; x++) {
    const i = (250 * width + x) * 4;
    data[i] = 20;
    data[i + 1] = 20;
    data[i + 2] = 20;
    data[i + 3] = 255;
  }

  const buf = await sharp(data, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();

  const result = await connectedComponentSegment(buf);
  console.log("Parts:", result.masks.length);
  for (const m of result.masks) {
    console.log(
      ` - ${m.label} ${m.bbox.width}x${m.bbox.height} (${m.maskIndices.length}px)`
    );
  }
}

main();
