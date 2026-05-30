"use client";

import { Sparkles, Check } from "lucide-react";
import type { SegmentProgressEvent } from "@/lib/segment-progress";

interface SegmentLoadingProps {
  label?: string;
  progress?: SegmentProgressEvent | null;
  completedSteps?: string[];
}

export function SegmentLoading({
  label,
  progress,
  completedSteps = [],
}: SegmentLoadingProps) {
  const percent = progress?.percent ?? 0;
  const stepLabel = label ?? progress?.label ?? "Onderdelen herkennen...";
  const stepInfo =
    progress && progress.total > 1
      ? `Stap ${progress.current} van ${progress.total}`
      : null;

  return (
    <div className="flex flex-col items-center gap-6 py-12">
      <div className="relative">
        <div className="flex h-48 w-48 items-center justify-center rounded-2xl border-2 border-orange-200 bg-gradient-to-br from-orange-50 to-pink-50">
          <div className="text-center">
            <p className="text-4xl font-bold tabular-nums text-orange-600">
              {percent}%
            </p>
            <p className="mt-1 text-xs text-orange-500/70">bezig</p>
          </div>
        </div>
        <Sparkles className="absolute -right-2 -top-2 h-8 w-8 animate-pulse text-pink-400" />
      </div>

      <div className="w-full max-w-md space-y-3">
        <div className="text-center">
          <h3 className="text-lg font-bold text-orange-900">{stepLabel}</h3>
          {stepInfo && (
            <p className="mt-1 text-sm text-orange-700/70">{stepInfo}</p>
          )}
        </div>

        <div className="h-3 w-full overflow-hidden rounded-full bg-orange-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-pink-500 transition-all duration-700 ease-out"
            style={{ width: `${Math.max(percent, 4)}%` }}
          />
        </div>
      </div>

      {completedSteps.length > 0 && (
        <ul className="w-full max-w-md space-y-1.5">
          {completedSteps.slice(-4).map((step) => (
            <li
              key={step}
              className="flex items-center gap-2 text-sm text-orange-800/60"
            >
              <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
              <span className="truncate">{step}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
