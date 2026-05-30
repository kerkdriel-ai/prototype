import type { AnimationScriptRecord, Part } from "@/types/drawing";
import type { VideoElementInstruction } from "@/lib/video-prompt-suggestions";
import type { VideoMotionStyle } from "@/lib/video-models";

export interface ScriptVideoParams {
  elementInstructions: VideoElementInstruction[];
  sceneNote: string;
  scriptNarrative: string;
  style: VideoMotionStyle;
}

function findPartForMoment(parts: Part[], label: string): Part | undefined {
  const lower = label.toLowerCase();
  return (
    parts.find((p) => p.label.toLowerCase() === lower) ??
    parts.find(
      (p) =>
        p.label.toLowerCase().includes(lower) ||
        lower.includes(p.label.toLowerCase())
    )
  );
}

/** Zet animatiescript om naar video-generatie parameters. */
export function scriptToVideoParams(
  script: AnimationScriptRecord,
  parts: Part[],
  style: VideoMotionStyle = "playful"
): ScriptVideoParams {
  const usedPartIds = new Set<string>();

  const elementInstructions: VideoElementInstruction[] = script.moments.map(
    (m) => {
      const part = findPartForMoment(parts, m.label);
      if (part) usedPartIds.add(part.id);
      return {
        partId: part?.id ?? `script-${m.label}`,
        label: part?.label ?? m.label,
        action: m.beat,
        enabled: true,
      };
    }
  );

  for (const part of parts) {
    if (!usedPartIds.has(part.id)) {
      elementInstructions.push({
        partId: part.id,
        label: part.label,
        action: "beweegt mee met het tafereel",
        enabled: true,
      });
    }
  }

  return {
    elementInstructions,
    sceneNote: script.summary,
    scriptNarrative: script.script,
    style,
  };
}
