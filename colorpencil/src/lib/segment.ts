import { otsuThreshold } from '$lib/line-extract';
import { grayOverWhite, type BBox } from '$lib/cutout';

const NEAREST_INK_RADIUS = 40;
const GAP_BRIDGE_RADIUS = 6;
const MAX_COMPONENT_COVERAGE = 0.85;

export interface Region {
	mask: Uint8Array;
	bbox: BBox;
}

export function computeInkThreshold(source: ImageData): number {
	const total = source.width * source.height;
	const gray = new Uint8Array(total);
	for (let i = 0; i < total; i++) {
		gray[i] = Math.round(grayOverWhite(source.data, i * 4));
	}
	return otsuThreshold(gray);
}

function buildInkMap(source: ImageData, inkThreshold: number): Uint8Array {
	const total = source.width * source.height;
	const isInk = new Uint8Array(total);
	for (let i = 0; i < total; i++) {
		isInk[i] = grayOverWhite(source.data, i * 4) < inkThreshold ? 1 : 0;
	}
	return isInk;
}

function dilate(map: Uint8Array, width: number, height: number, radius: number): Uint8Array {
	let current = map;
	for (let pass = 0; pass < radius; pass++) {
		const next = current.slice();
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = y * width + x;
				if (current[idx] === 1) continue;
				const touches =
					(x > 0 && current[idx - 1] === 1) ||
					(x < width - 1 && current[idx + 1] === 1) ||
					(y > 0 && current[idx - width] === 1) ||
					(y < height - 1 && current[idx + width] === 1);
				if (touches) next[idx] = 1;
			}
		}
		current = next;
	}
	return current;
}

function nearestInk(isInk: Uint8Array, width: number, height: number, x: number, y: number): number | null {
	if (isInk[y * width + x] === 1) return y * width + x;
	for (let radius = 1; radius <= NEAREST_INK_RADIUS; radius++) {
		for (let dy = -radius; dy <= radius; dy++) {
			const ny = y + dy;
			if (ny < 0 || ny >= height) continue;
			for (let dx = -radius; dx <= radius; dx++) {
				if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
				const nx = x + dx;
				if (nx < 0 || nx >= width) continue;
				if (isInk[ny * width + nx] === 1) return ny * width + nx;
			}
		}
	}
	return null;
}

export function selectInkComponent(
	source: ImageData,
	seedX: number,
	seedY: number,
	inkThreshold: number,
): Region | null {
	const width = source.width;
	const height = source.height;
	const total = width * height;

	if (seedX < 0 || seedX >= width || seedY < 0 || seedY >= height) return null;

	const isInk = buildInkMap(source, inkThreshold);
	const seed = nearestInk(isInk, width, height, seedX, seedY);
	if (seed === null) return null;

	const connectable = dilate(isInk, width, height, GAP_BRIDGE_RADIUS);

	const mask = new Uint8Array(total);
	const queue = [seed];
	mask[seed] = 1;
	let count = 0;

	while (queue.length > 0) {
		const current = queue.pop()!;
		count++;
		const cx = current % width;
		const cy = (current - cx) / width;

		for (let dy = -1; dy <= 1; dy++) {
			const ny = cy + dy;
			if (ny < 0 || ny >= height) continue;
			for (let dx = -1; dx <= 1; dx++) {
				if (dx === 0 && dy === 0) continue;
				const nx = cx + dx;
				if (nx < 0 || nx >= width) continue;
				const ni = ny * width + nx;
				if (connectable[ni] === 1 && mask[ni] === 0) {
					mask[ni] = 1;
					queue.push(ni);
				}
			}
		}
	}

	if (count > total * MAX_COMPONENT_COVERAGE) return null;

	let minX = width;
	let minY = height;
	let maxX = 0;
	let maxY = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (mask[y * width + x] !== 1) continue;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	}

	return {
		mask,
		bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
	};
}
