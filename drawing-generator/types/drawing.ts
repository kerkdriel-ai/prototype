export type AnimationPreset =
  | "float"
  | "wobble"
  | "bounce"
  | "blink"
  | "sway"
  | "pulse"
  | "spin"
  | "hop"
  | "flutter"
  | "wave"
  | "none";

export type VideoMotionStyle = "magical" | "playful" | "gentle";

export interface AiVideoRecord {
  id?: string;
  url: string;
  prompt: string;
  style: VideoMotionStyle;
  createdAt: number;
  model: string;
  elementInstructions?: Array<{
    partId: string;
    label: string;
    action: string;
    enabled: boolean;
  }>;
  sceneNote?: string;
  fromScript?: boolean;
  scriptCreatedAt?: number;
  provider?: import("@/lib/video-types").VideoProvider;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Part {
  id: string;
  label: string;
  bbox: BBox;
  center: { x: number; y: number };
  imageDataUrl: string;
  animation: AnimationPreset;
  speed: number;
}

export interface AnimationScriptRecord {
  summary: string;
  script: string;
  moments: Array<{ label: string; beat: string }>;
  createdAt: number;
}

export interface Drawing {
  id: string;
  name: string;
  originalImageDataUrl: string;
  width: number;
  height: number;
  parts: Part[];
  createdAt: number;
  updatedAt: number;
  segmentCacheKey?: string;
  /** @deprecated gebruik aiVideos */
  aiVideo?: AiVideoRecord;
  aiVideos?: AiVideoRecord[];
  animationScript?: AnimationScriptRecord;
}

export interface StreetViewScene {
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  zoom: number;
  scale: number;
  partPositions: Record<string, { x: number; y: number }>;
}

export interface SegmentPartResponse {
  id: string;
  label: string;
  bbox: BBox;
  center: { x: number; y: number };
  imageDataUrl: string;
}

import type { SegmentQuality } from "@/lib/segment-models";

export type SegmentSource =
  | "gemini-premium"
  | "grounded-sam"
  | "replicate"
  | "connected-components"
  | "color-cluster";

export interface SegmentResponse {
  parts: SegmentPartResponse[];
  width: number;
  height: number;
  source: SegmentSource;
  quality: SegmentQuality;
}
