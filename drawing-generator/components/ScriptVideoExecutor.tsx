"use client";

import { useCallback, useMemo, useState } from "react";
import { Download, Film, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  downloadVideoUrl,
  startAiVideoGeneration,
  waitForAiVideo,
} from "@/lib/animate-video";
import { scriptToVideoParams } from "@/lib/script-to-video";
import { buildVideoPrompt } from "@/lib/video-prompt";
import { SegmentApiError } from "@/lib/segment-errors";
import { SegmentRateLimitAlert } from "@/components/SegmentRateLimitAlert";
import {
  loadStoredVideoProvider,
  VideoProviderSelect,
} from "@/components/VideoProviderSelect";
import { VIDEO_I2V_MODEL } from "@/lib/video-models";
import type { VideoProvider } from "@/lib/video-types";
import type {
  AiVideoRecord,
  AnimationScriptRecord,
  Part,
} from "@/types/drawing";

interface ScriptVideoExecutorProps {
  imageDataUrl: string;
  parts: Part[];
  drawingName: string;
  script: AnimationScriptRecord;
  existingVideo?: AiVideoRecord;
  onVideoSaved: (video: AiVideoRecord) => void;
}

export function ScriptVideoExecutor({
  imageDataUrl,
  parts,
  drawingName,
  script,
  existingVideo,
  onVideoSaved,
}: ScriptVideoExecutorProps) {
  const scriptVideo =
    existingVideo?.fromScript &&
    existingVideo.scriptCreatedAt === script.createdAt
      ? existingVideo
      : undefined;

  const [videoUrl, setVideoUrl] = useState<string | null>(
    scriptVideo?.url ?? null
  );
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [rateLimit, setRateLimit] = useState<{
    message: string;
    retryAfterMs?: number;
    limit?: number;
  } | null>(null);
  const [provider, setProvider] = useState<VideoProvider>(() =>
    scriptVideo?.provider ?? loadStoredVideoProvider()
  );

  const videoParams = useMemo(
    () => scriptToVideoParams(script, parts),
    [script, parts]
  );
  const previewPrompt = useMemo(
    () =>
      buildVideoPrompt({
        partLabels: parts.map((p) => p.label),
        ...videoParams,
      }),
    [parts, videoParams]
  );

  const handleGenerate = useCallback(
    async (force = false) => {
      setGenerating(true);
      setRateLimit(null);
      setStatus("Video wordt voorbereid op basis van het script...");

      try {
        const start = await startAiVideoGeneration({
          imageDataUrl,
          partLabels: parts.map((p) => p.label),
          force,
          provider,
          ...videoParams,
        });

        let url: string;
        if (start.cached && start.videoUrl) {
          url = start.videoUrl;
          setStatus("Video geladen uit cache");
        } else {
          url = await waitForAiVideo(start.predictionId, setStatus);
        }

        setVideoUrl(url);
        setStatus(null);

        const record: AiVideoRecord = {
          url,
          prompt: start.prompt,
          style: videoParams.style,
          createdAt: Date.now(),
          model:
            provider === "local"
              ? "local/svd"
              : VIDEO_I2V_MODEL.split(":")[0],
          elementInstructions: videoParams.elementInstructions,
          sceneNote: videoParams.sceneNote,
          fromScript: true,
          scriptCreatedAt: script.createdAt,
          provider,
        };
        onVideoSaved(record);
      } catch (err) {
        if (SegmentApiError.isRateLimit(err)) {
          setRateLimit({
            message: err.message,
            retryAfterMs: err.retryAfterMs,
            limit: err.limit,
          });
          setStatus(null);
        } else {
          setStatus(
            err instanceof Error ? err.message : "Video-generatie mislukt"
          );
        }
      } finally {
        setGenerating(false);
      }
    },
    [imageDataUrl, onVideoSaved, parts, provider, script.createdAt, videoParams]
  );

  const safeName = drawingName.replace(/\s+/g, "-").toLowerCase();

  return (
    <section className="rounded-2xl border-4 border-violet-300 bg-gradient-to-br from-violet-50 via-white to-pink-50 p-6 shadow-lg">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-xl bg-violet-600 p-2.5 text-white shadow-md">
          <Film className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-violet-950">
            Script uitvoeren als video
          </h3>
          <p className="mt-1 text-sm text-violet-700">
            Genereer een AI-animatievideo (~1–3 min) die het script volgt
          </p>
        </div>
      </div>

      {rateLimit && (
        <div className="mb-4">
          <SegmentRateLimitAlert
            message={rateLimit.message}
            retryAfterMs={rateLimit.retryAfterMs}
            limit={rateLimit.limit}
            quality="premium"
          />
        </div>
      )}

      <div className="mb-4">
        <VideoProviderSelect
          value={provider}
          onChange={setProvider}
          disabled={generating}
        />
      </div>

      {!videoUrl && (
        <Button
          size="lg"
          onClick={() => handleGenerate(false)}
          disabled={generating}
          className="w-full rounded-full bg-gradient-to-r from-violet-600 to-pink-600 text-base text-white shadow-lg shadow-violet-300/40 hover:opacity-90"
        >
          {generating ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Bezig...
            </>
          ) : (
            <>
              <Play className="mr-2 h-5 w-5" />
              Maak animatievideo van script
            </>
          )}
        </Button>
      )}

      {videoUrl && !generating && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => handleGenerate(true)}
            className="rounded-full"
          >
            Opnieuw genereren
          </Button>
          <Button
            variant="ghost"
            onClick={() => setShowPrompt((v) => !v)}
            className="rounded-full text-violet-700"
          >
            {showPrompt ? "Verberg prompt" : "Bekijk video-prompt"}
          </Button>
        </div>
      )}

      {showPrompt && (
        <p className="mb-4 rounded-lg border border-violet-200 bg-white/80 p-3 text-xs leading-relaxed text-violet-900">
          {previewPrompt}
        </p>
      )}

      {status && (
        <p className="mb-4 text-center text-sm text-violet-700">{status}</p>
      )}

      {videoUrl && (
        <div className="space-y-3">
          <video
            src={videoUrl}
            controls
            playsInline
            autoPlay
            className="w-full rounded-xl border border-violet-200 bg-black shadow-md"
          />
          <Button
            variant="outline"
            className="w-full rounded-full"
            onClick={() =>
              downloadVideoUrl(videoUrl, `${safeName}-script-video.mp4`)
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Download MP4
          </Button>
        </div>
      )}
    </section>
  );
}
