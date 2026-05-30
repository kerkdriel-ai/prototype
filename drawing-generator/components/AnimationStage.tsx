"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import { Play, Pause, Download, FileImage, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { Part, AnimationPreset } from "@/types/drawing";
import {
  applyAnimation,
  stopAllAnimations,
  PRESET_LABELS,
} from "@/lib/animations";
import {
  exportStageToPng,
  exportStageToGif,
  downloadDataUrl,
  downloadBlob,
  exportDrawingJson,
} from "@/lib/export";
import { AiVideoGenerator } from "@/components/AiVideoGenerator";
import type { AiVideoRecord } from "@/types/drawing";

interface AnimationStageProps {
  originalImage: string;
  parts: Part[];
  width: number;
  height: number;
  onPartUpdate: (id: string, updates: Partial<Part>) => void;
  drawingExport?: unknown;
  drawingName?: string;
  aiVideo?: AiVideoRecord;
  onVideoSaved?: (video: AiVideoRecord) => void;
}

function useKonvaImage(src: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.src = src;
  }, [src]);
  return image;
}

function AnimatedPart({
  part,
  playing,
  highlighted,
}: {
  part: Part;
  playing: boolean;
  highlighted?: boolean;
}) {
  const image = useKonvaImage(part.imageDataUrl);
  const nodeRef = useRef<Konva.Image>(null);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || !playing) return;
    applyAnimation(
      node,
      part.animation,
      part.speed,
      part.bbox.x,
      part.bbox.y,
      part.bbox.width,
      part.bbox.height
    );
    return () => stopAllAnimations([node]);
  }, [
    part.animation,
    part.speed,
    part.bbox.x,
    part.bbox.y,
    part.bbox.width,
    part.bbox.height,
    playing,
  ]);

  if (!image) return null;

  return (
    <KonvaImage
      ref={nodeRef}
      image={image}
      x={part.bbox.x}
      y={part.bbox.y}
      width={part.bbox.width}
      height={part.bbox.height}
      shadowColor={highlighted ? "#8b5cf6" : undefined}
      shadowBlur={highlighted ? 18 : 0}
      shadowOpacity={highlighted ? 0.85 : 0}
    />
  );
}

export function AnimationStage({
  originalImage,
  parts,
  width,
  height,
  onPartUpdate,
  drawingExport,
  drawingName = "tekening",
  aiVideo,
  onVideoSaved,
}: AnimationStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const [playing, setPlaying] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(
    parts[0]?.id ?? null
  );
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const canvasBudget =
    viewportWidth >= 1280
      ? viewportWidth / 2 - 96
      : viewportWidth - 48;
  const scale = Math.min(canvasBudget / width, 560 / height, 1);
  const [exporting, setExporting] = useState(false);
  const [videoHighlightId, setVideoHighlightId] = useState<string | null>(null);
  const bgImage = useKonvaImage(originalImage);

  const selectedPart = parts.find((p) => p.id === selectedId);

  const handlePlayPause = () => {
    if (playing) {
      const stage = stageRef.current;
      if (stage) {
        stage.find("Image").forEach((node) => stopAllAnimations([node]));
      }
    }
    setPlaying(!playing);
  };

  const handleExportPng = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const dataUrl = exportStageToPng(stage);
    downloadDataUrl(dataUrl, `${drawingName}.png`);
  }, [drawingName]);

  const handleExportGif = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    setExporting(true);
    try {
      const wasPlaying = playing;
      setPlaying(true);
      await new Promise((r) => setTimeout(r, 100));
      const blob = await exportStageToGif(stage);
      downloadBlob(blob, `${drawingName}.gif`);
      setPlaying(wasPlaying);
    } finally {
      setExporting(false);
    }
  }, [drawingName, playing]);

  const handleExportJson = useCallback(() => {
    if (drawingExport) {
      exportDrawingJson(drawingExport, `${drawingName}.json`);
    }
  }, [drawingExport, drawingName]);

  return (
    <div className="grid gap-8 xl:grid-cols-2 xl:items-start">
      <div className="flex flex-col items-center gap-4">
        <div className="overflow-hidden rounded-2xl border-4 border-orange-200 bg-white shadow-lg">
          <Stage
            ref={stageRef}
            width={width * scale}
            height={height * scale}
            scaleX={scale}
            scaleY={scale}
          >
            <Layer>
              {bgImage && (
                <KonvaImage
                  image={bgImage}
                  width={width}
                  height={height}
                  opacity={0.25}
                />
              )}
              {parts.map((part) => (
                <AnimatedPart
                  key={part.id}
                  part={part}
                  playing={playing}
                  highlighted={videoHighlightId === part.id}
                />
              ))}
            </Layer>
          </Stage>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Button
            onClick={handlePlayPause}
            variant="outline"
            className="rounded-full"
          >
            {playing ? (
              <>
                <Pause className="mr-2 h-4 w-4" /> Pauze
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" /> Afspelen
              </>
            )}
          </Button>
          <Button
            onClick={handleExportPng}
            variant="outline"
            className="rounded-full"
          >
            <FileImage className="mr-2 h-4 w-4" /> PNG
          </Button>
          <Button
            onClick={handleExportGif}
            variant="outline"
            className="rounded-full"
            disabled={exporting}
          >
            <Film className="mr-2 h-4 w-4" />
            {exporting ? "Exporteren..." : "GIF"}
          </Button>
          <Button
            onClick={handleExportJson}
            variant="outline"
            className="rounded-full"
          >
            <Download className="mr-2 h-4 w-4" /> JSON
          </Button>
        </div>

        <details className="w-full max-w-lg rounded-xl border-2 border-orange-100 bg-white open:shadow-sm">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-orange-900 marker:content-none [&::-webkit-details-marker]:hidden">
            GSAP-bewegingen per onderdeel
          </summary>
          <div className="space-y-4 border-t border-orange-100 px-4 pb-4 pt-3">
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {parts.map((part) => (
                <li key={part.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(part.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      selectedId === part.id
                        ? "bg-pink-100 font-medium text-pink-900"
                        : "hover:bg-orange-50"
                    }`}
                  >
                    {part.label}
                    {part.animation !== "none" && (
                      <span className="ml-1 text-xs font-normal text-pink-600">
                        · {PRESET_LABELS[part.animation]}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>

            {selectedPart && (
              <div className="space-y-4 rounded-lg bg-orange-50/50 p-3">
                <div className="space-y-2">
                  <Label>Beweging</Label>
                  <Select
                    value={selectedPart.animation}
                    onValueChange={(v) =>
                      onPartUpdate(selectedId!, {
                        animation: v as AnimationPreset,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PRESET_LABELS) as AnimationPreset[]).map(
                        (key) => (
                          <SelectItem key={key} value={key}>
                            {PRESET_LABELS[key]}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Snelheid: {selectedPart.speed.toFixed(1)}x</Label>
                  <Slider
                    min={0.2}
                    max={3}
                    step={0.1}
                    value={[selectedPart.speed]}
                    onValueChange={(v) => {
                      const val = Array.isArray(v) ? v[0] : v;
                      onPartUpdate(selectedId!, { speed: val as number });
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </details>
      </div>

      {onVideoSaved && (
        <div className="xl:sticky xl:top-6">
          <AiVideoGenerator
            imageDataUrl={originalImage}
            parts={parts}
            drawingName={drawingName}
            existingVideo={aiVideo}
            onVideoSaved={onVideoSaved}
            onHighlightPart={setVideoHighlightId}
            prominent
          />
        </div>
      )}
    </div>
  );
}
