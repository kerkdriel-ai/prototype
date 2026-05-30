"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { PageShell } from "@/components/Header";
import { UploadZone } from "@/components/UploadZone";
import { SegmentLoading } from "@/components/SegmentLoading";
import { useSegmentProgress } from "@/hooks/useSegmentProgress";
import { saveDrawing } from "@/lib/db";
import { getImageDimensions, hashDataUrl } from "@/lib/image-utils";
import { segmentDrawing, colorClusterFallback } from "@/lib/segment";
import { SegmentApiError } from "@/lib/segment-errors";
import { segmentPartToPart } from "@/lib/part-intelligence";
import type { Part } from "@/types/drawing";
import type { SegmentQuality } from "@/lib/segment-models";
import { SegmentRateLimitAlert } from "@/components/SegmentRateLimitAlert";

export default function UploadPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<{
    message: string;
    retryAfterMs?: number;
    limit?: number;
    quality?: SegmentQuality;
  } | null>(null);
  const [usePremium, setUsePremium] = useState(true);
  const { progress, completedSteps, onProgress, reset } = useSegmentProgress();

  const handleUpload = async (_file: File, dataUrl: string) => {
    setLoading(true);
    setError(null);
    setRateLimit(null);
    reset();
    const quality: SegmentQuality = usePremium ? "premium" : "standard";

    try {
      const { width, height } = await getImageDimensions(dataUrl);
      const id = uuidv4();
      const name = `Tekening ${new Date().toLocaleDateString("nl-NL")}`;

      let segmentResult;
      try {
        segmentResult = await segmentDrawing(dataUrl, { quality, onProgress });
      } catch (segmentErr) {
        if (SegmentApiError.isRateLimit(segmentErr)) {
          setRateLimit({
            message: segmentErr.message,
            retryAfterMs: segmentErr.retryAfterMs,
            limit: segmentErr.limit,
            quality,
          });
          setLoading(false);
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
        segmentResult = await colorClusterFallback(dataUrl);
      }

      const parts: Part[] = segmentResult.parts.map((p, i) =>
        segmentPartToPart(p, i)
      );

      await saveDrawing({
        id,
        name,
        originalImageDataUrl: dataUrl,
        width: segmentResult.width || width,
        height: segmentResult.height || height,
        parts,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        segmentCacheKey: hashDataUrl(dataUrl),
      });

      router.push(`/edit/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload mislukt");
      setLoading(false);
    }
  };

  return (
    <PageShell
      title="Upload tekening"
      subtitle="Maak een foto of kies een afbeelding"
    >
      {loading ? (
        <SegmentLoading progress={progress} completedSteps={completedSteps} />
      ) : (
        <div className="space-y-6">
          {rateLimit && (
            <SegmentRateLimitAlert
              message={rateLimit.message}
              retryAfterMs={rateLimit.retryAfterMs}
              limit={rateLimit.limit}
              quality={rateLimit.quality}
            />
          )}
          {error && (
            <p className="text-center text-sm text-red-600">{error}</p>
          )}
          <label className="mx-auto flex max-w-xl cursor-pointer items-center gap-3 rounded-2xl border-2 border-violet-200 bg-violet-50/50 px-5 py-4">
            <input
              type="checkbox"
              checked={usePremium}
              onChange={(e) => setUsePremium(e.target.checked)}
              className="h-5 w-5 rounded accent-violet-600"
            />
            <div>
              <p className="font-semibold text-violet-900">Premium segmentatie</p>
              <p className="text-sm text-violet-700/80">
                Gemini Vision + per-object maskers — beste voor drukke tekeningen (~€0.02–0.05, ~1 min)
              </p>
            </div>
          </label>
          <UploadZone onUpload={handleUpload} />
        </div>
      )}
    </PageShell>
  );
}
