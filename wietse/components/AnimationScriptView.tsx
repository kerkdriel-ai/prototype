"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Clapperboard,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

function scriptsEqual(a: AnimationScriptRecord, b: AnimationScriptRecord): boolean {
  return (
    a.summary === b.summary &&
    a.script === b.script &&
    JSON.stringify(a.moments) === JSON.stringify(b.moments)
  );
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
  const [savedSnapshot, setSavedSnapshot] = useState<AnimationScriptRecord | null>(
    savedScript ?? null
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<{
    message: string;
    retryAfterMs?: number;
    limit?: number;
  } | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (savedScript) {
      setScript(savedScript);
      setSavedSnapshot(savedScript);
    }
  }, [savedScript?.createdAt, savedScript?.updatedAt]);

  const isDirty =
    script && savedSnapshot ? !scriptsEqual(script, savedSnapshot) : false;

  const persistScript = useCallback(
    async (next: AnimationScriptRecord, fromAutoSave = false) => {
      const record: AnimationScriptRecord = {
        ...next,
        updatedAt: Date.now(),
      };
      setSaving(true);
      setSaveStatus(null);
      try {
        await onScriptSaved(record);
        setScript(record);
        setSavedSnapshot(record);
        setSaveStatus(fromAutoSave ? "Automatisch opgeslagen" : "Opgeslagen");
        setTimeout(() => setSaveStatus(null), 2500);
      } finally {
        setSaving(false);
      }
    },
    [onScriptSaved]
  );

  const scheduleAutoSave = useCallback(
    (next: AnimationScriptRecord) => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        void persistScript(next, true);
      }, 1200);
    },
    [persistScript]
  );

  useEffect(
    () => () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    },
    []
  );

  const updateScript = useCallback(
    (patch: Partial<AnimationScriptRecord>) => {
      setScript((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        scheduleAutoSave(next);
        return next;
      });
    },
    [scheduleAutoSave]
  );

  const updateMomentBeat = useCallback(
    (index: number, beat: string) => {
      setScript((prev) => {
        if (!prev) return prev;
        const moments = prev.moments.map((m, i) =>
          i === index ? { ...m, beat } : m
        );
        const next = { ...prev, moments };
        scheduleAutoSave(next);
        return next;
      });
    },
    [scheduleAutoSave]
  );

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
          updatedAt: Date.now(),
        };
        setScript(record);
        setSavedSnapshot(record);
        setStatus(null);
        await onScriptSaved(record);
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

  const handleManualSave = () => {
    if (!script || !isDirty) return;
    void persistScript(script, false);
  };

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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-violet-700">
                Pas het script aan — wijzigingen worden automatisch opgeslagen
              </p>
              <div className="flex items-center gap-2">
                {saveStatus && (
                  <span className="text-xs text-green-700">{saveStatus}</span>
                )}
                {isDirty && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleManualSave}
                    disabled={saving}
                    className="rounded-full"
                  >
                    {saving ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="mr-1 h-3 w-3" />
                    )}
                    Opslaan
                  </Button>
                )}
              </div>
            </div>

            <section className="rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-6 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-600" />
                <Label htmlFor="script-summary" className="text-lg font-bold text-amber-950">
                  Wat zie ik op de tekening?
                </Label>
              </div>
              <textarea
                id="script-summary"
                value={script.summary}
                onChange={(e) => updateScript({ summary: e.target.value })}
                rows={4}
                className="w-full resize-y rounded-lg border border-amber-200 bg-white/80 px-3 py-2 text-base leading-relaxed text-amber-950 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </section>

            <section className="rounded-2xl border-2 border-violet-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Clapperboard className="h-5 w-5 text-violet-600" />
                <Label htmlFor="script-body" className="text-lg font-bold text-violet-950">
                  Animatiescript
                </Label>
              </div>
              <textarea
                id="script-body"
                value={script.script}
                onChange={(e) => updateScript({ script: e.target.value })}
                rows={10}
                className="w-full resize-y rounded-lg border border-violet-200 px-3 py-2 text-base leading-relaxed text-violet-950 focus:outline-none focus:ring-2 focus:ring-violet-400"
                placeholder="Beschrijf hoe het tafereel tot leven komt..."
              />
            </section>

            {script.moments.length > 0 && (
              <section className="rounded-2xl border-2 border-pink-200 bg-pink-50/60 p-6">
                <h3 className="mb-4 text-lg font-bold text-pink-950">
                  Per onderdeel
                </h3>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {script.moments.map((m, momentIndex) => {
                    const labelLower = m.label.toLowerCase();
                    const matchingParts = parts.filter(
                      (p) => p.label.toLowerCase() === labelLower
                    );
                    const sameLabelIndex = script.moments
                      .slice(0, momentIndex)
                      .filter((x) => x.label.toLowerCase() === labelLower).length;
                    const part =
                      matchingParts[sameLabelIndex] ?? matchingParts[0];

                    return (
                      <li
                        key={`${m.label}-${momentIndex}`}
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
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <span className="block font-semibold text-pink-950">
                            {m.label}
                          </span>
                          <input
                            type="text"
                            value={m.beat}
                            onChange={(e) =>
                              updateMomentBeat(momentIndex, e.target.value)
                            }
                            className="w-full rounded-md border border-pink-200 px-2 py-1 text-sm text-pink-900 focus:outline-none focus:ring-2 focus:ring-pink-400"
                            placeholder="Wat doet dit onderdeel?"
                          />
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
                disabled={loading || saving}
                className="rounded-full"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Opnieuw genereren met AI
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
