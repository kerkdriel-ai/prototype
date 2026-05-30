"use client";

import { useCallback, useState } from "react";
import {
  BookOpen,
  Clapperboard,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchAnimationScript } from "@/lib/animation-script-client";
import { SegmentApiError } from "@/lib/segment-errors";
import { SegmentRateLimitAlert } from "@/components/SegmentRateLimitAlert";
import { ScriptVideoExecutor } from "@/components/ScriptVideoExecutor";
import type { AiVideoRecord, AnimationScriptRecord, Part } from "@/types/drawing";

interface AnimationScriptViewProps {
  drawingId: string;
  drawingName: string;
  originalImage: string;
  parts: Part[];
  savedScript?: AnimationScriptRecord;
  onScriptSaved: (script: AnimationScriptRecord) => void;
  savedVideos?: AiVideoRecord[];
  onVideoSaved?: (video: AiVideoRecord) => void;
}

export function AnimationScriptView({
  drawingName,
  originalImage,
  parts,
  savedScript,
  onScriptSaved,
  savedVideos = [],
  onVideoSaved,
}: AnimationScriptViewProps) {
  const [script, setScript] = useState<AnimationScriptRecord | null>(
    savedScript ?? null
  );
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<{
    message: string;
    retryAfterMs?: number;
    limit?: number;
  } | null>(null);

  const generate = useCallback(
    async (force = false) => {
      setLoading(true);
      setRateLimit(null);
      setStatus("Tekening wordt gelezen...");

      try {
        const result = await fetchAnimationScript({
          imageDataUrl: originalImage,
          parts,
          force,
        });

        const record: AnimationScriptRecord = {
          ...result,
          createdAt: Date.now(),
        };
        setScript(record);
        setStatus(null);
        onScriptSaved(record);
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
            err instanceof Error ? err.message : "Script genereren mislukt"
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [originalImage, onScriptSaved, parts]
  );

  const scriptParagraphs = script?.script.split(/\n\n+/).filter(Boolean) ?? [];

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
      <div className="space-y-6">
        {!script && !loading && (
          <div className="flex flex-col items-center gap-6 rounded-2xl border-2 border-dashed border-violet-200 bg-violet-50/50 px-6 py-16 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-white shadow-lg">
              <BookOpen className="h-10 w-10" />
            </div>
            <div className="max-w-md space-y-2">
              <h3 className="text-xl font-bold text-violet-950">
                Animatiescript voor {drawingName}
              </h3>
              <p className="text-sm text-violet-700">
                AI beschrijft wat er op de tekening staat en schrijft een kort
                regiescript — bijvoorbeeld wie op de trampoline springt.
              </p>
            </div>
            <Button
              size="lg"
              onClick={() => generate(false)}
              className="rounded-full bg-gradient-to-r from-violet-600 to-pink-600 text-white hover:opacity-90"
            >
              <Sparkles className="mr-2 h-5 w-5" />
              Script genereren
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-violet-200 bg-white py-20">
            <Loader2 className="h-10 w-10 animate-spin text-violet-600" />
            <p className="text-violet-800">{status ?? "Bezig..."}</p>
          </div>
        )}

        {script && !loading && (
          <>
            <section className="rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-6 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-600" />
                <h3 className="text-lg font-bold text-amber-950">
                  Wat zie ik op de tekening?
                </h3>
              </div>
              <p className="text-base leading-relaxed text-amber-950/90">
                {script.summary}
              </p>
            </section>

            <section className="rounded-2xl border-2 border-violet-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Clapperboard className="h-5 w-5 text-violet-600" />
                <h3 className="text-lg font-bold text-violet-950">
                  Animatiescript
                </h3>
              </div>
              <div className="space-y-4">
                {scriptParagraphs.map((para, i) => (
                  <p
                    key={i}
                    className="text-base leading-relaxed text-violet-950/90"
                  >
                    {para}
                  </p>
                ))}
              </div>
            </section>

            {script.moments.length > 0 && (
              <section className="rounded-2xl border-2 border-pink-200 bg-pink-50/60 p-6">
                <h3 className="mb-4 text-lg font-bold text-pink-950">
                  Per onderdeel
                </h3>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {script.moments.map((m) => {
                    const part = parts.find(
                      (p) =>
                        p.label.toLowerCase() === m.label.toLowerCase()
                    );
                    return (
                      <li
                        key={m.label}
                        className="flex gap-3 rounded-xl border border-pink-200 bg-white p-3"
                      >
                        {part && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={part.imageDataUrl}
                            alt=""
                            className="h-12 w-12 shrink-0 rounded-lg border border-pink-100 object-contain"
                          />
                        )}
                        <div className="min-w-0">
                          <span className="block font-semibold text-pink-950">
                            {m.label}
                          </span>
                          <span className="text-sm text-pink-900/80">
                            {m.beat}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {onVideoSaved && (
              <ScriptVideoExecutor
                imageDataUrl={originalImage}
                parts={parts}
                drawingName={drawingName}
                script={script}
                savedVideos={savedVideos}
                onVideoSaved={onVideoSaved}
              />
            )}

            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => generate(true)}
                disabled={loading}
                className="rounded-full"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Opnieuw genereren
              </Button>
            </div>
          </>
        )}

        {rateLimit && (
          <SegmentRateLimitAlert
            message={rateLimit.message}
            retryAfterMs={rateLimit.retryAfterMs}
            limit={rateLimit.limit}
          />
        )}

        {status && !loading && (
          <p className="text-center text-sm text-red-600">{status}</p>
        )}
      </div>

      <aside className="xl:sticky xl:top-6">
        <div className="overflow-hidden rounded-2xl border-4 border-orange-200 bg-white shadow-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={originalImage}
            alt={drawingName}
            className="w-full object-contain p-4"
          />
        </div>
        <p className="mt-3 text-center text-sm text-muted-foreground">
          {parts.length} onderdelen herkend
        </p>
      </aside>
    </div>
  );
}
