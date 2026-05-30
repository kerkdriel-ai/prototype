"use client";

import { Cloud, Download, HardDrive, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadVideoUrl } from "@/lib/animate-video";
import {
  formatVideoDate,
  formatVideoModel,
  formatVideoSource,
  formatVideoStyle,
  videoDownloadFilename,
} from "@/lib/video-history";
import type { AiVideoRecord } from "@/types/drawing";

interface VideoHistoryPanelProps {
  videos: AiVideoRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  drawingName: string;
  prominent?: boolean;
  title?: string;
}

export function VideoHistoryPanel({
  videos,
  selectedId,
  onSelect,
  drawingName,
  prominent = false,
  title = "Gegenereerde video's",
}: VideoHistoryPanelProps) {
  if (videos.length === 0) return null;

  const selected =
    videos.find((v) => v.id === selectedId) ?? videos[0];

  return (
    <div
      className={`space-y-3 rounded-xl border-2 border-violet-200 bg-white/90 ${
        prominent ? "p-4" : "p-3"
      }`}
    >
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-violet-600" />
        <h4
          className={`font-bold text-violet-950 ${prominent ? "text-base" : "text-sm"}`}
        >
          {title} ({videos.length})
        </h4>
      </div>

      {selected && (
        <video
          key={selected.id}
          src={selected.url}
          controls
          playsInline
          className={`w-full rounded-lg border border-violet-200 bg-black ${
            prominent ? "min-h-[200px]" : ""
          }`}
        />
      )}

      <ul className="max-h-48 space-y-1.5 overflow-y-auto">
        {videos.map((video) => {
          const active = video.id === selected?.id;
          const ProviderIcon =
            video.provider === "local" ? HardDrive : Cloud;

          return (
            <li key={video.id}>
              <button
                type="button"
                onClick={() => onSelect(video.id!)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-violet-400 bg-violet-50 ring-1 ring-violet-200"
                    : "border-violet-100 bg-white hover:border-violet-200 hover:bg-violet-50/50"
                }`}
              >
                <div className="flex items-start gap-2">
                  <ProviderIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
                  <div className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-violet-950">
                      {formatVideoDate(video.createdAt)}
                    </span>
                    <span className="block text-[11px] text-violet-800/90">
                      {formatVideoModel(video)}
                    </span>
                    <span className="block text-[10px] text-violet-600/80">
                      {formatVideoSource(video)} · {formatVideoStyle(video)}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {selected && (
        <Button
          variant="outline"
          size="sm"
          className="w-full rounded-full"
          onClick={() =>
            downloadVideoUrl(
              selected.url,
              videoDownloadFilename(drawingName, selected)
            )
          }
        >
          <Download className="mr-2 h-4 w-4" />
          Download geselecteerde video
        </Button>
      )}
    </div>
  );
}
