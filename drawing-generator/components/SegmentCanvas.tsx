"use client";

import { useEffect, useRef, useState } from "react";
import type { Part } from "@/types/drawing";

interface SegmentCanvasProps {
  originalImage: string;
  parts: Part[];
  width: number;
  height: number;
  selectedIds: string[];
  onSelect: (id: string, multi: boolean) => void;
}

export function SegmentCanvas({
  originalImage,
  parts,
  width,
  height,
  selectedIds,
  onSelect,
}: SegmentCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const maxW = containerRef.current.clientWidth - 32;
      const maxH = 500;
      setScale(Math.min(maxW / width, maxH / height, 1));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [width, height]);

  const displayW = width * scale;
  const displayH = height * scale;

  return (
    <div ref={containerRef} className="flex justify-center">
      <div
        className="relative overflow-hidden rounded-2xl border-4 border-orange-200 bg-white shadow-lg"
        style={{ width: displayW, height: displayH }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={originalImage}
          alt="Tekening"
          className="absolute inset-0 h-full w-full object-contain opacity-30"
          draggable={false}
        />
        {parts.map((part) => {
          const selected = selectedIds.includes(part.id);
          return (
            <button
              key={part.id}
              type="button"
              className={`absolute transition-all ${
                selected
                  ? "ring-4 ring-pink-500 ring-offset-2 z-10"
                  : "hover:ring-2 hover:ring-orange-300"
              }`}
              style={{
                left: part.bbox.x * scale,
                top: part.bbox.y * scale,
                width: part.bbox.width * scale,
                height: part.bbox.height * scale,
              }}
              onClick={(e) => onSelect(part.id, e.shiftKey)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={part.imageDataUrl}
                alt={part.label}
                className="h-full w-full object-contain"
                draggable={false}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
