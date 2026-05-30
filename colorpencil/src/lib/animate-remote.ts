const ANIMATOR_URL = 'http://127.0.0.1:8765';
const HEALTH_TIMEOUT = 1200;

export interface AnimatorInfo {
	device: string;
	backends: string[];
}

export interface RemoteAnimation {
	frames: ImageBitmap[];
	fps: number;
}

export interface DetectedFigure {
	bbox: [number, number, number, number];
	score: number;
}

export async function detectFigures(image: string): Promise<DetectedFigure[]> {
	const response = await fetch(`${ANIMATOR_URL}/detect`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ image }),
	});
	if (!response.ok) throw new Error('Detection request failed');
	const data = await response.json();
	return data.figures;
}

export async function probeAnimator(): Promise<AnimatorInfo | null> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT);
		const response = await fetch(`${ANIMATOR_URL}/health`, { signal: controller.signal });
		clearTimeout(timer);
		if (!response.ok) return null;
		const data = await response.json();
		return { device: data.device, backends: data.backends };
	} catch {
		return null;
	}
}

export async function requestAnimation(
	figure: string,
	motion: string,
	backend: string,
	fps: number,
	frameCount: number,
): Promise<RemoteAnimation> {
	const response = await fetch(`${ANIMATOR_URL}/animate`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ keyframes: [figure], motion, backend, fps, frame_count: frameCount, loop: true }),
	});
	if (!response.ok) throw new Error('Animation request failed');

	const data = await response.json();
	const frames: ImageBitmap[] = [];
	for (const encoded of data.frames as string[]) {
		const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
		const blob = new Blob([bytes], { type: 'image/png' });
		frames.push(await createImageBitmap(blob));
	}
	return { frames, fps: data.fps };
}
