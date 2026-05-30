<script lang="ts">
	import {
		type Point,
		type PencilOptions,
		DEFAULT_OPTIONS,
		drawPencilSegment,
		fillPencilSwatch,
		createPaperTexture,
	} from '$lib/pencil';
	import { extractLines, type ExtractResult } from '$lib/line-extract';
	import MagicMode from '$lib/MagicMode.svelte';

	let paperCanvas: HTMLCanvasElement;
	let drawingCanvas: HTMLCanvasElement;
	let lineartCanvas: HTMLCanvasElement;
	let paperCtx: CanvasRenderingContext2D;
	let ctx: CanvasRenderingContext2D;
	let lineartCtx: CanvasRenderingContext2D;

	let isDrawing = false;
	let currentStroke: Point[] = [];
	let lastPoint: { x: number; y: number; pressure: number } | null = null;

	let options: PencilOptions = $state({ ...DEFAULT_OPTIONS });

	const PENCIL_COLORS = [
		'#2B2B2B',
		'#8B0000',
		'#00308F',
		'#006400',
		'#FF8C00',
		'#4B0082',
	];

	const SWATCH_SIZE = 32;
	let swatchCanvases: (HTMLCanvasElement | undefined)[] = $state(new Array(PENCIL_COLORS.length));

	let showUI = $state(true);
	let uiTimeout: ReturnType<typeof setTimeout>;

	let hasLineArt = $state(false);
	let lineArtData: ExtractResult | null = null;
	let lineArtImage: HTMLImageElement | null = null;
	let fileInput: HTMLInputElement;
	let mode = $state<'draw' | 'magic'>('draw');
	let magicSource = $state<HTMLCanvasElement | null>(null);

	function enterMagicMode() {
		magicSource = lineartCanvas;
		mode = 'magic';
	}

	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let animatingZoom = false;
	let panFrameId: number | null = null;
	let lastScreenX = 0;
	let lastScreenY = 0;
	let tapStartTime = 0;
	let tapStartX = 0;
	let tapStartY = 0;
	let confirmedDraw = false;

	const ZOOM_LEVEL = 6;
	const TAP_MAX_DURATION = 250;
	const TAP_MAX_DISTANCE = 10;
	const EDGE_MARGIN = 80;
	const PAN_SPEED = 3;

	function clampPan() {
		const w = window.innerWidth;
		const h = window.innerHeight;
		panX = Math.max(-(w - w / zoom), Math.min(0, panX));
		panY = Math.max(-(h - h / zoom), Math.min(0, panY));
	}

	function animateZoom(targetZoom: number, screenCX: number, screenCY: number) {
		if (animatingZoom) return;
		animatingZoom = true;

		const startZoom = zoom;
		const cx = screenCX / startZoom - panX;
		const cy = screenCY / startZoom - panY;

		const startScreenX = screenCX;
		const startScreenY = screenCY;
		let endScreenX: number;
		let endScreenY: number;

		if (targetZoom > 1) {
			const w = window.innerWidth;
			const h = window.innerHeight;
			let tpx = w / 2 / targetZoom - cx;
			let tpy = h / 2 / targetZoom - cy;
			tpx = Math.max(-(w - w / targetZoom), Math.min(0, tpx));
			tpy = Math.max(-(h - h / targetZoom), Math.min(0, tpy));
			endScreenX = (cx + tpx) * targetZoom;
			endScreenY = (cy + tpy) * targetZoom;
		} else {
			endScreenX = cx;
			endScreenY = cy;
		}

		const duration = 300;
		const startTime = performance.now();

		function step(time: number) {
			const t = Math.min(1, (time - startTime) / duration);
			const eased = t * t * (3 - 2 * t);

			zoom = startZoom + (targetZoom - startZoom) * eased;
			const sx = startScreenX + (endScreenX - startScreenX) * eased;
			const sy = startScreenY + (endScreenY - startScreenY) * eased;
			panX = sx / zoom - cx;
			panY = sy / zoom - cy;

			if (t < 1) {
				requestAnimationFrame(step);
			} else {
				if (targetZoom <= 1) { panX = 0; panY = 0; }
				animatingZoom = false;
			}
		}

		requestAnimationFrame(step);
	}

	function edgePanLoop() {
		if (!isDrawing || zoom <= 1) { panFrameId = null; return; }

		const w = window.innerWidth;
		const h = window.innerHeight;
		let dx = 0;
		let dy = 0;

		if (lastScreenX < EDGE_MARGIN)
			dx = (EDGE_MARGIN - lastScreenX) / EDGE_MARGIN * PAN_SPEED / zoom;
		else if (lastScreenX > w - EDGE_MARGIN)
			dx = -(lastScreenX - (w - EDGE_MARGIN)) / EDGE_MARGIN * PAN_SPEED / zoom;

		if (lastScreenY < EDGE_MARGIN)
			dy = (EDGE_MARGIN - lastScreenY) / EDGE_MARGIN * PAN_SPEED / zoom;
		else if (lastScreenY > h - EDGE_MARGIN)
			dy = -(lastScreenY - (h - EDGE_MARGIN)) / EDGE_MARGIN * PAN_SPEED / zoom;

		if ((dx !== 0 || dy !== 0) && confirmedDraw) {
			panX += dx;
			panY += dy;
			clampPan();

			if (lastPoint) {
				const newX = lastScreenX / zoom - panX;
				const newY = lastScreenY / zoom - panY;
				const newPoint = { x: newX, y: newY, pressure: lastPoint.pressure };
				drawPencilSegment(ctx, lastPoint, newPoint, options);
				lastPoint = newPoint;
			}
		}

		panFrameId = requestAnimationFrame(edgePanLoop);
	}

	function setupCanvas() {
		const dpr = window.devicePixelRatio || 1;
		const w = window.innerWidth;
		const h = window.innerHeight;
		const pw = w * dpr;
		const ph = h * dpr;
		const styleW = w + 'px';
		const styleH = h + 'px';

		for (const c of [paperCanvas, drawingCanvas, lineartCanvas]) {
			c.width = pw;
			c.height = ph;
			c.style.width = styleW;
			c.style.height = styleH;
		}

		paperCtx = paperCanvas.getContext('2d')!;
		paperCtx.scale(dpr, dpr);
		createPaperTexture(paperCanvas, paperCtx);

		ctx = drawingCanvas.getContext('2d')!;
		ctx.scale(dpr, dpr);

		lineartCtx = lineartCanvas.getContext('2d')!;
		lineartCtx.scale(dpr, dpr);
	}

	function redrawLineArt() {
		if (!lineArtImage) return;
		lineartCtx.clearRect(0, 0, lineartCanvas.width, lineartCanvas.height);
		const result = extractLines(lineArtImage, lineartCanvas.width, lineartCanvas.height);
		lineArtData = result;
		lineartCtx.putImageData(result.imageData, 0, 0);
	}

	function getPoint(e: PointerEvent): Point {
		return {
			x: e.clientX / zoom - panX,
			y: e.clientY / zoom - panY,
			pressure: e.pressure > 0 ? e.pressure : 0.5,
			tiltX: e.tiltX || 0,
			tiltY: e.tiltY || 0,
			timestamp: e.timeStamp,
		};
	}

	function onPointerDown(e: PointerEvent) {
		if (mode !== 'draw') return;
		if (e.pointerType === 'touch' && e.isPrimary === false) return;
		if (animatingZoom) return;

		flashUI();

		drawingCanvas.setPointerCapture(e.pointerId);
		tapStartTime = performance.now();
		tapStartX = e.clientX;
		tapStartY = e.clientY;
		confirmedDraw = false;
		isDrawing = true;

		const point = getPoint(e);
		currentStroke = [point];
		lastPoint = { x: point.x, y: point.y, pressure: point.pressure };

		lastScreenX = e.clientX;
		lastScreenY = e.clientY;
		panFrameId = requestAnimationFrame(edgePanLoop);
	}

	function onPointerMove(e: PointerEvent) {
		lastScreenX = e.clientX;
		lastScreenY = e.clientY;

		if (!isDrawing || !lastPoint) return;

		if (!confirmedDraw) {
			const dx = e.clientX - tapStartX;
			const dy = e.clientY - tapStartY;
			if (dx * dx + dy * dy < TAP_MAX_DISTANCE * TAP_MAX_DISTANCE) return;
			confirmedDraw = true;
		}

		const coalescedEvents = e.getCoalescedEvents?.() ?? [e];
		for (const ce of coalescedEvents) {
			const point = getPoint(ce);
			currentStroke.push(point);
			const current = { x: point.x, y: point.y, pressure: point.pressure };
			drawPencilSegment(ctx, lastPoint, current, options);
			lastPoint = current;
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (panFrameId) { cancelAnimationFrame(panFrameId); panFrameId = null; }

		if (!isDrawing) return;
		isDrawing = false;

		if (!confirmedDraw) {
			const elapsed = performance.now() - tapStartTime;
			if (elapsed < TAP_MAX_DURATION) {
				const target = zoom > 1 ? 1 : ZOOM_LEVEL;
				animateZoom(target, e.clientX, e.clientY);
			}
		}

		currentStroke = [];
		lastPoint = null;
	}

	function clearCanvas() {
		ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
	}

	function selectColor(color: string) {
		options = { ...options, color };
	}

	function flashUI() {
		showUI = true;
		clearTimeout(uiTimeout);
		uiTimeout = setTimeout(() => {
			if (isDrawing) return;
			showUI = false;
		}, 3000);
	}

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const img = new Image();
		img.onload = () => {
			lineArtImage = img;
			const result = extractLines(img, lineartCanvas.width, lineartCanvas.height);
			lineArtData = result;
			lineartCtx.clearRect(0, 0, lineartCanvas.width, lineartCanvas.height);
			lineartCtx.putImageData(result.imageData, 0, 0);
			clearCanvas();
			hasLineArt = true;
			if (zoom > 1) animateZoom(1, window.innerWidth / 2, window.innerHeight / 2);
		};
		img.src = URL.createObjectURL(file);
		input.value = '';
	}

	function loadDefaultLineArt() {
		const img = new Image();
		img.onload = () => {
			lineArtImage = img;
			redrawLineArt();
			hasLineArt = true;
			enterMagicMode();
		};
		img.src = 'springkussen.jpeg';
	}

	function removeLineArt() {
		lineartCtx.clearRect(0, 0, lineartCanvas.width, lineartCanvas.height);
		if (lineArtImage) {
			URL.revokeObjectURL(lineArtImage.src);
			lineArtImage = null;
		}
		lineArtData = null;
		hasLineArt = false;
	}

	$effect(() => {
		for (let i = 0; i < PENCIL_COLORS.length; i++) {
			const c = swatchCanvases[i];
			if (!c) continue;
			const sctx = c.getContext('2d')!;
			sctx.clearRect(0, 0, SWATCH_SIZE, SWATCH_SIZE);
			fillPencilSwatch(sctx, SWATCH_SIZE, PENCIL_COLORS[i]);
		}
	});

	$effect(() => {
		setupCanvas();
		loadDefaultLineArt();

		const onResize = () => {
			zoom = 1;
			panX = 0;
			panY = 0;
			const drawingData = ctx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height);
			setupCanvas();
			ctx.putImageData(drawingData, 0, 0);
			redrawLineArt();
		};

		window.addEventListener('resize', onResize);
		flashUI();

		return () => {
			window.removeEventListener('resize', onResize);
			clearTimeout(uiTimeout);
		};
	});
</script>

<svelte:head>
	<title>Colorpencil</title>
	<style>
		html, body {
			margin: 0;
			padding: 0;
			overflow: hidden;
			touch-action: none;
			-webkit-user-select: none;
			user-select: none;
		}
	</style>
</svelte:head>

<input
	bind:this={fileInput}
	type="file"
	accept="image/*"
	onchange={handleFileSelect}
	style="display: none;"
/>

<div class="canvas-stack">
	<div class="canvas-viewport" style="transform-origin: 0 0; transform: scale({zoom}) translate({panX}px, {panY}px);">
		<canvas bind:this={paperCanvas} class="layer"></canvas>
		<canvas
			bind:this={drawingCanvas}
			class="layer"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointerleave={onPointerUp}
			oncontextmenu={(e) => e.preventDefault()}
			style="touch-action: none;"
		></canvas>
		<canvas bind:this={lineartCanvas} class="layer layer-top"></canvas>
	</div>
</div>

{#if mode === 'magic' && magicSource}
	<MagicMode source={magicSource} onClose={() => (mode = 'draw')} />
{/if}

<div class="zoom-badge">
	<svg width="20" height="20" viewBox="0 0 20 20">
		<circle cx="10" cy="10" r="8" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1.5"/>
		<text x="10" y="10" text-anchor="middle" dominant-baseline="central" fill="rgba(0,0,0,0.4)" font-size="8" font-family="system-ui, sans-serif">{zoom > 1 ? `${Math.round(zoom)}x` : '1x'}</text>
	</svg>
</div>

<div class="toolbar" class:visible={showUI} role="toolbar" tabindex="-1" onpointerenter={() => { showUI = true; clearTimeout(uiTimeout); }}>
	<div class="colors">
		{#each PENCIL_COLORS as color, i}
			<button
				class="color-swatch"
				class:active={options.color === color}
				onclick={() => selectColor(color)}
				aria-label="Select color {color}"
			>
				<canvas bind:this={swatchCanvases[i]} width={SWATCH_SIZE} height={SWATCH_SIZE}></canvas>
			</button>
		{/each}
	</div>
	<button class="tool-btn" onclick={() => fileInput.click()} aria-label="Upload coloring page">
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
			<circle cx="8.5" cy="8.5" r="1.5"/>
			<polyline points="21 15 16 10 5 21"/>
		</svg>
	</button>
	<button class="tool-btn magic-btn" onclick={enterMagicMode} disabled={!hasLineArt} aria-label="Magische modus">
		✨
	</button>
	{#if hasLineArt}
		<button class="tool-btn" onclick={removeLineArt} aria-label="Remove line art">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<line x1="18" y1="6" x2="6" y2="18"/>
				<line x1="6" y1="6" x2="18" y2="18"/>
			</svg>
		</button>
	{/if}
	<button class="tool-btn" onclick={clearCanvas}>Clear</button>
</div>

<style>
	.canvas-stack {
		position: fixed;
		inset: 0;
		overflow: hidden;
	}

	.canvas-viewport {
		position: absolute;
		top: 0;
		left: 0;
	}

	.layer {
		position: absolute;
		top: 0;
		left: 0;
		display: block;
	}

	.layer-top {
		pointer-events: none;
	}

	.zoom-badge {
		position: fixed;
		top: 12px;
		right: 12px;
		pointer-events: none;
		z-index: 10;
	}

	.toolbar {
		position: fixed;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		background: rgba(255, 255, 255, 0.9);
		backdrop-filter: blur(10px);
		border-radius: 50px;
		box-shadow: 0 2px 20px rgba(0, 0, 0, 0.1);
		opacity: 0;
		transition: opacity 0.3s ease;
		pointer-events: none;
		z-index: 10;
	}

	.toolbar.visible {
		opacity: 1;
		pointer-events: auto;
	}

	.colors {
		display: flex;
		gap: 6px;
	}

	.color-swatch {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		transition: transform 0.15s ease, border-color 0.15s ease;
		padding: 0;
		background: none;
		overflow: hidden;
	}

	.color-swatch canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.color-swatch:hover {
		transform: scale(1.15);
	}

	.color-swatch.active {
		border-color: white;
		box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.3);
		transform: scale(1.1);
	}

	.tool-btn {
		padding: 6px 12px;
		background: #f0f0f0;
		border: none;
		border-radius: 20px;
		cursor: pointer;
		font-size: 13px;
		color: #555;
		transition: background 0.15s ease;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.tool-btn:hover {
		background: #e0e0e0;
	}

	.magic-btn {
		font-size: 15px;
		line-height: 1;
	}

	.tool-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

</style>
