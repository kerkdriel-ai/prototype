import Replicate from "replicate";
import fs from "fs";

async function main() {
  const token = fs
    .readFileSync(".env.local", "utf8")
    .match(/REPLICATE_API_TOKEN=(.+)/)?.[1]
    ?.trim();
  if (!token) throw new Error("No token");

  const replicate = new Replicate({ auth: token });
  const image =
    process.argv[2] ??
    "https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800";

  const out = await replicate.run(
    "adirik/grounding-dino:efd10a8ddc57ea28773327e881ce95e20cc1d734c589f7dd01d2036921ed78aa",
    {
      input: {
        image,
        query: "sun . tree . flower . house . person . butterfly . bird . animal . grass . cloud",
        box_threshold: 0.2,
        text_threshold: 0.2,
        show_visualisation: false,
      },
    }
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch(console.error);
