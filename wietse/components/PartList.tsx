"use client";

import { Trash2, Merge, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Part } from "@/types/drawing";
import { PRESET_LABELS } from "@/lib/animations";

interface PartListProps {
  parts: Part[];
  selectedIds: string[];
  onSelect: (id: string, multi: boolean) => void;
  onRemove: (id: string) => void;
  onMerge: () => void;
  onContinue?: () => void;
  mode?: "edit" | "animate";
}

export function PartList({
  parts,
  selectedIds,
  onSelect,
  onRemove,
  onMerge,
  onContinue,
  mode = "edit",
}: PartListProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-orange-900">
          Onderdelen ({parts.length})
        </h3>
        {mode === "edit" && selectedIds.length >= 2 && (
          <Button size="sm" variant="outline" onClick={onMerge} className="rounded-full">
            <Merge className="mr-1 h-4 w-4" />
            Samenvoegen
          </Button>
        )}
      </div>

      {parts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Geen onderdelen gevonden.</p>
      ) : (
        <ul className="flex max-h-[400px] flex-col gap-2 overflow-y-auto">
          {parts.map((part) => {
            const selected = selectedIds.includes(part.id);
            return (
              <li
                key={part.id}
                className={`flex items-center gap-3 rounded-xl border-2 p-2 transition-colors cursor-pointer ${
                  selected
                    ? "border-pink-400 bg-pink-50"
                    : "border-orange-100 bg-white hover:border-orange-200"
                }`}
                onClick={(e) => onSelect(part.id, e.shiftKey)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={part.imageDataUrl}
                  alt={part.label}
                  className="h-12 w-12 rounded-lg bg-orange-50 object-contain"
                />
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-orange-900">{part.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {Math.round(part.bbox.width)}×{Math.round(part.bbox.height)} px
                    {part.animation !== "none" && (
                      <> · {PRESET_LABELS[part.animation]}</>
                    )}
                  </p>
                </div>
                {mode === "edit" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="shrink-0 text-red-400 hover:text-red-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(part.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                {mode === "animate" && part.animation !== "none" && (
                  <Badge variant="secondary">{PRESET_LABELS[part.animation]}</Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {mode === "edit" && (
        <p className="text-xs text-muted-foreground">
          Shift+klik om meerdere onderdelen te selecteren en samen te voegen.
        </p>
      )}

      {onContinue && parts.length > 0 && (
        <Button
          onClick={onContinue}
          className="mt-2 rounded-full bg-gradient-to-r from-amber-500 to-pink-500"
          size="lg"
        >
          <Play className="mr-2 h-5 w-5" />
          Ga naar animatie
        </Button>
      )}
    </div>
  );
}
