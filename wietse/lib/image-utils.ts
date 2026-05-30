export const MAX_FILE_SIZE = 4 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export async function getImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  const img = await loadImage(dataUrl);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

export function hashDataUrl(dataUrl: string): string {
  let hash = 0;
  const sample = dataUrl.slice(0, 2000) + dataUrl.length;
  for (let i = 0; i < sample.length; i++) {
    hash = (hash << 5) - hash + sample.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
