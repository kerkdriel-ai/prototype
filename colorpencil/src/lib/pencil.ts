export interface Point {
	x: number;
	y: number;
	pressure: number;
	tiltX: number;
	tiltY: number;
	timestamp: number;
}

export interface PencilOptions {
	color: string;
	minWidth: number;
	maxWidth: number;
	minOpacity: number;
	maxOpacity: number;
	grainDensity: number;
	softness: number;
}

export const DEFAULT_OPTIONS: PencilOptions = {
	color: '#00308F',
	minWidth: 1,
	maxWidth: 3,
	minOpacity: 0.08,
	maxOpacity: 0.6,
	grainDensity: 0.6,
	softness: 3,
};

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function catmullRomPoint(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	t: number,
	alpha: number = 0.5,
): { x: number; y: number; pressure: number } {
	function getT(ti: number, pi: Point, pj: Point): number {
		const dx = pj.x - pi.x;
		const dy = pj.y - pi.y;
		const d = Math.pow(dx * dx + dy * dy, alpha / 2);
		return ti + d;
	}

	const t0 = 0;
	const t1 = getT(t0, p0, p1);
	const t2 = getT(t1, p1, p2);
	const t3 = getT(t2, p2, p3);

	const tt = lerp(t1, t2, t);

	const a1x = ((t1 - tt) / (t1 - t0)) * p0.x + ((tt - t0) / (t1 - t0)) * p1.x;
	const a1y = ((t1 - tt) / (t1 - t0)) * p0.y + ((tt - t0) / (t1 - t0)) * p1.y;
	const a2x = ((t2 - tt) / (t2 - t1)) * p1.x + ((tt - t1) / (t2 - t1)) * p2.x;
	const a2y = ((t2 - tt) / (t2 - t1)) * p1.y + ((tt - t1) / (t2 - t1)) * p2.y;
	const a3x = ((t3 - tt) / (t3 - t2)) * p2.x + ((tt - t2) / (t3 - t2)) * p3.x;
	const a3y = ((t3 - tt) / (t3 - t2)) * p2.y + ((tt - t2) / (t3 - t2)) * p3.y;

	const b1x = ((t2 - tt) / (t2 - t0)) * a1x + ((tt - t0) / (t2 - t0)) * a2x;
	const b1y = ((t2 - tt) / (t2 - t0)) * a1y + ((tt - t0) / (t2 - t0)) * a2y;
	const b2x = ((t3 - tt) / (t3 - t1)) * a2x + ((tt - t1) / (t3 - t1)) * a3x;
	const b2y = ((t3 - tt) / (t3 - t1)) * a2y + ((tt - t1) / (t3 - t1)) * a3y;

	const cx = ((t2 - tt) / (t2 - t1)) * b1x + ((tt - t1) / (t2 - t1)) * b2x;
	const cy = ((t2 - tt) / (t2 - t1)) * b1y + ((tt - t1) / (t2 - t1)) * b2y;

	const pressure = lerp(p1.pressure, p2.pressure, t);

	return { x: cx, y: cy, pressure };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if (!result) return { r: 0, g: 0, b: 0 };
	return {
		r: parseInt(result[1], 16),
		g: parseInt(result[2], 16),
		b: parseInt(result[3], 16),
	};
}

function seededRandom(seed: number): number {
	const x = Math.sin(seed * 127.1 + seed * 311.7) * 43758.5453;
	return x - Math.floor(x);
}

export function drawPencilSegment(
	ctx: CanvasRenderingContext2D,
	from: { x: number; y: number; pressure: number },
	to: { x: number; y: number; pressure: number },
	options: PencilOptions,
): void {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const dist = Math.sqrt(dx * dx + dy * dy);

	if (dist < 0.5) return;

	const { r, g, b } = hexToRgb(options.color);
	const steps = Math.max(1, Math.ceil(dist));

	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const x = lerp(from.x, to.x, t);
		const y = lerp(from.y, to.y, t);
		const pressure = lerp(from.pressure, to.pressure, t);

		const width = lerp(options.minWidth, options.maxWidth, pressure);
		const baseOpacity = lerp(options.minOpacity, options.maxOpacity, pressure);

		const perpX = -dy / dist;
		const perpY = dx / dist;

		const grainLines = Math.ceil(options.softness * (0.5 + pressure * 0.5));
		for (let j = 0; j < grainLines; j++) {
			const seed = x * 1000 + y * 7 + j * 13;
			const rand = seededRandom(seed);

			if (rand > options.grainDensity) continue;

			const offset = (seededRandom(seed + 1) - 0.5) * width;
			const gx = x + perpX * offset;
			const gy = y + perpY * offset;

			const grainOpacity = baseOpacity * (0.3 + seededRandom(seed + 2) * 0.7);
			const grainSize = 0.5 + seededRandom(seed + 3) * 1.0;

			ctx.beginPath();
			ctx.arc(gx, gy, grainSize, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${r},${g},${b},${grainOpacity})`;
			ctx.fill();
		}
	}
}

export function drawStroke(
	ctx: CanvasRenderingContext2D,
	points: Point[],
	options: PencilOptions,
): void {
	if (points.length < 2) return;

	if (points.length === 2) {
		drawPencilSegment(ctx, points[0], points[1], options);
		return;
	}

	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[Math.max(0, i - 1)];
		const p1 = points[i];
		const p2 = points[Math.min(points.length - 1, i + 1)];
		const p3 = points[Math.min(points.length - 1, i + 2)];

		const segDx = p2.x - p1.x;
		const segDy = p2.y - p1.y;
		const segDist = Math.sqrt(segDx * segDx + segDy * segDy);
		const subdivisions = Math.max(1, Math.ceil(segDist / 2));

		let prev = { x: p1.x, y: p1.y, pressure: p1.pressure };

		for (let s = 1; s <= subdivisions; s++) {
			const t = s / subdivisions;
			const current = catmullRomPoint(p0, p1, p2, p3, t);
			drawPencilSegment(ctx, prev, current, options);
			prev = current;
		}
	}
}

export function fillPencilSwatch(
	ctx: CanvasRenderingContext2D,
	size: number,
	color: string,
): void {
	const { r, g, b } = hexToRgb(color);
	const center = size / 2;
	const radius = center - 1;

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = x - center;
			const dy = y - center;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist > radius) continue;

			const seed = x * 127 + y * 311;
			const rand = seededRandom(seed);

			if (rand < 0.25) continue;

			const edgeFade = 1 - Math.pow(dist / radius, 3);
			const opacity = (0.35 + rand * 0.45) * edgeFade;

			const jitterSeed = seed + 7;
			const jx = x + (seededRandom(jitterSeed) - 0.5) * 0.8;
			const jy = y + (seededRandom(jitterSeed + 3) - 0.5) * 0.8;
			const dotSize = 0.4 + seededRandom(seed + 5) * 0.6;

			ctx.beginPath();
			ctx.arc(jx, jy, dotSize, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`;
			ctx.fill();
		}
	}
}

export function createPaperTexture(
	canvas: HTMLCanvasElement,
	ctx: CanvasRenderingContext2D,
): void {
	ctx.fillStyle = '#F5F0E8';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const data = imageData.data;

	for (let i = 0; i < data.length; i += 4) {
		const noise = (Math.random() - 0.5) * 8;
		data[i] = Math.min(255, Math.max(0, data[i] + noise));
		data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
		data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
	}

	ctx.putImageData(imageData, 0, 0);
}
