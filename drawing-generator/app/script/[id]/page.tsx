"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageShell, StreetViewLink } from "@/components/Header";
import { AnimationScriptView } from "@/components/AnimationScriptView";
import { getDrawing, saveDrawing } from "@/lib/db";
import type { StoredDrawing } from "@/lib/db";
import type { AnimationScriptRecord, AiVideoRecord } from "@/types/drawing";

export default function ScriptPage() {
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

  const handleScriptSaved = useCallback(
    async (script: AnimationScriptRecord) => {
      if (!drawing) return;
      const updated = { ...drawing, animationScript: script, updatedAt: Date.now() };
      setDrawing(updated);
      await saveDrawing(updated);
    },
    [drawing]
  );

  const handleVideoSaved = useCallback(
    async (video: AiVideoRecord) => {
      if (!drawing) return;
      const updated = { ...drawing, aiVideo: video, updatedAt: Date.now() };
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
          Segmenteer eerst de tekening voordat je een script maakt.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={`Animatiescript: ${drawing.name}`}
      subtitle="Samenvatting, regiescript — en maak er een animatievideo van"
    >
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <StreetViewLink drawingId={id} />
      </div>
      <AnimationScriptView
        drawingId={id}
        drawingName={drawing.name}
        originalImage={drawing.originalImageDataUrl}
        parts={drawing.parts}
        savedScript={drawing.animationScript}
        onScriptSaved={handleScriptSaved}
        existingVideo={drawing.aiVideo}
        onVideoSaved={handleVideoSaved}
      />
    </PageShell>
  );
}
