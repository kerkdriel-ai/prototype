export interface ExtractResult {
	imageData: ImageData;
	offsetX: number;
	offsetY: number;
	drawWidth: number;
	drawHeight: number;
}

interface Point2D {
	x: number;
	y: number;
}

export function otsuThreshold(gray: Uint8Array): number {
	const histogram = new Uint32Array(256);
	for (let i = 0; i < gray.length; i++) histogram[gray[i]]++;

	const total = gray.length;
	let sumAll = 0;
	for (let i = 0; i < 256; i++) sumAll += i * histogram[i];

	let sumB = 0;
	let wB = 0;
	let maxVariance = 0;
	let best = 0;

	for (let t = 0; t < 256; t++) {
		wB += histogram[t];
		if (wB === 0) continue;
		const wF = total - wB;
		if (wF === 0) break;
		sumB += t * histogram[t];
		const diff = sumB / wB - (sumAll - sumB) / wF;
		const variance = wB * wF * diff * diff;
		if (variance > maxVariance) {
			maxVariance = variance;
			best = t;
		}
	}
	return best;
}

function convexHull(points: Point2D[]): Point2D[] {
	if (points.length < 3) return [...points];
	points.sort((a, b) => a.x - b.x || a.y - b.y);

	const cross = (o: Point2D, a: Point2D, b: Point2D) =>
		(a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

	const lower: Point2D[] = [];
	for (const p of points) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
			lower.pop();
		lower.push(p);
	}

	const upper: Point2D[] = [];
	for (let i = points.length - 1; i >= 0; i--) {
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], points[i]) <= 0)
			upper.pop();
		upper.push(points[i]);
	}

	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

function pointDist(a: Point2D, b: Point2D): number {
	return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function orderCorners(hull: Point2D[]): [Point2D, Point2D, Point2D, Point2D] {
	let tl = hull[0];
	let tr = hull[0];
	let br = hull[0];
	let bl = hull[0];
	let minSum = Infinity;
	let maxSum = -Infinity;
	let maxDiff = -Infinity;
	let minDiff = Infinity;

	for (const p of hull) {
		const sum = p.x + p.y;
		const diff = p.x - p.y;
		if (sum < minSum) { minSum = sum; tl = p; }
		if (sum > maxSum) { maxSum = sum; br = p; }
		if (diff > maxDiff) { maxDiff = diff; tr = p; }
		if (diff < minDiff) { minDiff = diff; bl = p; }
	}

	return [tl, tr, br, bl];
}

function solveHomography(
	src: [Point2D, Point2D, Point2D, Point2D],
	dst: [Point2D, Point2D, Point2D, Point2D],
): number[] | null {
	const n = 8;
	const aug: number[][] = [];

	for (let i = 0; i < 4; i++) {
		const u = dst[i].x;
		const v = dst[i].y;
		const sx = src[i].x;
		const sy = src[i].y;
		aug.push([u, v, 1, 0, 0, 0, -u * sx, -v * sx, sx]);
		aug.push([0, 0, 0, u, v, 1, -u * sy, -v * sy, sy]);
	}

	for (let col = 0; col < n; col++) {
		let maxRow = col;
		let maxVal = Math.abs(aug[col][col]);
		for (let row = col + 1; row < n; row++) {
			const val = Math.abs(aug[row][col]);
			if (val > maxVal) { maxVal = val; maxRow = row; }
		}
		if (maxVal < 1e-10) return null;
		[aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

		for (let row = col + 1; row < n; row++) {
			const factor = aug[row][col] / aug[col][col];
			for (let j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
		}
	}

	const h = new Array<number>(n);
	for (let row = n - 1; row >= 0; row--) {
		h[row] = aug[row][n];
		for (let col = row + 1; col < n; col++) h[row] -= aug[row][col] * h[col];
		h[row] /= aug[row][row];
	}

	return h;
}

function detectPaperCorners(img: HTMLImageElement): [Point2D, Point2D, Point2D, Point2D] | null {
	const MAX_DIM = 2048;
	const scale = Math.min(MAX_DIM / img.naturalWidth, MAX_DIM / img.naturalHeight, 1);
	const sw = Math.round(img.naturalWidth * scale);
	const sh = Math.round(img.naturalHeight * scale);

	const canvas = document.createElement('canvas');
	canvas.width = sw;
	canvas.height = sh;
	const canvasCtx = canvas.getContext('2d')!;
	canvasCtx.drawImage(img, 0, 0, sw, sh);

	const imageData = canvasCtx.getImageData(0, 0, sw, sh);
	const data = imageData.data;
	const totalPixels = sw * sh;

	const gray = new Uint8Array(totalPixels);
	for (let i = 0; i < totalPixels; i++) {
		const idx = i * 4;
		gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
	}

	const threshold = otsuThreshold(gray);

	const binary = new Uint8Array(totalPixels);
	for (let i = 0; i < totalPixels; i++) {
		binary[i] = gray[i] > threshold ? 1 : 0;
	}

	const labels = new Int32Array(totalPixels);
	let nextLabel = 1;
	let largestLabel = 0;
	let largestSize = 0;

	for (let y = 0; y < sh; y++) {
		for (let x = 0; x < sw; x++) {
			const idx = y * sw + x;
			if (binary[idx] !== 1 || labels[idx] !== 0) continue;

			const label = nextLabel++;
			const queue = [idx];
			labels[idx] = label;
			let count = 0;

			while (queue.length > 0) {
				const ci = queue.pop()!;
				count++;
				const cx = ci % sw;
				const cy = (ci - cx) / sw;

				if (cx > 0 && binary[ci - 1] === 1 && labels[ci - 1] === 0) { labels[ci - 1] = label; queue.push(ci - 1); }
				if (cx < sw - 1 && binary[ci + 1] === 1 && labels[ci + 1] === 0) { labels[ci + 1] = label; queue.push(ci + 1); }
				if (cy > 0 && binary[ci - sw] === 1 && labels[ci - sw] === 0) { labels[ci - sw] = label; queue.push(ci - sw); }
				if (cy < sh - 1 && binary[ci + sw] === 1 && labels[ci + sw] === 0) { labels[ci + sw] = label; queue.push(ci + sw); }
			}

			if (count > largestSize) {
				largestSize = count;
				largestLabel = label;
			}
		}
	}

	if (largestLabel === 0) return null;
	const coverageRatio = largestSize / totalPixels;
	if (coverageRatio > 0.9 || coverageRatio < 0.1) return null;

	const contourPoints: Point2D[] = [];
	for (let y = 0; y < sh; y++) {
		let leftmost = -1;
		let rightmost = -1;
		for (let x = 0; x < sw; x++) {
			if (labels[y * sw + x] === largestLabel) {
				if (leftmost === -1) leftmost = x;
				rightmost = x;
			}
		}
		if (leftmost !== -1) {
			contourPoints.push({ x: leftmost, y });
			if (rightmost !== leftmost) contourPoints.push({ x: rightmost, y });
		}
	}

	if (contourPoints.length < 4) return null;

	const hull = convexHull(contourPoints);
	if (hull.length < 4) return null;

	const [tl, tr, br, bl] = orderCorners(hull);

	return [
		{ x: tl.x / scale, y: tl.y / scale },
		{ x: tr.x / scale, y: tr.y / scale },
		{ x: br.x / scale, y: br.y / scale },
		{ x: bl.x / scale, y: bl.y / scale },
	];
}

function buildGrayFromWarp(
	img: HTMLImageElement,
	corners: [Point2D, Point2D, Point2D, Point2D],
	drawWidth: number,
	drawHeight: number,
): Float32Array | null {
	const dstCorners: [Point2D, Point2D, Point2D, Point2D] = [
		{ x: 0, y: 0 },
		{ x: drawWidth - 1, y: 0 },
		{ x: drawWidth - 1, y: drawHeight - 1 },
		{ x: 0, y: drawHeight - 1 },
	];
	const H = solveHomography(corners, dstCorners);
	if (!H) return null;

	const srcCanvas = document.createElement('canvas');
	srcCanvas.width = img.naturalWidth;
	srcCanvas.height = img.naturalHeight;
	const srcCtx = srcCanvas.getContext('2d')!;
	srcCtx.drawImage(img, 0, 0);
	const srcData = srcCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
	const srcPixels = srcData.data;
	const srcW = img.naturalWidth;
	const srcH = img.naturalHeight;

	const gray = new Float32Array(drawWidth * drawHeight);

	for (let dy = 0; dy < drawHeight; dy++) {
		for (let dx = 0; dx < drawWidth; dx++) {
			const denom = H[6] * dx + H[7] * dy + 1;
			const sx = (H[0] * dx + H[1] * dy + H[2]) / denom;
			const sy = (H[3] * dx + H[4] * dy + H[5]) / denom;

			if (sx < 0 || sx >= srcW - 1 || sy < 0 || sy >= srcH - 1) {
				gray[dy * drawWidth + dx] = 255;
				continue;
			}

			const x0 = Math.floor(sx);
			const y0 = Math.floor(sy);
			const fx = sx - x0;
			const fy = sy - y0;

			const i00 = (y0 * srcW + x0) * 4;
			const i10 = i00 + 4;
			const i01 = ((y0 + 1) * srcW + x0) * 4;
			const i11 = i01 + 4;

			const w00 = (1 - fx) * (1 - fy);
			const w10 = fx * (1 - fy);
			const w01 = (1 - fx) * fy;
			const w11 = fx * fy;

			const r = srcPixels[i00] * w00 + srcPixels[i10] * w10 + srcPixels[i01] * w01 + srcPixels[i11] * w11;
			const g = srcPixels[i00 + 1] * w00 + srcPixels[i10 + 1] * w10 + srcPixels[i01 + 1] * w01 + srcPixels[i11 + 1] * w11;
			const b = srcPixels[i00 + 2] * w00 + srcPixels[i10 + 2] * w10 + srcPixels[i01 + 2] * w01 + srcPixels[i11 + 2] * w11;

			gray[dy * drawWidth + dx] = 0.299 * r + 0.587 * g + 0.114 * b;
		}
	}

	return gray;
}

function buildGrayFromImage(
	img: HTMLImageElement,
	drawWidth: number,
	drawHeight: number,
): Float32Array {
	const offscreen = document.createElement('canvas');
	offscreen.width = drawWidth;
	offscreen.height = drawHeight;
	const offCtx = offscreen.getContext('2d')!;
	offCtx.drawImage(img, 0, 0, drawWidth, drawHeight);

	const src = offCtx.getImageData(0, 0, drawWidth, drawHeight);
	const pixels = src.data;
	const totalPixels = drawWidth * drawHeight;

	const gray = new Float32Array(totalPixels);
	for (let i = 0; i < totalPixels; i++) {
		const idx = i * 4;
		gray[i] = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
	}
	return gray;
}

export function extractLines(
	img: HTMLImageElement,
	canvasWidth: number,
	canvasHeight: number,
): ExtractResult {
	const corners = detectPaperCorners(img);

	let drawWidth: number;
	let drawHeight: number;
	let offsetX: number;
	let offsetY: number;
	let gray: Float32Array;

	if (corners) {
		const [tl, tr, br, bl] = corners;
		const paperW = Math.max(pointDist(tl, tr), pointDist(bl, br));
		const paperH = Math.max(pointDist(tl, bl), pointDist(tr, br));

		const fitScale = Math.min(canvasWidth / paperW, canvasHeight / paperH);
		drawWidth = Math.round(paperW * fitScale);
		drawHeight = Math.round(paperH * fitScale);
		offsetX = Math.round((canvasWidth - drawWidth) / 2);
		offsetY = Math.round((canvasHeight - drawHeight) / 2);

		const warped = buildGrayFromWarp(img, corners, drawWidth, drawHeight);
		if (warped) {
			gray = warped;
		} else {
			gray = buildGrayFromImage(img, drawWidth, drawHeight);
		}
	} else {
		const fitScale = Math.min(canvasWidth / img.naturalWidth, canvasHeight / img.naturalHeight);
		drawWidth = Math.round(img.naturalWidth * fitScale);
		drawHeight = Math.round(img.naturalHeight * fitScale);
		offsetX = Math.round((canvasWidth - drawWidth) / 2);
		offsetY = Math.round((canvasHeight - drawHeight) / 2);

		gray = buildGrayFromImage(img, drawWidth, drawHeight);
	}

	const w = drawWidth;
	const h = drawHeight;
	const totalPixels = w * h;

	const integral = new Float64Array(totalPixels);
	for (let y = 0; y < h; y++) {
		let rowSum = 0;
		for (let x = 0; x < w; x++) {
			rowSum += gray[y * w + x];
			integral[y * w + x] = rowSum + (y > 0 ? integral[(y - 1) * w + x] : 0);
		}
	}

	const windowSize = Math.max(3, Math.round(w / 8));
	const halfWindow = Math.floor(windowSize / 2);
	const sensitivity = 0.05;

	const output = new ImageData(canvasWidth, canvasHeight);
	const out = output.data;

	for (let y = 0; y < h; y++) {
		const y1 = Math.max(0, y - halfWindow);
		const y2 = Math.min(h - 1, y + halfWindow);

		for (let x = 0; x < w; x++) {
			const x1 = Math.max(0, x - halfWindow);
			const x2 = Math.min(w - 1, x + halfWindow);

			const count = (x2 - x1 + 1) * (y2 - y1 + 1);
			let sum = integral[y2 * w + x2];
			if (x1 > 0) sum -= integral[y2 * w + (x1 - 1)];
			if (y1 > 0) sum -= integral[(y1 - 1) * w + x2];
			if (x1 > 0 && y1 > 0) sum += integral[(y1 - 1) * w + (x1 - 1)];

			const localMean = sum / count;
			const threshold = localMean * (1 - sensitivity);
			const pixelGray = gray[y * w + x];

			if (pixelGray < threshold) {
				const outIdx = ((y + offsetY) * canvasWidth + (x + offsetX)) * 4;
				const alpha = Math.round(255 * (1 - pixelGray / localMean));
				out[outIdx] = 0;
				out[outIdx + 1] = 0;
				out[outIdx + 2] = 0;
				out[outIdx + 3] = Math.min(255, alpha);
			}
		}
	}

	return { imageData: output, offsetX, offsetY, drawWidth, drawHeight };
}
