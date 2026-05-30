import type { VideoMotionStyle } from "@/lib/video-models";
import { VIDEO_MOTION_STYLES } from "@/lib/video-models";
import { isGenericPartLabel } from "@/lib/part-intelligence";
import type { VideoElementInstruction } from "@/lib/video-prompt-suggestions";

const STYLE_SUFFIX =
  "Preserve the original hand-drawn children's art style, colors and outlines. Kid-friendly, cheerful, no scary elements.";

export function buildVideoPrompt(opts: {
  partLabels?: string[];
  style?: VideoMotionStyle;
  customPrompt?: string;
  elementInstructions?: VideoElementInstruction[];
  sceneNote?: string;
  scriptNarrative?: string;
}): string {
  const {
    partLabels = [],
    style = "magical",
    customPrompt,
    elementInstructions,
    sceneNote,
    scriptNarrative,
  } = opts;

  const activeElements =
    elementInstructions?.filter(
      (e) => e.enabled && e.action.trim() && !isGenericPartLabel(e.label)
    ) ?? [];

  if (activeElements.length > 0) {
    const perElement = activeElements
      .map((e) => `The ${e.label.toLowerCase()} ${e.action.trim()}`)
      .join(". ");

    const parts: string[] = [];

    if (scriptNarrative?.trim()) {
      parts.push(
        `Follow this animation script closely: ${scriptNarrative.trim()}`
      );
    }

    parts.push(`Animate this children's drawing. ${perElement}.`);

    if (sceneNote?.trim()) {
      parts.push(sceneNote.trim() + ".");
    }

    parts.push(VIDEO_MOTION_STYLES[style].hint + ".");
    parts.push(STYLE_SUFFIX);

    return parts.join(" ");
  }

  if (customPrompt?.trim()) {
    const narrative = scriptNarrative?.trim()
      ? `${scriptNarrative.trim()}. ${customPrompt.trim()}`
      : customPrompt.trim();
    return `${narrative}. ${STYLE_SUFFIX}`;
  }

  const objects = partLabels
    .map((l) => l.trim())
    .filter((l) => l && !isGenericPartLabel(l));

  const motion = VIDEO_MOTION_STYLES[style].hint;

  if (objects.length === 0) {
    const note = sceneNote?.trim() ? `${sceneNote.trim()}. ` : "";
    return (
      `${note}Whimsical animation of a children's drawing coming to life. ${motion}. ` +
      "Keep the hand-drawn crayon/marker style, no photorealism, kid-friendly."
    );
  }

  const scene = sceneNote?.trim() ? `${sceneNote.trim()}. ` : "";

  return (
    `${scene}Animate this children's drawing: ${objects.join(", ")} come alive with ${motion}. ` +
    STYLE_SUFFIX
  );
}

export const VIDEO_NEGATIVE_PROMPT =
  "photorealistic, 3d render, horror, dark, violent, blurry, distorted faces, text overlay, watermark";

/** @deprecated gebruik buildVideoPrompt met object */
export function buildVideoPromptLegacy(
  partLabels: string[],
  style: VideoMotionStyle = "magical",
  customPrompt?: string
): string {
  return buildVideoPrompt({ partLabels, style, customPrompt });
}
