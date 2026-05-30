import { NextRequest, NextResponse } from "next/server";
import { hashDataUrl } from "@/lib/image-utils";
import {
  checkRateLimit,
  rateLimitKeyFromRequest,
} from "@/lib/rate-limit";
import { formatRetryAfter } from "@/lib/segment-errors";
import { buildVideoPrompt, VIDEO_NEGATIVE_PROMPT } from "@/lib/video-prompt";
import type { VideoElementInstruction } from "@/lib/video-prompt-suggestions";
import {
  checkLocalVideoHealth,
  createLocalVideoJob,
  getLocalVideoJob,
} from "@/lib/video-local";
import {
  createVideoPrediction,
  getVideoPrediction,
} from "@/lib/video-replicate";
import {
  getVideoRateLimit,
  VIDEO_I2V_MODEL,
  type VideoMotionStyle,
} from "@/lib/video-models";
import {
  getDefaultVideoProvider,
  isLocalPredictionId,
  stripLocalPredictionPrefix,
  type VideoProvider,
} from "@/lib/video-types";

const videoCache = new Map<
  string,
  { videoUrl: string; prompt: string; createdAt: number }
>();

const predictionMeta = new Map<
  string,
  { cacheKey: string; prompt: string; provider: VideoProvider }
>();

function cacheKey(
  provider: VideoProvider,
  imageDataUrl: string,
  style: VideoMotionStyle,
  elementInstructions?: VideoElementInstruction[],
  sceneNote?: string,
  customPrompt?: string,
  scriptNarrative?: string
): string {
  const base = hashDataUrl(imageDataUrl);
  const elementsKey = elementInstructions
    ? JSON.stringify(
        elementInstructions
          .filter((e) => e.enabled)
          .map((e) => ({ l: e.label, a: e.action }))
          .sort((a, b) => a.l.localeCompare(b.l))
      )
    : "";
  const narrativeKey = scriptNarrative?.trim()
    ? hashDataUrl(`narrative:${scriptNarrative.trim()}`)
    : "";
  return `${provider}:${base}:${style}:${elementsKey}:${sceneNote?.trim() ?? ""}:${customPrompt?.trim() ?? ""}:${narrativeKey}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      imageDataUrl,
      partLabels = [],
      style = "magical",
      customPrompt,
      elementInstructions,
      sceneNote,
      scriptNarrative,
      force,
      provider = getDefaultVideoProvider(),
    } = body as {
      imageDataUrl: string;
      partLabels?: string[];
      style?: VideoMotionStyle;
      customPrompt?: string;
      elementInstructions?: VideoElementInstruction[];
      sceneNote?: string;
      scriptNarrative?: string;
      force?: boolean;
      provider?: VideoProvider;
    };

    if (!imageDataUrl?.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Ongeldige afbeelding" },
        { status: 400 }
      );
    }

    const key = cacheKey(
      provider,
      imageDataUrl,
      style,
      elementInstructions,
      sceneNote,
      customPrompt,
      scriptNarrative
    );
    if (!force && videoCache.has(key)) {
      const cached = videoCache.get(key)!;
      return NextResponse.json({
        predictionId: `cached-${key}`,
        prompt: cached.prompt,
        cached: true,
        videoUrl: cached.videoUrl,
        provider,
      });
    }

    if (provider !== "local") {
      const rateKey = rateLimitKeyFromRequest(request, "video");
      const limit = getVideoRateLimit();
      const rate = checkRateLimit(rateKey, limit);

      if (!rate.allowed) {
        const message = `Te veel video-verzoeken. Probeer het ${formatRetryAfter(rate.retryAfterMs)} opnieuw.`;
        console.warn(
          `[animate-video] 429 Rate limit: key=${rateKey} limit=${rate.limit} retryAfterMs=${rate.retryAfterMs}`
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
    }

    const prompt = buildVideoPrompt({
      partLabels,
      style,
      customPrompt,
      elementInstructions,
      sceneNote,
      scriptNarrative,
    });

    const videoInput = {
      imageDataUrl,
      prompt,
      negativePrompt: VIDEO_NEGATIVE_PROMPT,
    };

    if (provider === "local") {
      const health = await checkLocalVideoHealth();
      if (!health.ok) {
        return NextResponse.json(
          {
            error:
              health.message ??
              "Lokale video-server niet bereikbaar. Start met: npm run local-video",
            code: "LOCAL_OFFLINE",
          },
          { status: 503 }
        );
      }

      const { id, status } = await createLocalVideoJob(videoInput);
      const predictionId = `local-${id}`;
      predictionMeta.set(predictionId, { cacheKey: key, prompt, provider });

      console.info(
        `[animate-video] Started local job=${id} model=${health.model ?? "svd"}`
      );

      return NextResponse.json({ predictionId, prompt, status, provider });
    }

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "REPLICATE_API_TOKEN niet geconfigureerd" },
        { status: 503 }
      );
    }

    const Replicate = (await import("replicate")).default;
    const replicate = new Replicate({ auth: token });

    const { id, status } = await createVideoPrediction(replicate, videoInput);

    predictionMeta.set(id, { cacheKey: key, prompt, provider: "replicate" });

    console.info(
      `[animate-video] Started prediction=${id} style=${style} model=${VIDEO_I2V_MODEL.split(":")[0]}`
    );

    return NextResponse.json({ predictionId: id, prompt, status, provider: "replicate" });
  } catch (error) {
    console.error("[animate-video] POST error:", error);
    const message =
      error instanceof Error ? error.message : "Video starten mislukt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const health = request.nextUrl.searchParams.get("health");
    if (health === "local") {
      const result = await checkLocalVideoHealth();
      return NextResponse.json(result);
    }

    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "predictionId ontbreekt" }, { status: 400 });
    }

    if (id.startsWith("cached-")) {
      const key = id.slice("cached-".length);
      const cached = videoCache.get(key);
      if (!cached) {
        return NextResponse.json(
          { error: "Cache verlopen" },
          { status: 404 }
        );
      }
      return NextResponse.json({
        status: "succeeded",
        videoUrl: cached.videoUrl,
        prompt: cached.prompt,
      });
    }

    if (isLocalPredictionId(id)) {
      const localId = stripLocalPredictionPrefix(id);
      const result = await getLocalVideoJob(localId);

      if (result.status === "failed" || result.status === "canceled") {
        console.warn(
          `[animate-video] Local job ${localId} ${result.status}: ${result.error}`
        );
      }

      if (result.status === "succeeded" && result.videoUrl) {
        console.info(`[animate-video] Local job ${localId} succeeded`);
        const meta = predictionMeta.get(id);
        if (meta) {
          videoCache.set(meta.cacheKey, {
            videoUrl: result.videoUrl,
            prompt: meta.prompt,
            createdAt: Date.now(),
          });
          predictionMeta.delete(id);
        }
      }

      return NextResponse.json({
        status: result.status,
        videoUrl: result.videoUrl ?? undefined,
        error: result.error ?? undefined,
        progress: result.progress,
      });
    }

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "REPLICATE_API_TOKEN niet geconfigureerd" },
        { status: 503 }
      );
    }

    const Replicate = (await import("replicate")).default;
    const replicate = new Replicate({ auth: token });

    const result = await getVideoPrediction(replicate, id);

    if (result.status === "failed" || result.status === "canceled") {
      console.warn(
        `[animate-video] Prediction ${id} ${result.status}: ${result.error}`
      );
    }

    if (result.status === "succeeded" && result.videoUrl) {
      console.info(`[animate-video] Prediction ${id} succeeded`);
      const meta = predictionMeta.get(id);
      if (meta) {
        videoCache.set(meta.cacheKey, {
          videoUrl: result.videoUrl,
          prompt: meta.prompt,
          createdAt: Date.now(),
        });
        predictionMeta.delete(id);
      }
    }

    return NextResponse.json({
      status: result.status,
      videoUrl: result.videoUrl ?? undefined,
      error: result.error ?? undefined,
    });
  } catch (error) {
    console.error("[animate-video] GET error:", error);
    const message =
      error instanceof Error ? error.message : "Status ophalen mislukt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
