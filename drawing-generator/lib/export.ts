import type Konva from "konva";

export function exportStageToPng(stage: Konva.Stage): string {
  return stage.toDataURL({ pixelRatio: 2 });
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

export async function exportStageToGif(
  stage: Konva.Stage,
  durationMs = 3000,
  fps = 10
): Promise<Blob> {
  const GIF = (await import("gif.js")).default;
  const frameCount = Math.ceil((durationMs / 1000) * fps);
  const delay = Math.round(1000 / fps);

  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: stage.width(),
    height: stage.height(),
    workerScript: "/gif.worker.js",
  });

  for (let i = 0; i < frameCount; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const canvas = stage.toCanvas({ pixelRatio: 1 });
    gif.addFrame(canvas, { copy: true, delay });
    await new Promise((r) => setTimeout(r, delay));
  }

  return new Promise((resolve, reject) => {
    gif.on("finished", (blob: Blob) => resolve(blob));
    gif.on("abort", reject);
    gif.render();
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportDrawingJson(drawing: unknown, filename: string): void {
  const json = JSON.stringify(drawing, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  downloadBlob(blob, filename);
}
