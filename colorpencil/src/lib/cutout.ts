export interface BBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface CutOut {
	id: string;
	name: string;
	bitmap: ImageBitmap;
	bbox: BBox;
	hidden: boolean;
	motion?: string;
	frames?: ImageBitmap[];
	fps?: number;
	phase?: number;
}

export function grayOverWhite(data: Uint8ClampedArray, offset: number): number {
	const alpha = data[offset + 3] / 255;
	const luminance = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
	return alpha * luminance + (1 - alpha) * 255;
}

export async function makeCutOut(
	source: ImageData,
	mask: Uint8Array | null,
	bbox: BBox,
	inkThreshold: number,
): Promise<ImageBitmap> {
	const { x, y, w, h } = bbox;
	const sourceWidth = source.width;
	const sourceData = source.data;

	const out = new ImageData(w, h);
	const outData = out.data;

	for (let ry = 0; ry < h; ry++) {
		for (let rx = 0; rx < w; rx++) {
			const sourceIndex = (y + ry) * sourceWidth + (x + rx);
			if (mask && mask[sourceIndex] !== 1) continue;

			const sourceOffset = sourceIndex * 4;
			const gray = grayOverWhite(sourceData, sourceOffset);
			if (gray >= inkThreshold) continue;

			const darkness = 1 - gray / inkThreshold;
			const outOffset = (ry * w + rx) * 4;
			outData[outOffset] = sourceData[sourceOffset];
			outData[outOffset + 1] = sourceData[sourceOffset + 1];
			outData[outOffset + 2] = sourceData[sourceOffset + 2];
			outData[outOffset + 3] = Math.min(255, Math.round(255 * darkness));
		}
	}

	return createImageBitmap(out);
}
