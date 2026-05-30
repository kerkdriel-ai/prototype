/** Segmentatie-kwaliteit — premium gebruikt Gemini + multi-pass Grounded SAM. */
export type SegmentQuality = "standard" | "premium";

export function getDefaultSegmentQuality(): SegmentQuality {
  const q = process.env.SEGMENT_QUALITY?.toLowerCase();
  return q === "premium" ? "premium" : "standard";
}

/** Enkele pass — standard tier. */
export const DRAWING_OBJECT_PROMPT =
  "sun, moon, star, cloud, rainbow, tree, bush, flower, grass, leaf, plant, " +
  "house, building, roof, window, door, fence, wall, path, road, " +
  "person, man, woman, child, boy, girl, face, head, body, arm, hand, leg, foot, " +
  "animal, dog, cat, bird, butterfly, bee, insect, fish, horse, rabbit, bear, " +
  "car, bus, truck, bike, boat, plane, train, balloon, " +
  "table, chair, bed, sofa, lamp, cup, plate, food, " +
  "hammock, swing, tent, castle, mountain, rock, water, pond, " +
  "heart, ball, toy, kite, flag, hat, shoe";

/** Premium: gerichte passes voor betere recall op drukke tekeningen. */
export const DRAWING_PROMPT_GROUPS = [
  "sun, moon, star, cloud, rainbow, sky, light, bright circle",
  "tree, birch tree, trunk, bush, branch, leaf, grass, meadow, plant",
  "flower, tulip, rose, daisy, blossom, petal, bouquet, garden flower, flower pot",
  "house, cabin, building, roof, window, door, fence, wall, path, table, chair",
  "person, man, woman, child, boy, girl, face, head, body, arm, hand, leg, hammock",
  "bird, butterfly, bee, insect, animal, dog, cat, fish, horse, rabbit, bear",
  "car, bus, truck, bike, boat, plane, train, balloon, ball, toy, kite, heart",
];

export const GROUNDED_SAM_MODEL =
  process.env.REPLICATE_GROUNDED_SAM_MODEL ??
  "schananas/grounded_sam:ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c";

export const SAM2_AUTO_MODEL =
  process.env.REPLICATE_SEGMENT_MODEL ??
  "meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83";

export const GEMINI_VISION_MODEL =
  process.env.REPLICATE_GEMINI_MODEL ??
  "google/gemini-2.5-flash:6585308f2652e91c80134f0e070d01bd66107b68590f50ff601860ea6902e813";

export const PREMIUM_MAX_PARTS = 14;
export const STANDARD_MAX_PARTS = 12;

/** Minimale detectie-grootte (percent van beeld). */
export const MIN_DETECTION_W_PCT = 2.5;
export const MIN_DETECTION_H_PCT = 2.5;
export const MIN_DETECTION_AREA_PCT = 0.35;

/** Minimale mask-grootte als fractie van totaal aantal pixels. */
export const MIN_MASK_AREA_RATIO = 0.0012;

/** Delay tussen Replicate-calls (Replicate <$5 tegoed ≈ 6 req/min → min. 12s). */
export const REPLICATE_CALL_DELAY_MS = Number(
  process.env.REPLICATE_CALL_DELAY_MS ?? "12000"
);
