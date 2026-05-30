"use client";

import { Loader2 } from "lucide-react";

export interface VideoGenerationProgressProps {
  message: string | null;
  progressPercent?: number;
  elapsedSeconds?: number;
  isLocal?: boolean;
}

function formatElapsed(seconds?: number): string {
  if (seconds == null) return "";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function VideoGenerationProgress({
  message,
  progressPercent,
  elapsedSeconds,
  isLocal = false,
}: VideoGenerationProgressProps) {
  if (!message) return null;

  const pct =
    progressPercent != null
      ? Math.min(100, Math.max(0, progressPercent))
      : undefined;

  return (
    <div className="rounded-xl border-2 border-violet-200 bg-violet-50/80 p-4">
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-violet-600" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium text-violet-950">{message}</p>
          {elapsedSeconds != null && elapsedSeconds > 0 && (
            <p className="text-xs text-violet-700">
              Verstreken tijd: {formatElapsed(elapsedSeconds)}
            </p>
          )}
          {pct != null && (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-violet-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-600 to-pink-500 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[11px] text-violet-600">{pct}%</p>
            </div>
          )}
          {isLocal && (
            <p className="text-xs leading-relaxed text-violet-700/90">
              Lokale generatie op CPU kan 10–30 minuten duren. Zolang de voortgang
              oploopt, werkt het. In de terminal zie je regels{" "}
              <code className="rounded bg-violet-100 px-1">[local-video]</code>{" "}
              met stappen — de herhaalde GET-requests zijn normale statuschecks.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function formatVideoProgressMessage(
  progress?: string,
  elapsedSeconds?: number,
  progressPercent?: number
): string {
  const parts: string[] = [];
  if (progress) parts.push(progress);
  if (progressPercent != null) parts.push(`${progressPercent}%`);
  if (elapsedSeconds != null && elapsedSeconds > 0) {
    parts.push(`${formatElapsed(elapsedSeconds)} verstreken`);
  }
  return parts.join(" · ") || "Bezig...";
}
