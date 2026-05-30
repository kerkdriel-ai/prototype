import type { BBox } from '$lib/cutout';

export interface SamSegmenter {
	setImage(source: ImageData): Promise<void>;
	segmentAt(x: number, y: number): Promise<{ mask: Uint8Array; bbox: BBox } | null>;
}

interface MaskTensor {
	dims: number[];
	data: Uint8Array | BigInt64Array;
}

interface SamOutputs {
	pred_masks: unknown;
	iou_scores: { data: Float32Array };
}

interface SamModelInstance {
	(inputs: Record<string, unknown>): Promise<SamOutputs>;
	get_image_embeddings(inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface SamProcessorInstance {
	(image: unknown, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
	post_process_masks(masks: unknown, originalSizes: unknown, reshapedSizes: unknown): Promise<MaskTensor[]>;
}

const MODEL_ID = 'Xenova/slimsam-77-uniform';

export async function createSamSegmenter(): Promise<SamSegmenter> {
	const { SamModel, AutoProcessor, RawImage, env } = await import('@huggingface/transformers');
	env.allowLocalModels = false;

	let loaded;
	try {
		loaded = await SamModel.from_pretrained(MODEL_ID, { device: 'webgpu', dtype: 'fp16' });
	} catch {
		loaded = await SamModel.from_pretrained(MODEL_ID);
	}
	const model = loaded as unknown as SamModelInstance;
	const processor = (await AutoProcessor.from_pretrained(MODEL_ID)) as unknown as SamProcessorInstance;

	let rawImage: InstanceType<typeof RawImage> | null = null;
	let imageInputs: Record<string, unknown> | null = null;
	let imageEmbeddings: Record<string, unknown> | null = null;
	let width = 0;
	let height = 0;

	function toRgbImage(source: ImageData) {
		const data = source.data;
		const pixels = source.width * source.height;
		const rgb = new Uint8ClampedArray(pixels * 3);
		for (let i = 0; i < pixels; i++) {
			const alpha = data[i * 4 + 3] / 255;
			rgb[i * 3] = Math.round(alpha * data[i * 4] + (1 - alpha) * 255);
			rgb[i * 3 + 1] = Math.round(alpha * data[i * 4 + 1] + (1 - alpha) * 255);
			rgb[i * 3 + 2] = Math.round(alpha * data[i * 4 + 2] + (1 - alpha) * 255);
		}
		return new RawImage(rgb, source.width, source.height, 3);
	}

	return {
		async setImage(source: ImageData) {
			width = source.width;
			height = source.height;
			rawImage = toRgbImage(source);
			imageInputs = await processor(rawImage);
			imageEmbeddings = await model.get_image_embeddings(imageInputs);
		},

		async segmentAt(x: number, y: number) {
			if (!rawImage || !imageInputs || !imageEmbeddings) return null;

			const promptInputs = await processor(rawImage, {
				input_points: [[[x, y]]],
				input_labels: [[1]],
			});

			const outputs = await model({
				...imageEmbeddings,
				input_points: promptInputs.input_points,
				input_labels: promptInputs.input_labels,
			});

			const processed = await processor.post_process_masks(
				outputs.pred_masks,
				imageInputs.original_sizes,
				imageInputs.reshaped_input_sizes,
			);

			const maskTensor = processed[0];
			const maskCount = maskTensor.dims[0];
			const planeSize = width * height;
			const maskData = maskTensor.data;
			const scores = outputs.iou_scores.data;

			let best = 0;
			for (let i = 1; i < maskCount; i++) {
				if (scores[i] > scores[best]) best = i;
			}

			const mask = new Uint8Array(planeSize);
			let minX = width;
			let minY = height;
			let maxX = 0;
			let maxY = 0;
			let any = false;
			const offset = best * planeSize;
			for (let i = 0; i < planeSize; i++) {
				if (!maskData[offset + i]) continue;
				mask[i] = 1;
				any = true;
				const px = i % width;
				const py = (i - px) / width;
				if (px < minX) minX = px;
				if (px > maxX) maxX = px;
				if (py < minY) minY = py;
				if (py > maxY) maxY = py;
			}

			if (!any) return null;

			return { mask, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
		},
	};
}
