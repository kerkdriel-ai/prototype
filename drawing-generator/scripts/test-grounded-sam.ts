import Replicate from "replicate";
import fs from "fs";

async function main() {
  const token = fs
    .readFileSync(".env.local", "utf8")
    .match(/REPLICATE_API_TOKEN=(.+)/)?.[1]
    ?.trim();
  if (!token) throw new Error("No token");

  const replicate = new Replicate({ auth: token });
  const PROMPT =
    "sun, tree, flower, house, person, butterfly, bird, animal, grass, cloud, hammock, table, chair, roof, window, door, leaf, stem, pot";

  const image =
    process.argv[2] ??
    "https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800";

  console.log("Image:", image.slice(0, 60));
  console.log("Running grounded_sam...");
  const out = await replicate.run(
    "schananas/grounded_sam:ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c",
    { input: { image, mask_prompt: PROMPT, adjustment_factor: 2 } }
  );
  console.log("Count:", Array.isArray(out) ? out.length : typeof out);
  if (Array.isArray(out)) {
    out.forEach((u, i) => console.log(`  ${i + 1}.`, String(u).slice(0, 100)));
  }
}

main().catch(console.error);
