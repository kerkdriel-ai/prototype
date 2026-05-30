import type { AnimationPreset, Part } from "@/types/drawing";
import type { SegmentPartResponse } from "@/types/drawing";

const GENERIC_LABEL = /^Onderdeel\s*\d+$/i;
const BLOCKED_LABELS = new Set([
  "part",
  "merged",
  "object",
  "objects",
  "item",
  "items",
  "thing",
  "drawing",
  "tekening",
  "figuur",
  "shape",
  "vorm",
  "element",
  "onderdeel",
  "unknown",
]);

export function isGenericPartLabel(label: string): boolean {
  const t = label.trim();
  if (!t || GENERIC_LABEL.test(t)) return true;
  return BLOCKED_LABELS.has(t.toLowerCase());
}

export function normalizePartLabel(label: string, fallbackIndex: number): string {
  const trimmed = label.trim();
  if (isGenericPartLabel(trimmed)) return `Onderdeel ${fallbackIndex + 1}`;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

interface AnimationRule {
  keywords: string[];
  preset: AnimationPreset;
  speed: number;
}

const ANIMATION_RULES: AnimationRule[] = [
  {
    keywords: ["zon", "sun", "maan", "moon", "ster", "star", "hart", "heart"],
    preset: "pulse",
    speed: 0.85,
  },
  {
    keywords: [
      "bloem",
      "flower",
      "tulp",
      "roos",
      "daisy",
      "plant",
      "blad",
      "leaf",
      "boom",
      "tree",
      "struik",
      "bush",
      "gras",
      "grass",
      "tak",
      "branch",
    ],
    preset: "sway",
    speed: 1.15,
  },
  {
    keywords: [
      "vlinder",
      "butterfly",
      "vogel",
      "bird",
      "bij",
      "bee",
      "insect",
      "libel",
      "dragonfly",
    ],
    preset: "flutter",
    speed: 1.5,
  },
  {
    keywords: [
      "hond",
      "dog",
      "kat",
      "cat",
      "koe",
      "cow",
      "paard",
      "horse",
      "konijn",
      "rabbit",
      "beer",
      "bear",
      "varken",
      "pig",
      "schaap",
      "sheep",
      "dier",
      "animal",
      "kip",
      "chicken",
    ],
    preset: "hop",
    speed: 1.25,
  },
  {
    keywords: ["bal", "ball", "auto", "car", "bus", "vrachtwagen", "truck"],
    preset: "bounce",
    speed: 1.35,
  },
  {
    keywords: ["fiets", "bike", "wiel", "wheel", "trein", "train"],
    preset: "spin",
    speed: 1.1,
  },
  {
    keywords: [
      "wolk",
      "cloud",
      "ballon",
      "balloon",
      "regenboog",
      "rainbow",
      "vliegtuig",
      "plane",
      "boot",
      "boat",
      "lucht",
      "sky",
    ],
    preset: "float",
    speed: 0.75,
  },
  {
    keywords: ["hangmat", "hammock", "schommel", "swing", "vlag", "flag"],
    preset: "sway",
    speed: 0.65,
  },
  {
    keywords: ["water", "vijver", "pond", "zee", "sea", "rivier", "river"],
    preset: "wave",
    speed: 0.9,
  },
  {
    keywords: [
      "persoon",
      "person",
      "man",
      "vrouw",
      "woman",
      "kind",
      "child",
      "jongen",
      "boy",
      "meisje",
      "girl",
      "gezicht",
      "face",
      "figuur",
    ],
    preset: "wobble",
    speed: 1,
  },
  {
    keywords: [
      "huis",
      "house",
      "gebouw",
      "building",
      "cabine",
      "cabin",
      "hek",
      "fence",
      "muur",
      "wall",
      "tafel",
      "table",
      "stoel",
      "chair",
    ],
    preset: "none",
    speed: 1,
  },
  {
    keywords: ["oog", "eye", "licht", "light", "lamp"],
    preset: "blink",
    speed: 1.4,
  },
];

export function inferAnimationFromLabel(label: string): {
  animation: AnimationPreset;
  speed: number;
} {
  const lower = label.toLowerCase();

  for (const rule of ANIMATION_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return { animation: rule.preset, speed: rule.speed };
    }
  }

  return { animation: "float", speed: 1 };
}

export function segmentPartToPart(
  part: SegmentPartResponse,
  index: number
): Part {
  const label = normalizePartLabel(part.label, index);
  const { animation, speed } = inferAnimationFromLabel(label);

  return {
    ...part,
    label,
    animation,
    speed,
  };
}
