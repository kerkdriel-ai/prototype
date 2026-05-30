import { NextRequest, NextResponse } from "next/server";
import {
  buildFallbackAnimationScript,
  generateAnimationScript,
} from "@/lib/animation-script";
import { hashDataUrl } from "@/lib/image-utils";
import {
  checkRateLimit,
  getScriptRateLimit,
  rateLimitKeyFromRequest,
} from "@/lib/rate-limit";
import { formatRetryAfter } from "@/lib/segment-errors";
import type { Part } from "@/types/drawing";

const scriptCache = new Map<string, ReturnType<typeof buildFallbackAnimationScript>>();

function cacheKey(imageDataUrl: string, parts: Part[]): string {
  const labels = parts
    .map((p) => p.label)
    .sort()
    .join("|");
  return `${hashDataUrl(imageDataUrl)}:${labels}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageDataUrl, parts = [], force } = body as {
      imageDataUrl: string;
      parts?: Part[];
      force?: boolean;
    };

    if (!imageDataUrl?.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Ongeldige afbeelding" },
        { status: 400 }
      );
    }

    if (parts.length === 0) {
      return NextResponse.json(
        { error: "Segmenteer eerst de tekening" },
        { status: 400 }
      );
    }

    const key = cacheKey(imageDataUrl, parts);
    if (!force && scriptCache.has(key)) {
      return NextResponse.json(scriptCache.get(key)!);
    }

    const rateKey = rateLimitKeyFromRequest(request, "script");
    const limit = getScriptRateLimit();
    const rate = checkRateLimit(rateKey, limit);

    if (!rate.allowed) {
      const message = `Te veel script-verzoeken. Probeer het ${formatRetryAfter(rate.retryAfterMs)} opnieuw.`;
      console.warn(
        `[animation-script] 429 key=${rateKey} limit=${rate.limit} retryAfterMs=${rate.retryAfterMs}`
      );
      return NextResponse.json(
        {
          error: message,
          code: "RATE_LIMIT",
          retryAfterMs: rate.retryAfterMs,
          resetAt: rate.resetAt,
          limit: rate.limit,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)),
          },
        }
      );
    }

    const token = process.env.REPLICATE_API_TOKEN;
    let result;

    if (token) {
      const Replicate = (await import("replicate")).default;
      const replicate = new Replicate({ auth: token });
      result = await generateAnimationScript(replicate, imageDataUrl, parts);
    } else {
      result = buildFallbackAnimationScript(parts);
    }

    scriptCache.set(key, result);
    console.info(
      `[animation-script] Generated for ${parts.length} parts (cached=${!force})`
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[animation-script] POST error:", error);
    const message =
      error instanceof Error ? error.message : "Script genereren mislukt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
