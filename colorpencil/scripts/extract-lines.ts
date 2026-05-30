import sharp from 'sharp';

interface Point2D { x: number; y: number }

function otsuThreshold(gray: Uint8Array): number {
	const histogram = new Uint32Array(256);
	for (let i = 0; i < gray.length; i++) histogram[gray[i]]++;
	const total = gray.length;
	let sumAll = 0;
	for (let i = 0; i < 256; i++) sumAll += i * histogram[i];
	let sumB = 0, wB = 0, maxVariance = 0, best = 0;
	for (let t = 0; t < 256; t++) {
		wB += histogram[t];
		if (wB === 0) continue;
		const wF = total - wB;
		if (wF === 0) break;
		sumB += t * histogram[t];
		const diff = sumB / wB - (sumAll - sumB) / wF;
		const variance = wB * wF * diff * diff;
		if (variance > maxVariance) { maxVariance = variance; best = t; }
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
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
		lower.push(p);
	}
	const upper: Point2D[] = [];
	for (let i = points.length - 1; i >= 0; i--) {
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], points[i]) <= 0) upper.pop();
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
	let tl = hull[0], tr = hull[0], br = hull[0], bl = hull[0];
	let minSum = Infinity, maxSum = -Infinity, maxDiff = -Infinity, minDiff = Infinity;
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
		const u = dst[i].x, v = dst[i].y, sx = src[i].x, sy = src[i].y;
		aug.push([u, v, 1, 0, 0, 0, -u * sx, -v * sx, sx]);
		aug.push([0, 0, 0, u, v, 1, -u * sy, -v * sy, sy]);
	}
	for (let col = 0; col < n; col++) {
		let maxRow = col, maxVal = Math.abs(aug[col][col]);
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

async function main() {
	const inputPath = process.argv[2];
	const outputPath = process.argv[3] || 'static/default-lineart.png';
	if (!inputPath) { console.error('Usage: bun scripts/extract-lines.ts <input.jpg> [output.png]'); process.exit(1); }

	const img = sharp(inputPath);
	const meta = await img.metadata();
	const srcW = meta.width!;
	const srcH = meta.height!;
	const srcPixels = new Uint8Array(await img.removeAlpha().raw().toBuffer());

	console.log(`Input: ${srcW}x${srcH}`);

	const MAX_DIM = 2048;
	const detScale = Math.min(MAX_DIM / srcW, MAX_DIM / srcH, 1);
	const sw = Math.round(srcW * detScale);
	const sh = Math.round(srcH * detScale);
	const detPixels = new Uint8Array(await img.resize(sw, sh).removeAlpha().raw().toBuffer());

	const totalDet = sw * sh;
	const detGray = new Uint8Array(totalDet);
	for (let i = 0; i < totalDet; i++) {
		const idx = i * 3;
		detGray[i] = Math.round(0.299 * detPixels[idx] + 0.587 * detPixels[idx + 1] + 0.114 * detPixels[idx + 2]);
	}

	const threshold = otsuThreshold(detGray);
	console.log(`Otsu threshold: ${threshold}`);

	const binary = new Uint8Array(totalDet);
	for (let i = 0; i < totalDet; i++) binary[i] = detGray[i] > threshold ? 1 : 0;

	const labels = new Int32Array(totalDet);
	let nextLabel = 1, largestLabel = 0, largestSize = 0;
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
				const cx = ci % sw, cy = (ci - cx) / sw;
				if (cx > 0 && binary[ci - 1] === 1 && labels[ci - 1] === 0) { labels[ci - 1] = label; queue.push(ci - 1); }
				if (cx < sw - 1 && binary[ci + 1] === 1 && labels[ci + 1] === 0) { labels[ci + 1] = label; queue.push(ci + 1); }
				if (cy > 0 && binary[ci - sw] === 1 && labels[ci - sw] === 0) { labels[ci - sw] = label; queue.push(ci - sw); }
				if (cy < sh - 1 && binary[ci + sw] === 1 && labels[ci + sw] === 0) { labels[ci + sw] = label; queue.push(ci + sw); }
			}
			if (count > largestSize) { largestSize = count; largestLabel = label; }
		}
	}

	const coverageRatio = largestSize / totalDet;
	console.log(`Paper coverage: ${(coverageRatio * 100).toFixed(1)}%`);

	let outW: number, outH: number;
	let gray: Float32Array;

	if (largestLabel > 0 && coverageRatio > 0.1 && coverageRatio < 0.9) {
		const contourPoints: Point2D[] = [];
		for (let y = 0; y < sh; y++) {
			let leftmost = -1, rightmost = -1;
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

		const hull = convexHull(contourPoints);
		const corners = orderCorners(hull);
		const srcCorners: [Point2D, Point2D, Point2D, Point2D] = [
			{ x: corners[0].x / detScale, y: corners[0].y / detScale },
			{ x: corners[1].x / detScale, y: corners[1].y / detScale },
			{ x: corners[2].x / detScale, y: corners[2].y / detScale },
			{ x: corners[3].x / detScale, y: corners[3].y / detScale },
		];

		console.log(`Paper corners: ${srcCorners.map(c => `(${Math.round(c.x)},${Math.round(c.y)})`).join(' ')}`);

		const paperW = Math.max(pointDist(srcCorners[0], srcCorners[1]), pointDist(srcCorners[3], srcCorners[2]));
		const paperH = Math.max(pointDist(srcCorners[0], srcCorners[3]), pointDist(srcCorners[1], srcCorners[2]));
		outW = Math.round(paperW);
		outH = Math.round(paperH);

		console.log(`Output: ${outW}x${outH}`);

		const dstCorners: [Point2D, Point2D, Point2D, Point2D] = [
			{ x: 0, y: 0 }, { x: outW - 1, y: 0 },
			{ x: outW - 1, y: outH - 1 }, { x: 0, y: outH - 1 },
		];
		const H = solveHomography(srcCorners, dstCorners);
		if (!H) { console.error('Homography failed'); process.exit(1); }

		gray = new Float32Array(outW * outH);
		for (let dy = 0; dy < outH; dy++) {
			for (let dx = 0; dx < outW; dx++) {
				const denom = H[6] * dx + H[7] * dy + 1;
				const sx = (H[0] * dx + H[1] * dy + H[2]) / denom;
				const sy = (H[3] * dx + H[4] * dy + H[5]) / denom;
				if (sx < 0 || sx >= srcW - 1 || sy < 0 || sy >= srcH - 1) {
					gray[dy * outW + dx] = 255;
					continue;
				}
				const x0 = Math.floor(sx), y0 = Math.floor(sy);
				const fx = sx - x0, fy = sy - y0;
				const i00 = (y0 * srcW + x0) * 3;
				const i10 = i00 + 3;
				const i01 = ((y0 + 1) * srcW + x0) * 3;
				const i11 = i01 + 3;
				const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
				const r = srcPixels[i00] * w00 + srcPixels[i10] * w10 + srcPixels[i01] * w01 + srcPixels[i11] * w11;
				const g = srcPixels[i00 + 1] * w00 + srcPixels[i10 + 1] * w10 + srcPixels[i01 + 1] * w01 + srcPixels[i11 + 1] * w11;
				const b = srcPixels[i00 + 2] * w00 + srcPixels[i10 + 2] * w10 + srcPixels[i01 + 2] * w01 + srcPixels[i11 + 2] * w11;
				gray[dy * outW + dx] = 0.299 * r + 0.587 * g + 0.114 * b;
			}
		}
	} else {
		console.log('No paper detected, using full image');
		outW = srcW;
		outH = srcH;
		gray = new Float32Array(outW * outH);
		for (let i = 0; i < outW * outH; i++) {
			const idx = i * 3;
			gray[i] = 0.299 * srcPixels[idx] + 0.587 * srcPixels[idx + 1] + 0.114 * srcPixels[idx + 2];
		}
	}

	const totalPixels = outW * outH;
	const integral = new Float64Array(totalPixels);
	for (let y = 0; y < outH; y++) {
		let rowSum = 0;
		for (let x = 0; x < outW; x++) {
			rowSum += gray[y * outW + x];
			integral[y * outW + x] = rowSum + (y > 0 ? integral[(y - 1) * outW + x] : 0);
		}
	}

	const windowSize = Math.max(3, Math.round(outW / 8));
	const halfWindow = Math.floor(windowSize / 2);
	const sensitivity = 0.05;

	const output = new Uint8Array(totalPixels * 4);
	for (let y = 0; y < outH; y++) {
		const y1 = Math.max(0, y - halfWindow);
		const y2 = Math.min(outH - 1, y + halfWindow);
		for (let x = 0; x < outW; x++) {
			const x1 = Math.max(0, x - halfWindow);
			const x2 = Math.min(outW - 1, x + halfWindow);
			const count = (x2 - x1 + 1) * (y2 - y1 + 1);
			let sum = integral[y2 * outW + x2];
			if (x1 > 0) sum -= integral[y2 * outW + (x1 - 1)];
			if (y1 > 0) sum -= integral[(y1 - 1) * outW + x2];
			if (x1 > 0 && y1 > 0) sum += integral[(y1 - 1) * outW + (x1 - 1)];
			const localMean = sum / count;
			const thresh = localMean * (1 - sensitivity);
			const pixelGray = gray[y * outW + x];
			if (pixelGray < thresh) {
				const outIdx = (y * outW + x) * 4;
				const alpha = Math.round(255 * (1 - pixelGray / localMean));
				output[outIdx] = 0;
				output[outIdx + 1] = 0;
				output[outIdx + 2] = 0;
				output[outIdx + 3] = Math.min(255, alpha);
			}
		}
	}

	await sharp(Buffer.from(output.buffer), { raw: { width: outW, height: outH, channels: 4 } })
		.png()
		.toFile(outputPath);

	const stats = await Bun.file(outputPath).stat();
	console.log(`Saved: ${outputPath} (${(stats!.size / 1024).toFixed(0)} KB)`);
}

main();
