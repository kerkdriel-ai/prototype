export type SegmentProgressStep =
  | "preprocess"
  | "grounded-sam"
  | "sam2"
  | "gemini-vision"
  | "gemini-labels"
  | "grounded-sam-pass"
  | "merge"
  | "sprites"
  | "fallback-local";

export interface SegmentProgressEvent {
  type: "progress";
  step: SegmentProgressStep;
  label: string;
  current: number;
  total: number;
  percent: number;
}

export interface SegmentCompleteEvent {
  type: "complete";
  result: import("@/types/drawing").SegmentResponse;
}

export interface SegmentErrorEvent {
  type: "error";
  error: string;
}

export type SegmentStreamEvent =
  | SegmentProgressEvent
  | SegmentCompleteEvent
  | SegmentErrorEvent;

export type SegmentProgressCallback = (event: SegmentProgressEvent) => void;

export type ProgressTracker = {
  tick: (step: SegmentProgressStep, label: string) => void;
};

export const SAM_PASS_LABELS = [
  "Lucht & zon scannen",
  "Bomen & planten scannen",
  "Bloemen scannen",
  "Huizen & meubels scannen",
  "Mensen & figuren scannen",
  "Dieren scannen",
  "Voertuigen & speelgoed scannen",
];

export function emitProgress(
  onProgress: SegmentProgressCallback | undefined,
  step: SegmentProgressStep,
  label: string,
  current: number,
  total: number
): void {
  if (!onProgress) return;
  onProgress({
    type: "progress",
    step,
    label,
    current,
    total,
    percent: Math.min(99, Math.round((current / total) * 100)),
  });
}

export function encodeStreamEvent(event: SegmentStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}
