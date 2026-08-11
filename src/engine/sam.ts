import type { SamPoint } from './types';

const MODEL_ID = 'Xenova/slimsam-50-uniform';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipeline: { model: any; processor: any } | null = null;
let modelLoading = false;
let modelReady = false;

// Module-level SAM session — tensors can't be stored in Redux/plain state
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let samSession: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  image_embeddings: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  image_positional_embeddings: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawImage: any;
} | null = null;

export function hasSamSession(): boolean {
  return samSession !== null;
}

export async function loadModel(): Promise<void> {
  if (modelReady || modelLoading) return;
  modelLoading = true;

  try {
    const { SamModel, AutoProcessor, env } = await import('@huggingface/transformers');
    env.useBrowserCache = true;

    const useWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

    const [model, processor] = await Promise.all([
      SamModel.from_pretrained(MODEL_ID, {
        dtype: useWebGpu ? 'fp16' : 'fp32',
        device: useWebGpu ? 'webgpu' : 'wasm',
      }).catch(() =>
        SamModel.from_pretrained(MODEL_ID, { dtype: 'fp32', device: 'wasm' }),
      ),
      AutoProcessor.from_pretrained(MODEL_ID),
    ]);

    pipeline = { model, processor };
    modelReady = true;
    modelLoading = false;
  } catch (err) {
    modelLoading = false;
    throw err;
  }
}

export async function computeEmbedding(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (!modelReady || !pipeline) {
    throw new Error('Model not loaded');
  }

  onProgress?.(0.1);

  const { RawImage } = await import('@huggingface/transformers');
  const rawImage = new RawImage(new Uint8ClampedArray(imageData), width, height, 4);

  onProgress?.(0.3);

  const { processor, model } = pipeline;
  const imageInputs = await processor(rawImage);

  onProgress?.(0.6);

  const { image_embeddings, image_positional_embeddings } =
    await model.get_image_embeddings(imageInputs);

  onProgress?.(1.0);

  // Store tensors and rawImage for later decode calls
  samSession = { image_embeddings, image_positional_embeddings, rawImage };
}

export async function decodeMask(
  points: SamPoint[],
): Promise<Uint8Array | null> {
  if (!modelReady || !pipeline || !samSession) return null;
  if (points.length === 0) return null;

  const { processor, model } = pipeline;
  const { image_embeddings, image_positional_embeddings, rawImage } = samSession;

  // input_points: [num_masks, num_points, 2] — pixel coords in original image space
  // input_labels: [num_masks, num_points]
  const inputPoints = [points.map(p => [p.x, p.y])];
  const inputLabels = [points.map(p => p.label)];

  // Processor converts points to tensors and normalises coordinates
  const decodeInputs = await processor(rawImage, {
    input_points: inputPoints,
    input_labels: inputLabels,
  });

  const outputs = await model({
    ...decodeInputs,
    image_embeddings,
    image_positional_embeddings,
  });

  // Post-process to binary mask at original resolution
  const masks: boolean[][][] = await processor.post_process_masks(
    outputs.pred_masks,
    decodeInputs.original_sizes,
    decodeInputs.reshaped_input_sizes,
    { threshold: 0 },
  );

  if (!masks || !masks[0]) return null;

  // Pick the first mask (batch index 0, mask index 0)
  const mask2d = masks[0][0];
  const result = new Uint8Array(mask2d.length);
  for (let i = 0; i < mask2d.length; i++) {
    result[i] = mask2d[i] ? 255 : 0;
  }
  return result;
}

export function clearSamSession(): void {
  samSession = null;
}
