"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { PageShell, StreetViewLink, ScriptLink } from "@/components/Header";
import { getDrawing, saveDrawing } from "@/lib/db";
import { appendVideoToDrawing, getDrawingVideos } from "@/lib/video-history";
import type { StoredDrawing } from "@/lib/db";
import type { Part, AiVideoRecord } from "@/types/drawing";
import { Skeleton } from "@/components/ui/skeleton";

const AnimationStage = dynamic(
  () =>
    import("@/components/AnimationStage").then((m) => m.AnimationStage),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[500px] w-full rounded-2xl" />,
  }
);

export default function AnimatePage() {
  const params = useParams();
  const id = params.id as string;
  const [drawing, setDrawing] = useState<StoredDrawing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDrawing(id).then((d) => {
      setDrawing(d ?? null);
      setLoading(false);
    });
  }, [id]);

  const handlePartUpdate = useCallback(
    async (partId: string, updates: Partial<Part>) => {
      if (!drawing) return;
      const parts = drawing.parts.map((p) =>
        p.id === partId ? { ...p, ...updates } : p
      );
      const updated = { ...drawing, parts, updatedAt: Date.now() };
      setDrawing(updated);
      await saveDrawing(updated);
    },
    [drawing]
  );

  const handleVideoSaved = useCallback(
    async (video: AiVideoRecord) => {
      if (!drawing) return;
      const updated = {
        ...appendVideoToDrawing(drawing, video),
        updatedAt: Date.now(),
      };
      setDrawing(updated);
      await saveDrawing(updated);
    },
    [drawing]
  );

  if (loading) return <PageShell title="Laden..." />;
  if (!drawing) return <PageShell title="Tekening niet gevonden" />;
  if (drawing.parts.length === 0) {
    return (
      <PageShell title="Geen onderdelen">
        <p className="text-center text-muted-foreground">
          Segmenteer eerst de tekening voordat je animeert.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={`Animeer: ${drawing.name}`}
      subtitle="Stel bewegingen in, exporteer GIF — of laat AI een video maken"
    >
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <ScriptLink drawingId={id} />
        <StreetViewLink drawingId={id} />
      </div>
      <AnimationStage
        originalImage={drawing.originalImageDataUrl}
        parts={drawing.parts}
        width={drawing.width}
        height={drawing.height}
        onPartUpdate={handlePartUpdate}
        drawingExport={drawing}
        drawingName={drawing.name.replace(/\s+/g, "-").toLowerCase()}
        aiVideos={getDrawingVideos(drawing)}
        onVideoSaved={handleVideoSaved}
      />
    </PageShell>
  );
}
