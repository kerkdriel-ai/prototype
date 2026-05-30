<script lang="ts">
	import { selectInkComponent, computeInkThreshold } from '$lib/segment';
	import type { SamSegmenter } from '$lib/segment-sam';
	import { makeCutOut, type CutOut, type BBox } from '$lib/cutout';
	import { LIFELIKE_MOTIONS } from '$lib/animation';
	import { probeAnimator, requestAnimation, detectFigures, type AnimatorInfo } from '$lib/animate-remote';

	let { source, onClose }: { source: HTMLCanvasElement; onClose: () => void } = $props();

	let bgCanvas: HTMLCanvasElement;
	let cutoutCanvas: HTMLCanvasElement;
	let overlayCanvas: HTMLCanvasElement;

	let bgCtx: CanvasRenderingContext2D;
	let cutoutCtx: CanvasRenderingContext2D;
	let overlayCtx: CanvasRenderingContext2D;

	let sourceData: ImageData | null = null;
	let sourceBitmap: ImageBitmap | null = null;
	let inkThreshold = 128;
	let dpr = 1;
	let rafId: number | null = null;
	let startTime = 0;
	let nextId = 0;
	let restored = false;
	let pendingScene: Array<{ bbox: BBox; name: string; motion?: string; phase?: number; hidden?: boolean }> = [];

	let cutOuts = $state<CutOut[]>([]);
	let selectedId = $state<string | null>(null);
	let tool = $state<'tap' | 'ai' | 'box'>('tap');

	let samSegmenter: SamSegmenter | null = null;
	let samStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');

	let animatorInfo = $state<AnimatorInfo | null>(null);
	let aiBusyId = $state<string | null>(null);
	let sceneMotion = $state('jump');
	let sceneStatus = $state<string | null>(null);

	const selectedCut = $derived(cutOuts.find((cut) => cut.id === selectedId) ?? null);
	const lifelikeAvailable = $derived(animatorInfo?.backends.includes('animated_drawings') ?? false);

	let pointerDownX = 0;
	let pointerDownY = 0;
	let boxDragging = false;
	let dragStartX = 0;
	let dragStartY = 0;
	let dragCurrentX = 0;
	let dragCurrentY = 0;

	function eventToCanvas(e: PointerEvent) {
		const rect = overlayCanvas.getBoundingClientRect();
		return {
			x: Math.round(((e.clientX - rect.left) * overlayCanvas.width) / rect.width),
			y: Math.round(((e.clientY - rect.top) * overlayCanvas.height) / rect.height),
		};
	}

	function drawBackground() {
		if (!bgCtx) return;
		bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
		bgCtx.fillStyle = '#ffffff';
		bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
		if (sourceBitmap) {
			bgCtx.globalAlpha = 0.4;
			bgCtx.drawImage(sourceBitmap, 0, 0);
			bgCtx.globalAlpha = 1;
		}
		for (const cut of cutOuts) {
			if (!cut.hidden && cut.frames && cut.frames.length > 0) {
				bgCtx.clearRect(cut.bbox.x, cut.bbox.y, cut.bbox.w, cut.bbox.h);
			}
		}
	}

	function renderCutouts(time: number) {
		if (!cutoutCtx) return;
		cutoutCtx.clearRect(0, 0, cutoutCanvas.width, cutoutCanvas.height);
		for (const cut of cutOuts) {
			if (cut.hidden) continue;
			if (cut.frames && cut.frames.length > 0) {
				const fps = cut.fps ?? 12;
				const frame = cut.frames[(Math.floor(time * fps) + (cut.phase ?? 0)) % cut.frames.length];
				const scale = cut.bbox.w / frame.width;
				const drawHeight = frame.height * scale;
				cutoutCtx.drawImage(
					frame,
					cut.bbox.x,
					cut.bbox.y + cut.bbox.h - drawHeight,
					cut.bbox.w,
					drawHeight,
				);
				continue;
			}
			cutoutCtx.drawImage(cut.bitmap, cut.bbox.x, cut.bbox.y);
		}
	}

	function normalizedDragRect(): BBox {
		return {
			x: Math.min(dragStartX, dragCurrentX),
			y: Math.min(dragStartY, dragCurrentY),
			w: Math.abs(dragCurrentX - dragStartX),
			h: Math.abs(dragCurrentY - dragStartY),
		};
	}

	function renderOverlay() {
		if (!overlayCtx) return;
		overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
		overlayCtx.lineWidth = 2 * dpr;

		if (boxDragging) {
			const rect = normalizedDragRect();
			overlayCtx.strokeStyle = 'rgba(60,120,220,0.9)';
			overlayCtx.setLineDash([8 * dpr, 6 * dpr]);
			overlayCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
			overlayCtx.setLineDash([]);
		}

		if (selectedCut) {
			overlayCtx.strokeStyle = 'rgba(255,160,0,0.95)';
			overlayCtx.setLineDash([6 * dpr, 5 * dpr]);
			overlayCtx.strokeRect(selectedCut.bbox.x, selectedCut.bbox.y, selectedCut.bbox.w, selectedCut.bbox.h);
			overlayCtx.setLineDash([]);
		}
	}

	function loop() {
		const time = (performance.now() - startTime) / 1000;
		drawBackground();
		renderCutouts(time);
		renderOverlay();
		rafId = requestAnimationFrame(loop);
	}

	async function createCutOut(mask: Uint8Array | null, bbox: BBox): Promise<string | null> {
		if (!sourceData) return null;
		const bitmap = await makeCutOut(sourceData, mask, bbox, inkThreshold);
		const id = `cut-${nextId++}`;
		cutOuts = [...cutOuts, { id, name: `Figuur ${nextId}`, bitmap, bbox, hidden: false }];
		selectedId = id;
		return id;
	}

	async function ensureSam() {
		if (samStatus === 'loading' || samStatus === 'ready') return;
		samStatus = 'loading';
		try {
			const { createSamSegmenter } = await import('$lib/segment-sam');
			samSegmenter = await createSamSegmenter();
			if (sourceData) await samSegmenter.setImage(sourceData);
			samStatus = 'ready';
		} catch {
			samStatus = 'error';
		}
	}

	function selectAiTool() {
		tool = 'ai';
		void ensureSam();
	}

	async function tapAt(x: number, y: number) {
		if (!sourceData) return;
		if (tool === 'ai') {
			if (!samSegmenter || samStatus !== 'ready') return;
			const region = await samSegmenter.segmentAt(x, y);
			if (region) await createCutOut(region.mask, region.bbox);
			return;
		}
		const region = selectInkComponent(sourceData, x, y, inkThreshold);
		if (region) await createCutOut(region.mask, region.bbox);
	}

	function onPointerDown(e: PointerEvent) {
		overlayCanvas.setPointerCapture(e.pointerId);
		const point = eventToCanvas(e);
		pointerDownX = point.x;
		pointerDownY = point.y;
		if (tool === 'box') {
			boxDragging = true;
			dragStartX = point.x;
			dragStartY = point.y;
			dragCurrentX = point.x;
			dragCurrentY = point.y;
		}
	}

	function onPointerMove(e: PointerEvent) {
		if (!boxDragging) return;
		const point = eventToCanvas(e);
		dragCurrentX = point.x;
		dragCurrentY = point.y;
	}

	function onPointerUp(e: PointerEvent) {
		const point = eventToCanvas(e);
		if (tool === 'box' && boxDragging) {
			boxDragging = false;
			const rect = normalizedDragRect();
			if (rect.w > 8 && rect.h > 8) void createCutOut(null, rect);
			return;
		}
		const dx = point.x - pointerDownX;
		const dy = point.y - pointerDownY;
		if (dx * dx + dy * dy < 100) void tapAt(point.x, point.y);
	}

	function deleteCutOut(id: string) {
		const cut = cutOuts.find((c) => c.id === id);
		cut?.bitmap.close();
		if (cut?.frames) for (const frame of cut.frames) frame.close();
		cutOuts = cutOuts.filter((c) => c.id !== id);
		if (selectedId === id) selectedId = null;
	}

	async function cutoutToBase64(cut: CutOut): Promise<string> {
		const canvas = new OffscreenCanvas(cut.bbox.w, cut.bbox.h);
		canvas.getContext('2d')!.drawImage(cut.bitmap, 0, 0);
		const blob = await canvas.convertToBlob({ type: 'image/png' });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let binary = '';
		for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}

	async function playLifelike(cut: CutOut, motion: string) {
		const backend = lifelikeAvailable ? 'animated_drawings' : 'stub';
		aiBusyId = cut.id;
		try {
			const figure = await cutoutToBase64(cut);
			const animation = await requestAnimation(figure, motion, backend, 12, 24);
			if (cut.frames) for (const frame of cut.frames) frame.close();
			cut.frames = animation.frames;
			cut.fps = animation.fps;
			cut.motion = motion;
		} catch {
			cut.motion = undefined;
		} finally {
			aiBusyId = null;
		}
	}

	async function sourceToBase64(): Promise<string> {
		const canvas = new OffscreenCanvas(sourceData!.width, sourceData!.height);
		const context = canvas.getContext('2d')!;
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, canvas.width, canvas.height);
		if (sourceBitmap) context.drawImage(sourceBitmap, 0, 0);
		const blob = await canvas.convertToBlob({ type: 'image/png' });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let binary = '';
		for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}

	function sceneKey(): string {
		if (!sourceData) return 'colorpencil-scene';
		const data = sourceData.data;
		let hash = (sourceData.width * 73856093) ^ (sourceData.height * 19349663);
		const step = Math.max(4, Math.floor(data.length / 4000) * 4);
		for (let i = 3; i < data.length; i += step) hash = (hash * 31 + data[i]) | 0;
		return 'colorpencil-scene-' + (hash >>> 0).toString(36);
	}

	async function restoreScene() {
		for (const entry of pendingScene) {
			const id = await createCutOut(null, entry.bbox);
			if (!id) continue;
			const cut = cutOuts.find((c) => c.id === id);
			if (!cut) continue;
			cut.name = entry.name;
			cut.hidden = entry.hidden ?? false;
			if (entry.motion && animatorInfo) {
				await playLifelike(cut, entry.motion);
				if (cut.frames) cut.phase = entry.phase ?? 0;
			}
		}
		selectedId = null;
		restored = true;
	}

	async function bringSceneToLife() {
		if (!sourceData || sceneStatus) return;
		sceneStatus = 'Figuren zoeken…';
		try {
			const figures = await detectFigures(await sourceToBase64());
			if (figures.length === 0) {
				sceneStatus = 'Geen figuren gevonden';
				setTimeout(() => (sceneStatus = null), 2500);
				return;
			}
			const ids: string[] = [];
			for (const figure of figures) {
				const [left, top, right, bottom] = figure.bbox;
				const id = await createCutOut(null, { x: left, y: top, w: right - left, h: bottom - top });
				if (id) ids.push(id);
			}
			for (let i = 0; i < ids.length; i++) {
				sceneStatus = `Figuur ${i + 1}/${ids.length} animeren…`;
				const cut = cutOuts.find((c) => c.id === ids[i]);
				if (!cut) continue;
				await playLifelike(cut, sceneMotion);
				if (cut.frames) cut.phase = Math.round((i / ids.length) * cut.frames.length);
			}
			selectedId = null;
		} catch {
			sceneStatus = 'Scène-animatie mislukt';
			setTimeout(() => (sceneStatus = null), 2500);
		} finally {
			if (sceneStatus === 'Figuren zoeken…' || sceneStatus?.startsWith('Figuur ')) sceneStatus = null;
		}
	}

	$effect(() => {
		dpr = window.devicePixelRatio || 1;
		const width = source.width;
		const height = source.height;
		const cssWidth = window.innerWidth;
		const cssHeight = window.innerHeight;

		for (const canvas of [bgCanvas, cutoutCanvas, overlayCanvas]) {
			canvas.width = width;
			canvas.height = height;
			canvas.style.width = cssWidth + 'px';
			canvas.style.height = cssHeight + 'px';
		}

		bgCtx = bgCanvas.getContext('2d')!;
		cutoutCtx = cutoutCanvas.getContext('2d')!;
		overlayCtx = overlayCanvas.getContext('2d')!;

		sourceData = source.getContext('2d')!.getImageData(0, 0, width, height);
		inkThreshold = computeInkThreshold(sourceData);

		try {
			pendingScene = JSON.parse(localStorage.getItem(sceneKey()) || '[]');
		} catch {
			pendingScene = [];
		}

		let active = true;
		createImageBitmap(sourceData).then((bitmap) => {
			if (!active) {
				bitmap.close();
				return;
			}
			sourceBitmap = bitmap;
			drawBackground();
		});

		void probeAnimator().then((info) => {
			animatorInfo = info;
			void restoreScene();
		});

		startTime = performance.now();
		rafId = requestAnimationFrame(loop);

		return () => {
			active = false;
			if (rafId) cancelAnimationFrame(rafId);
			sourceBitmap?.close();
			for (const cut of cutOuts) {
				cut.bitmap.close();
				if (cut.frames) for (const frame of cut.frames) frame.close();
			}
		};
	});

	$effect(() => {
		const snapshot = cutOuts.map((cut) => ({
			bbox: cut.bbox,
			name: cut.name,
			motion: cut.motion,
			phase: cut.phase,
			hidden: cut.hidden,
		}));
		if (!restored || !sourceData) return;
		try {
			localStorage.setItem(sceneKey(), JSON.stringify(snapshot));
		} catch {}
	});
</script>

<div class="magic-root">
	<canvas bind:this={bgCanvas} class="magic-layer"></canvas>
	<canvas bind:this={cutoutCanvas} class="magic-layer"></canvas>
	<canvas
		bind:this={overlayCanvas}
		class="magic-layer"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		oncontextmenu={(e) => e.preventDefault()}
		style="touch-action: none;"
	></canvas>

	<div class="magic-hint">
		{#if sceneStatus}
			{sceneStatus}
		{:else if tool === 'box'}
			Sleep een kader rond een element
		{:else if tool === 'ai'}
			{samStatus === 'loading'
				? 'AI-model laden…'
				: samStatus === 'error'
					? 'AI niet beschikbaar, gebruik Tik of Kader'
					: 'Tik nauwkeurig op een figuur'}
		{:else}
			Tik op een figuur om het uit te knippen
		{/if}
	</div>

	<div class="magic-bar">
		<span class="bar-label">Uitknippen:</span>
		<button class="pill" class:active={tool === 'tap'} onclick={() => (tool = 'tap')}>Tik</button>
		<button class="pill" class:active={tool === 'ai'} onclick={selectAiTool}>
			AI{samStatus === 'loading' ? ' …' : ''}
		</button>
		<button class="pill" class:active={tool === 'box'} onclick={() => (tool = 'box')}>Kader</button>
		{#if animatorInfo}
			<span class="bar-sep"></span>
			<select class="pill" bind:value={sceneMotion} aria-label="Scène-beweging">
				{#each LIFELIKE_MOTIONS as motion}
					<option value={motion.id}>{motion.icon} {motion.label}</option>
				{/each}
			</select>
			<button class="pill scene" onclick={bringSceneToLife} disabled={!!sceneStatus}>
				✨ Hele tekening
			</button>
		{/if}
		<button class="pill close" onclick={onClose}>Klaar</button>
	</div>

	<div class="magic-panel">
		<div class="panel-title">Figuren</div>
		{#if cutOuts.length === 0}
			<div class="panel-empty">Tik op een poppetje of dier om te beginnen.</div>
		{/if}
		{#each cutOuts as cut (cut.id)}
			<div class="cut-row" class:selected={cut.id === selectedId}>
				<button class="cut-name-btn" onclick={() => (selectedId = cut.id)} aria-label="Selecteer figuur">
					<input class="cut-name" bind:value={cut.name} onclick={(e) => e.stopPropagation()} />
				</button>
				<button class="cut-icon" onclick={() => (cut.hidden = !cut.hidden)} aria-label="Tonen of verbergen">
					{cut.hidden ? '🙈' : '👁'}
				</button>
				<button class="cut-icon" onclick={() => deleteCutOut(cut.id)} aria-label="Verwijder">🗑</button>
			</div>
		{/each}

		{#if selectedCut}
			<div class="motion-section">
				<div class="panel-title">Beweging</div>
				{#if animatorInfo}
					<div class="motion-grid">
						{#each LIFELIKE_MOTIONS as motion}
							<button
								class="motion-btn"
								class:active={selectedCut.motion === motion.id}
								disabled={aiBusyId === selectedCut.id}
								onclick={() => playLifelike(selectedCut, motion.id)}
							>
								{motion.icon} {motion.label}
							</button>
						{/each}
					</div>
					{#if aiBusyId === selectedCut.id}
						<div class="motion-busy">Animatie maken…</div>
					{:else if !lifelikeAvailable}
						<div class="motion-note">
							Dit is nog een voorbeeld. Zet de AnimatedDrawings-backend aan voor echte beweging.
						</div>
					{/if}
				{:else}
					<div class="motion-note">
						Start de lokale animatie-service (tools/animator) voor lopen, zwaaien, springen en dansen.
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.magic-root {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: #ffffff;
		overflow: hidden;
	}

	.magic-layer {
		position: absolute;
		top: 0;
		left: 0;
		display: block;
	}

	.magic-hint {
		position: fixed;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		padding: 6px 14px;
		background: rgba(255, 255, 255, 0.9);
		backdrop-filter: blur(10px);
		border-radius: 50px;
		box-shadow: 0 2px 20px rgba(0, 0, 0, 0.1);
		font: 13px system-ui, sans-serif;
		color: #555;
		pointer-events: none;
	}

	.magic-bar {
		position: fixed;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		background: rgba(255, 255, 255, 0.9);
		backdrop-filter: blur(10px);
		border-radius: 50px;
		box-shadow: 0 2px 20px rgba(0, 0, 0, 0.1);
	}

	.bar-label {
		font: 13px system-ui, sans-serif;
		color: #888;
	}

	.pill {
		padding: 6px 14px;
		background: #f0f0f0;
		border: none;
		border-radius: 20px;
		cursor: pointer;
		font-size: 13px;
		color: #555;
		transition: background 0.15s ease;
	}

	.pill:hover {
		background: #e0e0e0;
	}

	.pill.active {
		background: #2b2b2b;
		color: #fff;
	}

	.pill.close {
		margin-left: 8px;
		background: #006400;
		color: #fff;
	}

	.pill.scene {
		background: #4b0082;
		color: #fff;
	}

	.bar-sep {
		width: 1px;
		align-self: stretch;
		background: #ddd;
		margin: 0 2px;
	}

	.magic-panel {
		position: fixed;
		top: 16px;
		right: 16px;
		width: 250px;
		max-height: 80vh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px;
		background: rgba(255, 255, 255, 0.94);
		backdrop-filter: blur(10px);
		border-radius: 14px;
		box-shadow: 0 2px 20px rgba(0, 0, 0, 0.12);
		font: 13px system-ui, sans-serif;
	}

	.panel-title {
		font-weight: 600;
		color: #333;
		margin-top: 4px;
	}

	.panel-empty {
		color: #999;
		font-size: 12px;
	}

	.cut-row {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px;
		border-radius: 8px;
	}

	.cut-row.selected {
		background: rgba(255, 160, 0, 0.15);
	}

	.cut-name-btn {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
	}

	.cut-name {
		width: 100%;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		padding: 5px 7px;
		font: 12px system-ui, sans-serif;
	}

	.cut-icon {
		border: none;
		background: none;
		cursor: pointer;
		font-size: 14px;
		padding: 3px;
	}

	.motion-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid #eee;
	}

	.motion-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	.motion-btn {
		padding: 8px 6px;
		background: #f4f4f4;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		font-size: 13px;
		color: #444;
		transition: background 0.15s ease;
	}

	.motion-btn:hover:not(:disabled) {
		background: #e6e6e6;
	}

	.motion-btn.active {
		background: #00308f;
		color: #fff;
	}

	.motion-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.motion-busy {
		font-size: 12px;
		color: #00308f;
	}

	.motion-note {
		font-size: 12px;
		color: #999;
		line-height: 1.4;
	}
</style>
