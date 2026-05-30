import { SegmentApiError, formatRetryAfter } from "@/lib/segment-errors";
import type { AnimationScriptResult } from "@/lib/animation-script";
import type { Part } from "@/types/drawing";

export async function fetchAnimationScript(opts: {
  imageDataUrl: string;
  parts: Part[];
  force?: boolean;
}): Promise<AnimationScriptResult> {
  const response = await fetch("/api/animation-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });

  const body = (await response.json().catch(() => ({}))) as AnimationScriptResult & {
    error?: string;
    code?: string;
    retryAfterMs?: number;
    limit?: number;
  };

  if (response.status === 429 || body.code === "RATE_LIMIT") {
    throw new SegmentApiError({
      message:
        body.error ??
        `Limiet bereikt. Probeer het ${formatRetryAfter(body.retryAfterMs ?? 3_600_000)} opnieuw.`,
      code: "RATE_LIMIT",
      retryAfterMs: body.retryAfterMs,
      status: 429,
      limit: body.limit,
    });
  }

  if (!response.ok) {
    throw new Error(body.error ?? "Script genereren mislukt");
  }

  return {
    summary: body.summary,
    script: body.script,
    moments: body.moments ?? [],
  };
}
