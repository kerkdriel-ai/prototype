import type { AnimationPreset } from "@/types/drawing";
import { inferAnimationFromLabel } from "@/lib/part-intelligence";

export interface VideoElementInstruction {
  partId: string;
  label: string;
  action: string;
  enabled: boolean;
}

const PRESET_ACTIONS: Record<AnimationPreset, string[]> = {
  float: ["zweeft zacht omhoog en omlaag", "drijft langzaam door de lucht"],
  sway: ["wiegt rustig heen en weer", "zwaait zachtjes op en neer"],
  wobble: ["wiebelt vrolijk", "wiegt blij heen en weer"],
  bounce: ["springt op en neer", "huppelt vrolijk"],
  blink: ["knippert zacht", "pulseert met licht"],
  pulse: ["pulseert zacht", "straalt warm en klopt zachtjes"],
  spin: ["draait langzaam rond", "rolt vrolijk rondjes"],
  hop: ["huppelt op en neer", "springt vrolijk"],
  flutter: ["fladdert met vleugels", "vliegt rondjes door het beeld"],
  wave: ["deint als golven", "beweegt zacht op en neer"],
  none: ["blijft rustig op z'n plek", "staat stil met subtiele beweging"],
};

const LABEL_ACTIONS: Array<{ keywords: string[]; actions: string[] }> = [
  {
    keywords: ["zon", "sun", "maan", "moon"],
    actions: [
      "straalt warm en pulseert zacht",
      "nestelt lichtstralen uit",
      "glimlacht en straalt",
    ],
  },
  {
    keywords: ["boom", "tree", "berk"],
    actions: [
      "wiegt zacht in de wind",
      "zwaait met takken heen en weer",
      "beweegt rustig op en neer",
    ],
  },
  {
    keywords: ["bloem", "bloemen", "flower"],
    actions: [
      "wiegt op de stengel",
      "zwaait zacht in de wind",
      "bloeit langzaam open en dicht",
    ],
  },
  {
    keywords: ["vlinder", "butterfly", "vogel", "bird"],
    actions: [
      "vliegt rondjes door het beeld",
      "fladdert van links naar rechts",
      "zweeft speels rond",
    ],
  },
  {
    keywords: ["persoon", "man", "vrouw", "kind", "stitch", "pikachu"],
    actions: [
      "zwaait vriendelijk",
      "wiebelt blij",
      "springt vrolijk op en neer",
      "knikt en lacht",
    ],
  },
  {
    keywords: ["hond", "dog", "kat", "cat", "koe", "dier", "animal"],
    actions: [
      "huppelt vrolijk",
      "kwispelt met staart",
      "springt blij op en neer",
    ],
  },
  {
    keywords: ["huis", "house", "cabine"],
    actions: [
      "rookjes komen uit de schoorsteen",
      "raamlicht knippert zacht",
      "blijft stil, wind waait langs het dak",
    ],
  },
  {
    keywords: ["hangmat", "hammock"],
    actions: [
      "schommelt rustig heen en weer",
      "wiegt zacht tussen de bomen",
    ],
  },
  {
    keywords: ["boot", "boat", "water"],
    actions: [
      "deinert op het water",
      "zwaait zacht op de golven",
    ],
  },
  {
    keywords: ["auto", "car", "fiets", "bike", "trein"],
    actions: [
      "rijdt langzaam door het beeld",
      "beweegt vrolijk van links naar rechts",
    ],
  },
  {
    keywords: ["wolk", "cloud", "ballon", "balloon"],
    actions: [
      "drijft langzaam door de lucht",
      "zweeft zacht voorbij",
    ],
  },
  {
    keywords: ["ster", "star", "regenboog", "rainbow"],
    actions: [
      "fonkelt en twinkelt",
      "straalt zacht en pulseert",
    ],
  },
  {
    keywords: ["tafel", "table", "stoel", "chair"],
    actions: [
      "blijft stil, schaduw beweegt zacht",
      "wiegt heel subtiel",
    ],
  },
];

export function getVideoActionSuggestions(label: string): string[] {
  const lower = label.toLowerCase();
  const fromLabel = LABEL_ACTIONS.find((r) =>
    r.keywords.some((kw) => lower.includes(kw))
  );
  if (fromLabel) return fromLabel.actions;

  const { animation } = inferAnimationFromLabel(label);
  return PRESET_ACTIONS[animation];
}

export function getDefaultVideoAction(label: string): string {
  return getVideoActionSuggestions(label)[0] ?? "komt zacht tot leven";
}

export function createInitialElementInstructions(
  parts: Array<{ id: string; label: string }>
): VideoElementInstruction[] {
  return parts.map((p) => ({
    partId: p.id,
    label: p.label,
    action: getDefaultVideoAction(p.label),
    enabled: true,
  }));
}

export function getSceneSuggestions(
  labels: string[],
  style: "magical" | "playful" | "gentle"
): string[] {
  const base: Record<typeof style, string[]> = {
    magical: [
      "Magische sparkles zweven door het beeld",
      "Zachte magische gloed over de hele tekening",
      "Alles komt tot leven met een vleugje toverij",
    ],
    playful: [
      "Vrolijke, speelse beweging in het hele tafereel",
      "Alles beweegt op een blije, energieke manier",
      "Het tafereel leeft vrolijk op als een cartoon",
    ],
    gentle: [
      "Kalme, rustige beweging in het hele beeld",
      "Zachte bries waait door het tafereel",
      "Alles beweegt langzaam en vredig",
    ],
  };

  const hints: string[] = [...base[style]];

  if (labels.some((l) => /zon|sun/i.test(l))) {
    hints.push("Warm zonlicht vult het tafereel");
  }
  if (labels.some((l) => /boom|tree/i.test(l))) {
    hints.push("Bladeren ritselen zacht in de wind");
  }

  return hints.slice(0, 5);
}
