import gsap from "gsap";
import type Konva from "konva";
import type { AnimationPreset } from "@/types/drawing";

const activeTweens = new WeakMap<Konva.Node, gsap.core.Tween[]>();

export function stopAnimations(node: Konva.Node): void {
  const tweens = activeTweens.get(node);
  if (tweens) {
    tweens.forEach((t) => t.kill());
    activeTweens.delete(node);
  }
  node.opacity(1);
  node.rotation(0);
  node.scaleX(1);
  node.scaleY(1);
}

function setupCenterScale(
  node: Konva.Node,
  baseX: number,
  baseY: number,
  width: number,
  height: number
): void {
  node.offsetX(width / 2);
  node.offsetY(height / 2);
  node.x(baseX + width / 2);
  node.y(baseY + height / 2);
}

function resetPosition(
  node: Konva.Node,
  baseX: number,
  baseY: number,
  width: number,
  height: number,
  useCenter: boolean
): void {
  if (useCenter) {
    setupCenterScale(node, baseX, baseY, width, height);
  } else {
    node.offsetX(0);
    node.offsetY(0);
    node.x(baseX);
    node.y(baseY);
  }
}

export function applyAnimation(
  node: Konva.Node,
  preset: AnimationPreset,
  speed: number,
  baseX: number,
  baseY: number,
  width = 0,
  height = 0
): void {
  stopAnimations(node);

  if (preset === "none") {
    node.x(baseX);
    node.y(baseY);
    return;
  }

  const tweens: gsap.core.Tween[] = [];
  const duration = 2 / speed;
  const w = width || node.width();
  const h = height || node.height();
  const needsCenter = ["pulse", "spin", "hop"].includes(preset);
  resetPosition(node, baseX, baseY, w, h, needsCenter);

  const posX = needsCenter ? baseX + w / 2 : baseX;
  const posY = needsCenter ? baseY + h / 2 : baseY;

  switch (preset) {
    case "float":
      tweens.push(
        gsap.to(node, {
          y: posY - 18,
          duration,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        })
      );
      break;

    case "wobble":
      tweens.push(
        gsap.to(node, {
          rotation: 6,
          duration: duration * 0.55,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        })
      );
      break;

    case "bounce":
      tweens.push(
        gsap.to(node, {
          y: posY - 28,
          duration: duration * 0.35,
          yoyo: true,
          repeat: -1,
          ease: "power2.out",
        })
      );
      break;

    case "blink":
      tweens.push(
        gsap.to(node, {
          opacity: 0.15,
          duration: duration * 0.25,
          yoyo: true,
          repeat: -1,
          ease: "power1.inOut",
        })
      );
      break;

    case "sway":
      tweens.push(
        gsap.to(node, {
          rotation: 10,
          x: posX + 6,
          duration: duration * 0.7,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        })
      );
      tweens.push(
        gsap.to(node, {
          y: posY - 4,
          duration: duration * 1.1,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        })
      );
      break;

    case "pulse":
      tweens.push(
        gsap.to(node, {
          scaleX: 1.12,
          scaleY: 1.12,
          duration: duration * 0.6,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        })
      );
      tweens.push(
        gsap.to(node, {
          opacity: 0.88,
          duration: duration * 0.6,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        })
      );
      break;

    case "spin":
      tweens.push(
        gsap.to(node, {
          rotation: 360,
          duration: duration * 3,
          repeat: -1,
          ease: "none",
        })
      );
      break;

    case "hop":
      tweens.push(
        gsap.to(node, {
          y: posY - 22,
          scaleY: 1.08,
          scaleX: 0.94,
          duration: duration * 0.28,
          yoyo: true,
          repeat: -1,
          ease: "power2.out",
        })
      );
      break;

    case "flutter":
      tweens.push(
        gsap.to(node, {
          y: posY - 14,
          x: posX + 10,
          rotation: 12,
          duration: duration * 0.45,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        })
      );
      break;

    case "wave":
      tweens.push(
        gsap.to(node, {
          x: posX + 8,
          skewX: 3,
          duration: duration * 0.8,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        })
      );
      tweens.push(
        gsap.to(node, {
          opacity: 0.82,
          duration: duration * 0.9,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        })
      );
      break;
  }

  activeTweens.set(node, tweens);
}

export function stopAllAnimations(nodes: Konva.Node[]): void {
  nodes.forEach(stopAnimations);
}

export const PRESET_LABELS: Record<AnimationPreset, string> = {
  float: "Zweven",
  wobble: "Wiebelen",
  bounce: "Stuiteren",
  blink: "Knipperen",
  sway: "Wuiven",
  pulse: "Pulsen",
  spin: "Draaien",
  hop: "Huppelen",
  flutter: "Fladderen",
  wave: "Golven",
  none: "Geen",
};
