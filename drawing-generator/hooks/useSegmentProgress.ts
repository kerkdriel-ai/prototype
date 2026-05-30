"use client";

import { useCallback, useRef, useState } from "react";
import type { SegmentProgressEvent } from "@/lib/segment-progress";

export function useSegmentProgress() {
  const [progress, setProgress] = useState<SegmentProgressEvent | null>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const prevLabelRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    setProgress(null);
    setCompletedSteps([]);
    prevLabelRef.current = null;
  }, []);

  const onProgress = useCallback((event: SegmentProgressEvent) => {
    if (prevLabelRef.current && prevLabelRef.current !== event.label) {
      setCompletedSteps((steps) =>
        steps.includes(prevLabelRef.current!)
          ? steps
          : [...steps, prevLabelRef.current!]
      );
    }
    prevLabelRef.current = event.label;
    setProgress(event);
  }, []);

  return { progress, completedSteps, onProgress, reset };
}
