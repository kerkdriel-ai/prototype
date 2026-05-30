"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/Header";
import { StreetViewPlacer } from "@/components/StreetViewPlacer";
import { ArrowLeft } from "lucide-react";
import { getDrawing, updateStreetViewScene } from "@/lib/db";
import type { StoredDrawing } from "@/lib/db";
import type { StreetViewScene } from "@/types/drawing";

export default function StreetViewPage() {
  const params = useParams();
  const id = params.id as string;
  const [drawing, setDrawing] = useState<StoredDrawing | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getDrawing(id).then((d) => {
      setDrawing(d ?? null);
      setLoading(false);
    });
  }, [id]);

  const handleSave = useCallback(
    async (scene: StreetViewScene) => {
      await updateStreetViewScene(id, scene);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    [id]
  );

  if (loading) return <PageShell title="Laden..." />;
  if (!drawing) return <PageShell title="Tekening niet gevonden" />;
  if (drawing.parts.length === 0) {
    return (
      <PageShell title="Geen onderdelen">
        <p className="text-center text-muted-foreground">
          Segmenteer eerst de tekening.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={`Street View: ${drawing.name}`}
      subtitle="Plaats de tekening in de echte wereld"
    >
      <div className="mb-4 flex items-center justify-between">
        <LinkButton href={`/animate/${id}`} variant="outline" size="sm" className="rounded-full">
          <ArrowLeft className="mr-1 h-4 w-4" /> Terug
        </LinkButton>
        {saved && (
          <span className="text-sm font-medium text-green-600">Opgeslagen!</span>
        )}
      </div>
      <StreetViewPlacer
        parts={drawing.parts}
        originalImage={drawing.originalImageDataUrl}
        width={drawing.width}
        height={drawing.height}
        initialScene={drawing.streetViewScene}
        onSave={handleSave}
      />
    </PageShell>
  );
}
