import { NextRequest, NextResponse } from "next/server";
import {
  createProgressTracker,
  extractSprites,
  getSegmentStepTotal,
  segmentWithBestModel,
} from "@/lib/segment-server";
import { checkRateLimit, getSegmentRateLimit, rateLimitKeyFromRequest } from "@/lib/rate-limit";
import { formatRetryAfter } from "@/lib/segment-errors";
import {
  encodeStreamEvent,
  type SegmentProgressEvent,
  type SegmentStreamEvent,
} from "@/lib/segment-progress";
import type { SegmentResponse } from "@/types/drawing";
import type { SegmentQuality } from "@/lib/segment-models";
import { getDefaultSegmentQuality } from "@/lib/segment-models";

const serverCache = new Map<string, SegmentResponse>();

async function buildSegmentResponse(
  imageDataUrl: string,
  segmentQuality: SegmentQuality,
  onProgress?: (event: SegmentStreamEvent) => void
): Promise<SegmentResponse> {
  const total = getSegmentStepTotal(segmentQuality);
  const tracker = createProgressTracker(total, (event: SegmentProgressEvent) =>
    onProgress?.(event)
  );

  const base64 = imageDataUrl.split(",")[1];
  const buffer = Buffer.from(base64, "base64");

  const { masks, width, height, source, processed } =
    await segmentWithBestModel(buffer, false, segmentQuality, tracker);

  tracker.tick("sprites", "Onderdelen uitknippen...");

  const sprites = await extractSprites(processed, masks, width);

  return {
    parts: sprites.map(({ mask, imageDataUrl: spriteUrl }) => ({
      id: mask.id,
      label: mask.label,
      bbox: mask.bbox,
      center: mask.center,
      imageDataUrl: spriteUrl,
    })),
    width,
    height,
    source,
    quality: segmentQuality,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageDataUrl, cacheKey, force, quality, stream } = body as {
      imageDataUrl: string;
      cacheKey?: string;
      force?: boolean;
      quality?: SegmentQuality;
      stream?: boolean;
    };

    if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "Ongeldige afbeelding" }, { status: 400 });
    }

    const key = cacheKey ?? imageDataUrl.slice(0, 100);
    const segmentQuality: SegmentQuality =
      quality === "premium" ? "premium" : getDefaultSegmentQuality();

    const cacheId = `${key}:${segmentQuality}`;
    if (!force && serverCache.has(cacheId)) {
      const cached = serverCache.get(cacheId)!;
      if (stream) {
        const bodyStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encodeStreamEvent({
                type: "progress",
                step: "sprites",
                label: "Resultaat geladen uit cache",
                current: 1,
                total: 1,
                percent: 100,
              })
            );
            controller.enqueue(
              encodeStreamEvent({ type: "complete", result: cached })
            );
            controller.close();
          },
        });
        return new Response(bodyStream, {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }
      return NextResponse.json(cached);
    }

    if (force) {
      serverCache.delete(cacheId);
    }

    const rateKey = rateLimitKeyFromRequest(request, segmentQuality);
    const rateLimit = getSegmentRateLimit(segmentQuality);
    const rate = checkRateLimit(rateKey, rateLimit);

    if (!rate.allowed) {
      const retryLabel = formatRetryAfter(rate.retryAfterMs);
      const message = `Te veel segmentatie-verzoeken. Probeer het ${retryLabel} opnieuw.`;

      console.warn(
        `[segment] 429 Rate limit: quality=${segmentQuality} key=${rateKey} limit=${rate.limit} resetAt=${new Date(rate.resetAt).toISOString()} retryAfterMs=${rate.retryAfterMs}`
      );

      return NextResponse.json(
        {
          error: message,
          code: "RATE_LIMIT",
          retryAfterMs: rate.retryAfterMs,
          resetAt: rate.resetAt,
          limit: rate.limit,
          quality: segmentQuality,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)),
          },
        }
      );
    }

    if (stream) {
      const bodyStream = new ReadableStream({
        async start(controller) {
          try {
            const response = await buildSegmentResponse(
              imageDataUrl,
              segmentQuality,
              (event) => controller.enqueue(encodeStreamEvent(event))
            );
            serverCache.set(cacheId, response);
            controller.enqueue(
              encodeStreamEvent({ type: "complete", result: response })
            );
          } catch (error) {
            console.error("Segment stream error:", error);
            controller.enqueue(
              encodeStreamEvent({
                type: "error",
                error: "Segmentatie mislukt. Probeer opnieuw.",
              })
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(bodyStream, {
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }

    const response = await buildSegmentResponse(imageDataUrl, segmentQuality);
    serverCache.set(cacheId, response);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Segment error:", error);
    return NextResponse.json(
      { error: "Segmentatie mislukt. Probeer opnieuw." },
      { status: 500 }
    );
  }
}
