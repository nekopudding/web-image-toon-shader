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

  // post_process_masks may return either boolean[][] (2D, rows × cols)
  // or a flat boolean[] depending on the transformers.js version.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMask: any = masks[0][0];
  if (!rawMask || rawMask.length === 0) return null;

  let result: Uint8Array;

  if (Array.isArray(rawMask[0])) {
    // 2D: boolean[][] — iterate rows then columns
    const rows = rawMask as boolean[][];
    const h = rows.length;
    const w = rows[0].length;
    if (h === 0 || w === 0) return null;
    result = new Uint8Array(h * w);
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        result[y * w + x] = row[x] ? 255 : 0;
      }
    }
  } else {
    // Flat: boolean[] — pixels in row-major order
    const flat = rawMask as boolean[];
    result = new Uint8Array(flat.length);
    for (let i = 0; i < flat.length; i++) {
      result[i] = flat[i] ? 255 : 0;
    }
  }

  if (result.every(v => v === 0)) {
    console.warn('[SAM] Mask decoded but all pixels are zero — try clicking a more distinct area');
    return null;
  }

  return result;
}

export function clearSamSession(): void {
  samSession = null;
}
