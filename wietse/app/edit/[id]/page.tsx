"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { PageShell, StreetViewLink, ScriptLink } from "@/components/Header";
import { SegmentCanvas } from "@/components/SegmentCanvas";
import { PartList } from "@/components/PartList";
import { SegmentLoading } from "@/components/SegmentLoading";
import { useSegmentProgress } from "@/hooks/useSegmentProgress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getDrawing, saveDrawing } from "@/lib/db";
import { segmentDrawing, colorClusterFallback } from "@/lib/segment";
import { SegmentApiError } from "@/lib/segment-errors";
import { mergePartsClient } from "@/lib/mask-utils";
import {
  inferAnimationFromLabel,
  segmentPartToPart,
} from "@/lib/part-intelligence";
import type { StoredDrawing } from "@/lib/db";
import type { Part } from "@/types/drawing";
import { SegmentRateLimitAlert } from "@/components/SegmentRateLimitAlert";

export default function EditPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [drawing, setDrawing] = useState<StoredDrawing | null>(null);
  const [loading, setLoading] = useState(true);
  const [segmenting, setSegmenting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    getDrawing(id).then((d) => {
      setDrawing(d ?? null);
      setLoading(false);
    });
  }, [id]);

  const handleSelect = useCallback((partId: string, multi: boolean) => {
    setSelectedIds((prev) => {
      if (multi) {
        return prev.includes(partId)
          ? prev.filter((x) => x !== partId)
          : [...prev, partId];
      }
      return prev.includes(partId) && prev.length === 1 ? [] : [partId];
    });
  }, []);

  const handleRemove = useCallback(
    async (partId: string) => {
      if (!drawing) return;
      const parts = drawing.parts.filter((p) => p.id !== partId);
      const updated = { ...drawing, parts, updatedAt: Date.now() };
      await saveDrawing(updated);
      setDrawing(updated);
      setSelectedIds((prev) => prev.filter((x) => x !== partId));
    },
    [drawing]
  );

  const handleMerge = useCallback(async () => {
    if (!drawing || selectedIds.length < 2) return;
    const merged = await mergePartsClient(drawing.parts, selectedIds);
    const sourceLabel =
      drawing.parts.find((p) => selectedIds.includes(p.id))?.label ?? "";
    const { animation, speed } = inferAnimationFromLabel(sourceLabel);
    const parts: Part[] = merged.map((p) => ({
      ...p,
      animation,
      speed,
    }));
    const updated = { ...drawing, parts, updatedAt: Date.now() };
    await saveDrawing(updated);
    setDrawing(updated);
    setSelectedIds([]);
  }, [drawing, selectedIds]);

  const [segmentStatus, setSegmentStatus] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<{
    message: string;
    retryAfterMs?: number;
    limit?: number;
    quality?: "standard" | "premium";
  } | null>(null);
  const { progress, completedSteps, onProgress, reset } = useSegmentProgress();

  const runSegment = useCallback(
    async (quality: "standard" | "premium") => {
      if (!drawing) return;
      setSegmenting(true);
      setSegmentStatus(null);
      setRateLimit(null);
      reset();
      try {
        let result;
        try {
          result = await segmentDrawing(drawing.originalImageDataUrl, {
            force: true,
            quality,
            onProgress,
          });
        } catch (segmentErr) {
          if (SegmentApiError.isRateLimit(segmentErr)) {
            setRateLimit({
              message: segmentErr.message,
              retryAfterMs: segmentErr.retryAfterMs,
              limit: segmentErr.limit,
              quality,
            });
            return;
          }
          onProgress({
            type: "progress",
            step: "fallback-local",
            label: "Fallback: kleurclustering...",
            current: 1,
            total: 1,
            percent: 50,
          });
          result = await colorClusterFallback(drawing.originalImageDataUrl);
        }
        const parts: Part[] = result.parts.map((p, i) =>
          segmentPartToPart(p, i)
        );
        const updated = { ...drawing, parts, updatedAt: Date.now() };
        await saveDrawing(updated);
        setDrawing(updated);
        setSegmentStatus(
          `${result.parts.length} onderdelen (${result.source}${result.quality === "premium" ? ", premium" : ""})`
        );
      } finally {
        setSegmenting(false);
      }
    },
    [drawing, onProgress, reset]
  );

  const handleResegment = useCallback(
    () => runSegment("standard"),
    [runSegment]
  );

  const handleResegmentPremium = useCallback(
    () => runSegment("premium"),
    [runSegment]
  );

  const handleContinue = () => router.push(`/animate/${id}`);

  if (loading) return <PageShell title="Laden..." />;
  if (!drawing) return <PageShell title="Tekening niet gevonden" />;

  return (
    <PageShell
      title={drawing.name}
      subtitle="Controleer en pas de herkende onderdelen aan"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Badge variant="secondary">{drawing.parts.length} onderdelen</Badge>
        {drawing.parts.length <= 8 && (
          <Badge variant="outline" className="text-orange-700">
            Weinig onderdelen — probeer Premium AI opnieuw
          </Badge>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResegment}
            disabled={segmenting}
            className="rounded-full"
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${segmenting ? "animate-spin" : ""}`} />
            Standaard
          </Button>
          <Button
            size="sm"
            onClick={handleResegmentPremium}
            disabled={segmenting}
            className="rounded-full bg-gradient-to-r from-violet-600 to-pink-600 text-white hover:opacity-90"
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${segmenting ? "animate-spin" : ""}`} />
            Premium AI
          </Button>
          {drawing.parts.length > 0 && <ScriptLink drawingId={id} />}
          {drawing.parts.length > 0 && <StreetViewLink drawingId={id} />}
        </div>
      </div>

      {rateLimit && !segmenting && (
        <div className="mb-4">
          <SegmentRateLimitAlert
            message={rateLimit.message}
            retryAfterMs={rateLimit.retryAfterMs}
            limit={rateLimit.limit}
            quality={rateLimit.quality}
          />
        </div>
      )}

      {segmenting ? (
        <div>
          <SegmentLoading progress={progress} completedSteps={completedSteps} />
          {segmentStatus && (
            <p className="mt-4 text-center text-sm text-green-700">{segmentStatus}</p>
          )}
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
          <PartList
            parts={drawing.parts}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onRemove={handleRemove}
            onMerge={handleMerge}
            onContinue={handleContinue}
          />
          <SegmentCanvas
            originalImage={drawing.originalImageDataUrl}
            parts={drawing.parts}
            width={drawing.width}
            height={drawing.height}
            selectedIds={selectedIds}
            onSelect={handleSelect}
          />
        </div>
      )}
    </PageShell>
  );
}
