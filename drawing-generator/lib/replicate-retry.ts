import { REPLICATE_CALL_DELAY_MS } from "@/lib/segment-models";
import { sleep } from "@/lib/segment-gemini";

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("429") || msg.includes("too many requests");
}

/** Wacht tot volgende minuut-venster bij Replicate rate limit (<$5 ≈ 6 req/min). */
function rateLimitWaitMs(attempt: number): number {
  const base = Math.max(REPLICATE_CALL_DELAY_MS, 12_000);
  return base * (attempt + 1) + 5_000;
}

export async function replicateRunWithRetry(
  replicate: InstanceType<typeof import("replicate").default>,
  model: `${string}/${string}` | `${string}/${string}:${string}`,
  input: Record<string, unknown>,
  label?: string
): Promise<unknown> {
  const maxRetries = 5;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await replicate.run(model, { input });
    } catch (err) {
      if (!isRateLimitError(err) || attempt === maxRetries) throw err;

      const waitMs = rateLimitWaitMs(attempt);
      console.warn(
        `${label ?? "Replicate"} rate limit (429), wacht ${Math.round(waitMs / 1000)}s (poging ${attempt + 1}/${maxRetries})`
      );
      await sleep(waitMs);
    }
  }

  throw new Error("Replicate retry exhausted");
}
