"use client";

import { useEffect, useState } from "react";
import { Trash2, Pencil, Play, Sparkles, BookOpen } from "lucide-react";
import { LinkButton } from "@/components/LinkButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAllDrawings, deleteDrawing } from "@/lib/db";
import type { StoredDrawing } from "@/lib/db";

export function Gallery() {
  const [drawings, setDrawings] = useState<StoredDrawing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAllDrawings().then((d) => {
      setDrawings(d);
      setLoading(false);
    });
  }, []);

  const handleDelete = async (id: string) => {
    await deleteDrawing(id);
    setDrawings((prev) => prev.filter((d) => d.id !== id));
  };

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-64 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (drawings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 to-pink-100">
          <Sparkles className="h-12 w-12 text-orange-400" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-orange-900">Nog geen tekeningen</h3>
          <p className="mt-2 text-orange-700/70">
            Upload je eerste kindertekening om te beginnen!
          </p>
        </div>
        <LinkButton href="/upload" size="lg" className="rounded-full bg-gradient-to-r from-amber-500 to-pink-500 text-white hover:opacity-90">
          Upload tekening
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {drawings.map((drawing) => (
        <Card
          key={drawing.id}
          className="overflow-hidden border-2 border-orange-100 transition-shadow hover:shadow-lg"
        >
          <div className="relative aspect-square bg-orange-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={drawing.originalImageDataUrl}
              alt={drawing.name}
              className="h-full w-full object-contain p-4"
            />
            <div className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-orange-700">
              {drawing.parts.length} onderdelen
            </div>
          </div>
          <CardContent className="p-4">
            <h3 className="truncate font-bold text-orange-900">{drawing.name}</h3>
            <p className="text-xs text-muted-foreground">
              {new Date(drawing.updatedAt).toLocaleDateString("nl-NL")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <LinkButton href={`/edit/${drawing.id}`} size="sm" variant="outline" className="rounded-full">
                <Pencil className="mr-1 h-3 w-3" /> Bewerk
              </LinkButton>
              {drawing.parts.length > 0 && (
                <>
                  <LinkButton href={`/script/${drawing.id}`} size="sm" variant="outline" className="rounded-full">
                    <BookOpen className="mr-1 h-3 w-3" /> Script
                  </LinkButton>
                  <LinkButton href={`/animate/${drawing.id}`} size="sm" className="rounded-full">
                    <Play className="mr-1 h-3 w-3" /> Animeer
                  </LinkButton>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full text-red-400"
                onClick={() => handleDelete(drawing.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
