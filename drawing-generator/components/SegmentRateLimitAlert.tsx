"use client";

import { Clock } from "lucide-react";
import { formatRetryAfter } from "@/lib/segment-errors";

interface SegmentRateLimitAlertProps {
  message: string;
  retryAfterMs?: number;
  limit?: number;
  quality?: "standard" | "premium";
}

export function SegmentRateLimitAlert({
  message,
  retryAfterMs,
  limit,
  quality,
}: SegmentRateLimitAlertProps) {
  const retryHint =
    retryAfterMs && retryAfterMs > 0
      ? formatRetryAfter(retryAfterMs)
      : "over ongeveer een uur";

  return (
    <div
      role="alert"
      className="mx-auto max-w-xl rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-4 text-amber-950"
    >
      <div className="flex gap-3">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="space-y-1.5">
          <p className="font-semibold">Segmentatie-limiet bereikt</p>
          <p className="text-sm">{message}</p>
          <p className="text-sm text-amber-800/90">
            Opnieuw proberen {retryHint}.
            {limit != null && quality && (
              <>
                {" "}
                Limiet: {limit}× {quality === "premium" ? "Premium AI" : "Standaard"}{" "}
                per uur.
              </>
            )}
          </p>
          <p className="text-sm text-amber-700/80">
            Tip: gebruik Standaard i.p.v. Premium, of wacht tot de limiet reset.
          </p>
        </div>
      </div>
    </div>
  );
}
