"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Clapperboard,
  Eye,
  EyeOff,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  startAiVideoGeneration,
  waitForAiVideo,
  type VideoProgressUpdate,
} from "@/lib/animate-video";
import { VideoGenerationProgress } from "@/components/VideoGenerationProgress";
import { buildVideoPrompt } from "@/lib/video-prompt";
import { SegmentApiError } from "@/lib/segment-errors";
import { SegmentRateLimitAlert } from "@/components/SegmentRateLimitAlert";
import {
  createInitialElementInstructions,
  getDefaultVideoAction,
  getSceneSuggestions,
  getVideoActionSuggestions,
  type VideoElementInstruction,
} from "@/lib/video-prompt-suggestions";
import {
  loadStoredVideoProvider,
  VideoProviderSelect,
} from "@/components/VideoProviderSelect";
import {
  VIDEO_I2V_MODEL,
  VIDEO_MOTION_STYLES,
  type VideoMotionStyle,
} from "@/lib/video-models";
import {
  createVideoRecord,
} from "@/lib/video-history";
import { VideoHistoryPanel } from "@/components/VideoHistoryPanel";
import type { VideoProvider } from "@/lib/video-types";
import type { AiVideoRecord, Part } from "@/types/drawing";

interface AiVideoGeneratorProps {
  imageDataUrl: string;
  parts: Part[];
  drawingName: string;
  savedVideos?: AiVideoRecord[];
  /** @deprecated gebruik savedVideos */
  existingVideo?: AiVideoRecord;
  onVideoSaved: (video: AiVideoRecord) => void;
  onHighlightPart?: (partId: string | null) => void;
  prominent?: boolean;
}

export function AiVideoGenerator({
  imageDataUrl,
  parts,
  drawingName,
  savedVideos = [],
  existingVideo,
  onVideoSaved,
  onHighlightPart,
  prominent = false,
}: AiVideoGeneratorProps) {
  const videos = useMemo(
    () =>
      savedVideos.length > 0
        ? savedVideos
        : existingVideo
          ? [existingVideo]
          : [],
    [savedVideos, existingVideo]
  );

  const latestManual = videos.find(
    (v) => !v.fromScript && v.elementInstructions?.length
  );

  const [style, setStyle] = useState<VideoMotionStyle>(
    latestManual?.style ?? "magical"
  );
  const [elements, setElements] = useState<VideoElementInstruction[]>(() =>
    createInitialElementInstructions(parts)
  );
  const [sceneNote, setSceneNote] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [focusedPartId, setFocusedPartId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState<VideoProgressUpdate | null>(
    null
  );
  const [generating, setGenerating] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(
    videos[0]?.id ?? null
  );
  const [rateLimit, setRateLimit] = useState<{
    message: string;
    retryAfterMs?: number;
    limit?: number;
  } | null>(null);
  const [provider, setProvider] = useState<VideoProvider>(() =>
    latestManual?.provider ?? loadStoredVideoProvider()
  );

  useEffect(() => {
    if (videos.length === 0) return;
    setSelectedVideoId((current) => {
      if (current && videos.some((v) => v.id === current)) return current;
      return videos[0]?.id ?? null;
    });
  }, [videos]);

  useEffect(() => {
    if (latestManual?.elementInstructions?.length) {
      setElements(latestManual.elementInstructions);
      setSceneNote(latestManual.sceneNote ?? "");
      setStyle(latestManual.style);
    } else {
      setElements(createInitialElementInstructions(parts));
    }
  }, [parts, latestManual?.createdAt]);

  const enabledLabels = useMemo(
    () => elements.filter((e) => e.enabled).map((e) => e.label),
    [elements]
  );

  const sceneSuggestions = useMemo(
    () => getSceneSuggestions(enabledLabels, style),
    [enabledLabels, style]
  );

  const composedPrompt = useMemo(
    () =>
      buildVideoPrompt({
        partLabels: parts.map((p) => p.label),
        style,
        elementInstructions: elements,
        sceneNote: sceneNote.trim() || undefined,
      }),
    [elements, parts, sceneNote, style]
  );

  const toggleElement = (partId: string) => {
    setElements((prev) =>
      prev.map((e) =>
        e.partId === partId ? { ...e, enabled: !e.enabled } : e
      )
    );
  };

  const setAction = (partId: string, action: string) => {
    setElements((prev) =>
      prev.map((e) => (e.partId === partId ? { ...e, action } : e))
    );
  };

  const applySuggestionsToAll = () => {
    setElements((prev) =>
      prev.map((e) => ({
        ...e,
        action: getDefaultVideoAction(e.label),
        enabled: true,
      }))
    );
  };

  const handleFocus = (partId: string | null) => {
    setFocusedPartId(partId);
    onHighlightPart?.(partId);
  };

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setRateLimit(null);
    setVideoProgress(null);
    setStatus("Video wordt voorbereid...");

    try {
      const start = await startAiVideoGeneration({
        imageDataUrl,
        partLabels: parts.map((p) => p.label),
        style,
        elementInstructions: elements,
        sceneNote: sceneNote.trim() || undefined,
        provider,
      });

      let url: string;
      if (start.cached && start.videoUrl) {
        url = start.videoUrl;
        setStatus("Video geladen uit cache");
      } else {
        url = await waitForAiVideo(start.predictionId, setVideoProgress);
      }

      setVideoProgress(null);
      setStatus(null);

      const record = createVideoRecord({
        url,
        prompt: start.prompt,
        style,
        createdAt: Date.now(),
        model:
          provider === "local"
            ? "local/svd"
            : VIDEO_I2V_MODEL.split(":")[0],
        elementInstructions: elements.filter((e) => e.enabled),
        sceneNote: sceneNote.trim() || undefined,
        provider,
      });
      setSelectedVideoId(record.id!);
      onVideoSaved(record);
    } catch (err) {
      if (SegmentApiError.isRateLimit(err)) {
        setRateLimit({
          message: err.message,
          retryAfterMs: err.retryAfterMs,
          limit: err.limit,
        });
        setVideoProgress(null);
        setStatus(null);
      } else {
        setStatus(
          err instanceof Error ? err.message : "Video-generatie mislukt"
        );
      }
    } finally {
      setGenerating(false);
    }
  }, [
    elements,
    imageDataUrl,
    onVideoSaved,
    parts,
    sceneNote,
    style,
    provider,
  ]);

  const enabledCount = elements.filter((e) => e.enabled).length;

  return (
    <div
      className={
        prominent
          ? "space-y-5 rounded-2xl border-4 border-violet-300 bg-gradient-to-br from-violet-50 via-white to-pink-50 p-6 shadow-xl shadow-violet-200/40"
          : "space-y-4 rounded-xl border-2 border-violet-200 bg-gradient-to-br from-violet-50/80 to-pink-50/60 p-4"
      }
    >
      <div className="flex items-start gap-3">
        <div
          className={
            prominent
              ? "rounded-xl bg-violet-600 p-2.5 text-white shadow-md"
              : ""
          }
        >
          <Clapperboard
            className={
              prominent ? "h-7 w-7 shrink-0" : "mt-0.5 h-5 w-5 shrink-0 text-violet-600"
            }
          />
        </div>
        <div>
          <h3
            className={
              prominent
                ? "text-2xl font-bold tracking-tight text-violet-950"
                : "font-bold text-violet-900"
            }
          >
            AI-video maken
          </h3>
          <p
            className={
              prominent
                ? "mt-1 text-sm text-violet-700"
                : "text-xs text-violet-700/80"
            }
          >
            Kies onderdelen en beschrijf wat ze doen (~1–3 min)
          </p>
        </div>
      </div>

      {rateLimit && (
        <SegmentRateLimitAlert
          message={rateLimit.message}
          retryAfterMs={rateLimit.retryAfterMs}
          limit={rateLimit.limit}
          quality="premium"
        />
      )}

      <VideoProviderSelect
        value={provider}
        onChange={setProvider}
        disabled={generating}
      />

      <div className="space-y-2">
        <Label className={prominent ? "text-base text-violet-900" : "text-violet-900"}>
          Stijl
        </Label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(VIDEO_MOTION_STYLES) as VideoMotionStyle[]).map(
            (key) => (
              <button
                key={key}
                type="button"
                disabled={generating}
                onClick={() => setStyle(key)}
                className={`rounded-full font-medium transition-colors ${
                  prominent ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs"
                } ${
                  style === key
                    ? "bg-violet-600 text-white shadow-sm"
                    : "bg-white text-violet-800 ring-1 ring-violet-200 hover:bg-violet-100"
                }`}
              >
                {VIDEO_MOTION_STYLES[key].label}
              </button>
            )
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label
            className={
              prominent ? "text-base text-violet-900" : "text-violet-900"
            }
          >
            Onderdelen ({enabledCount}/{elements.length})
          </Label>
          <button
            type="button"
            disabled={generating}
            onClick={applySuggestionsToAll}
            className={`flex items-center gap-1 font-medium text-violet-600 hover:text-violet-800 ${
              prominent ? "text-sm" : "text-xs"
            }`}
          >
            <Wand2 className={prominent ? "h-4 w-4" : "h-3 w-3"} />
            Vul suggesties in
          </button>
        </div>

        <ul
          className={`space-y-2 overflow-y-auto pr-1 ${
            prominent
              ? "max-h-[min(55vh,560px)] min-h-[240px]"
              : "max-h-72"
          }`}
        >
          {elements.map((el) => {
            const part = parts.find((p) => p.id === el.partId);
            const suggestions = getVideoActionSuggestions(el.label);
            const isFocused = focusedPartId === el.partId;

            return (
              <li
                key={el.partId}
                className={`rounded-xl border bg-white transition-shadow ${
                  prominent ? "p-3" : "p-2"
                } ${
                  el.enabled
                    ? isFocused
                      ? "border-violet-400 ring-2 ring-violet-200"
                      : "border-violet-200"
                    : "border-gray-200 opacity-60"
                }`}
                onMouseEnter={() => handleFocus(el.partId)}
                onMouseLeave={() => handleFocus(null)}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={el.enabled}
                    disabled={generating}
                    onChange={() => toggleElement(el.partId)}
                    className={`mt-2 rounded accent-violet-600 ${
                      prominent ? "h-5 w-5" : "h-4 w-4"
                    }`}
                    aria-label={`${el.label} animatie`}
                  />
                  {part && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={part.imageDataUrl}
                      alt=""
                      className={`shrink-0 rounded-lg border border-violet-100 object-contain bg-white ${
                        prominent ? "h-14 w-14" : "h-10 w-10"
                      }`}
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <span
                      className={`block font-semibold text-violet-900 ${
                        prominent ? "text-base" : "text-sm"
                      }`}
                    >
                      {el.label}
                    </span>
                    {el.enabled && (
                      <>
                        <input
                          type="text"
                          value={el.action}
                          disabled={generating}
                          onChange={(e) =>
                            setAction(el.partId, e.target.value)
                          }
                          onFocus={() => handleFocus(el.partId)}
                          placeholder="Wat doet dit onderdeel?"
                          className={`w-full rounded-lg border border-violet-200 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50 ${
                            prominent
                              ? "px-3 py-2 text-sm"
                              : "px-2 py-1 text-xs"
                          }`}
                        />
                        <div className="flex flex-wrap gap-1">
                          {suggestions.map((s) => (
                            <button
                              key={s}
                              type="button"
                              disabled={generating}
                              onClick={() => setAction(el.partId, s)}
                              className={`rounded-full leading-tight transition-colors ${
                                prominent
                                  ? "px-2.5 py-1 text-xs"
                                  : "px-2 py-0.5 text-[10px]"
                              } ${
                                el.action === s
                                  ? "bg-violet-600 text-white"
                                  : "bg-violet-100 text-violet-800 hover:bg-violet-200"
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-2">
        <Label
          className={
            prominent ? "text-base text-violet-900" : "text-violet-900"
          }
        >
          Sfeer (optioneel)
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {sceneSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={generating}
              onClick={() => setSceneNote(s)}
              className={`rounded-full leading-tight transition-colors ${
                prominent ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[10px]"
              } ${
                sceneNote === s
                  ? "bg-pink-600 text-white"
                  : "bg-pink-100 text-pink-900 hover:bg-pink-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <textarea
          value={sceneNote}
          onChange={(e) => setSceneNote(e.target.value)}
          disabled={generating}
          rows={prominent ? 3 : 2}
          placeholder="Extra sfeer voor het hele tafereel..."
          className={`flex w-full resize-none rounded-lg border border-violet-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50 ${
            prominent ? "px-4 py-3 text-sm" : "px-3 py-2 text-xs"
          }`}
        />
      </div>

      <button
        type="button"
        onClick={() => setShowPreview((v) => !v)}
        className={`flex w-full items-center justify-center gap-1 text-violet-600 hover:text-violet-800 ${
          prominent ? "text-sm" : "text-xs"
        }`}
      >
        {showPreview ? (
          <>
            <EyeOff className="h-3.5 w-3.5" /> Verberg prompt
          </>
        ) : (
          <>
            <Eye className="h-3.5 w-3.5" /> Bekijk gegenereerde prompt
          </>
        )}
      </button>
      {showPreview && (
        <p
          className={`rounded-lg border border-violet-200 bg-white/80 leading-relaxed text-violet-900 ${
            prominent ? "p-3 text-sm" : "p-2 text-[11px]"
          }`}
        >
          {composedPrompt}
        </p>
      )}

      <Button
        size={prominent ? "lg" : "default"}
        onClick={handleGenerate}
        disabled={generating || enabledCount === 0}
        className={`w-full rounded-full bg-gradient-to-r from-violet-600 to-pink-600 text-white hover:opacity-90 ${
          prominent ? "h-12 text-base shadow-lg shadow-violet-300/50" : ""
        }`}
      >
        {generating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Bezig...
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            Genereer AI-video
          </>
        )}
      </Button>

      {enabledCount === 0 && (
        <p className="text-center text-xs text-amber-700">
          Selecteer minimaal één onderdeel
        </p>
      )}

      {generating && (videoProgress || status) && (
        <VideoGenerationProgress
          message={videoProgress?.message ?? status}
          progressPercent={videoProgress?.progressPercent}
          elapsedSeconds={videoProgress?.elapsedSeconds}
          isLocal={provider === "local"}
        />
      )}

      {status && !generating && (
        <p className="text-center text-sm text-violet-700">{status}</p>
      )}

      <VideoHistoryPanel
        videos={videos}
        selectedId={selectedVideoId}
        onSelect={setSelectedVideoId}
        drawingName={drawingName}
        prominent={prominent}
      />
    </div>
  );
}
