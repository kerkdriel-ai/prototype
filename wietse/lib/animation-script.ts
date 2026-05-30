import { replicateRunWithRetry } from "@/lib/replicate-retry";
import { GEMINI_VISION_MODEL } from "@/lib/segment-models";
import { getDefaultVideoAction } from "@/lib/video-prompt-suggestions";
import type { Part } from "@/types/drawing";

export interface AnimationScriptMoment {
  label: string;
  beat: string;
}

export interface AnimationScriptResult {
  summary: string;
  script: string;
  moments: AnimationScriptMoment[];
}

const SYSTEM_INSTRUCTION = `Je bent een creatieve regisseur voor kindertekening-animaties.
Je krijgt een tekening en een lijst herkende onderdelen.

Antwoord ALLEEN met geldige JSON (geen markdown):
{
  "summary": "2-4 zinnen Nederlands: wat zie je op de tekening — setting, sfeer, hoofdonderwerpen",
  "script": "Kort animatiescript in het Nederlands (120-250 woorden). Beschrijf hoe het tafereel tot leven komt, in volgorde. Leg interacties tussen onderdelen uit (bijv. trampoline + persoon → persoon springt op de trampoline). Schrijf als regiebrief voor een animator: concreet, vrolijk, kindvriendelijk.",
  "moments": [
    {"label": "exact label uit de lijst", "beat": "1 zin: wat dit onderdeel doet in de animatie"}
  ]
}

Regels:
- Nederlands, warm en speels
- Gebruik ALLE onderdelen uit de lijst in moments (tenzij echt irrelevant)
- Denk aan logische interacties tussen objecten
- Geen angst, geweld of volwassen thema's`;

function collectGeminiText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output
      .map((chunk) => {
        if (typeof chunk === "string") return chunk;
        if (chunk && typeof chunk === "object" && "text" in chunk) {
          return String((chunk as { text: string }).text);
        }
        return "";
      })
      .join("");
  }
  return JSON.stringify(output);
}

function tryParseScriptJson(text: string): AnimationScriptResult | null {
  const cleaned = text.replace(/```json\s*|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      summary?: string;
      script?: string;
      moments?: Array<{ label?: string; beat?: string }>;
    };

    if (!parsed.summary?.trim() || !parsed.script?.trim()) return null;

    return {
      summary: parsed.summary.trim(),
      script: parsed.script.trim(),
      moments: (parsed.moments ?? [])
        .filter((m) => m.label?.trim() && m.beat?.trim())
        .map((m) => ({
          label: m.label!.trim(),
          beat: m.beat!.trim(),
        })),
    };
  } catch {
    return null;
  }
}

function partsContext(parts: Part[]): string {
  return parts
    .map((p, i) => {
      const cx = Math.round(p.center.x);
      const cy = Math.round(p.center.y);
      return `${i + 1}. "${p.label}" (midden ~${cx},${cy})`;
    })
    .join("\n");
}

export function buildFallbackAnimationScript(
  parts: Part[]
): AnimationScriptResult {
  const labels = parts.map((p) => p.label);
  const labelList = labels.join(", ");

  const hasTrampoline = labels.some((l) => /trampolin|trampoline/i.test(l));
  const hasPerson = labels.some((l) =>
    /persoon|kind|man|vrouw|meisje|jongen|stitch|pikachu/i.test(l)
  );

  const moments: AnimationScriptMoment[] = parts.map((p) => ({
    label: p.label,
    beat: getDefaultVideoAction(p.label),
  }));

  let interaction = "";
  if (hasTrampoline && hasPerson) {
    interaction =
      " Een kind rent naar de trampoline, springt erop en hupt vrolijk op en neer.";
  }

  const summary =
    labels.length > 0
      ? `Op deze tekening staan ${labels.length} onderdelen: ${labelList}. ` +
        "Het is een vrolijk kindertafereel vol kleur en fantasie."
      : "Een kindertekening die klaar is om tot leven te komen.";

  const script =
    `Het beeld wordt rustig wakker. Eerst bewegen de kleinste details zacht mee, ` +
    `alsof er een zachte bries waait.\n\n` +
    parts
      .map(
        (p, i) =>
          `Daarna ${i === 0 ? "komt" : "volgt"} de ${p.label.toLowerCase()}: ${getDefaultVideoAction(p.label)}.`
      )
      .join(" ") +
    interaction +
    `\n\nAlles beweegt samen in een blije, rustige choreografie. ` +
    `De handgetekende stijl blijft behouden — alsof de tekening zelf gaat dansen.`;

  return { summary, script, moments };
}

export async function generateAnimationScript(
  replicate: InstanceType<typeof import("replicate").default>,
  imageDataUrl: string,
  parts: Part[]
): Promise<AnimationScriptResult> {
  const userPrompt =
    `Bekijk deze kindertekening en schrijf een animatiescript.\n\n` +
    `Herkende onderdelen:\n${partsContext(parts)}`;

  const output = await replicateRunWithRetry(
    replicate,
    GEMINI_VISION_MODEL as `${string}/${string}:${string}`,
    {
      prompt: userPrompt,
      system_instruction: SYSTEM_INSTRUCTION,
      images: [imageDataUrl],
      temperature: 0.65,
      max_output_tokens: 4096,
    },
    "Animation script"
  );

  const text = collectGeminiText(output);
  const parsed = tryParseScriptJson(text);
  if (parsed) {
    const knownLabels = new Set(parts.map((p) => p.label.toLowerCase()));
    parsed.moments = parsed.moments.filter((m) =>
      knownLabels.has(m.label.toLowerCase())
    );

    for (const part of parts) {
      const has = parsed.moments.some(
        (m) => m.label.toLowerCase() === part.label.toLowerCase()
      );
      if (!has) {
        parsed.moments.push({
          label: part.label,
          beat: getDefaultVideoAction(part.label),
        });
      }
    }

    return parsed;
  }

  console.warn("[animation-script] JSON parse mislukt, fallback gebruikt");
  return buildFallbackAnimationScript(parts);
}
