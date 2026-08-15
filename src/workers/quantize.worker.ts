import type { BBox, Segment, Cluster } from '../engine/types';
import { kmeans } from '../engine/quantize';
import { rgbToLab, labToRgb } from '../engine/color-space';

interface QuantizeInput {
  type: 'quantize';
  imageData: ArrayBuffer;
  width: number;
  height: number;
  segmentIds: ArrayBuffer;
  segmentId: number;
  bbox: BBox;
  settings: Segment['colorSettings'];
  lockedColors: ([number, number, number] | null)[];
}

interface QuantizeOutput {
  type: 'done';
  clusterIds: ArrayBuffer; // raw k-means assignments, no smoothing or sentinel masking
  clusters: Cluster[];
}

self.onmessage = (evt: MessageEvent<QuantizeInput>) => {
  const msg = evt.data;
  if (msg.type !== 'quantize') return;

  const {
    imageData,
    width: imageWidth,
    segmentIds,
    segmentId,
    bbox,
    settings,
    lockedColors,
  } = msg;

  const pixels = new Uint8ClampedArray(imageData);
  const segMap = new Uint16Array(segmentIds);
  const bboxW = bbox.width;
  const bboxH = bbox.height;

  // Collect pixels belonging to this segment
  const indices: number[] = [];
  for (let y = bbox.y; y < bbox.y + bboxH; y++) {
    for (let x = bbox.x; x < bbox.x + bboxW; x++) {
      const idx = y * imageWidth + x;
      if (segMap[idx] === segmentId) {
        indices.push(idx);
      }
    }
  }

  const n = indices.length;
  const labPixels = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    const pixelIdx = indices[i];
    const r = pixels[pixelIdx * 4] / 255;
    const g = pixels[pixelIdx * 4 + 1] / 255;
    const b = pixels[pixelIdx * 4 + 2] / 255;

    if (settings.colorSpace === 'lab') {
      const [L, a, bv] = rgbToLab(r, g, b);
      labPixels[i * 3] = L;
      labPixels[i * 3 + 1] = a;
      labPixels[i * 3 + 2] = bv;
    } else {
      labPixels[i * 3] = r * 100;
      labPixels[i * 3 + 1] = g * 100;
      labPixels[i * 3 + 2] = b * 100;
    }
  }

  // Build locked centroids
  const locked: (Float32Array | null)[] = [];
  for (const lc of lockedColors) {
    if (lc) {
      if (settings.colorSpace === 'lab') {
        const [L, a, b] = rgbToLab(lc[0] / 255, lc[1] / 255, lc[2] / 255);
        locked.push(new Float32Array([L, a, b]));
      } else {
        locked.push(new Float32Array([lc[0] / 255 * 100, lc[1] / 255 * 100, lc[2] / 255 * 100]));
      }
    } else {
      locked.push(null);
    }
  }

  const k = Math.max(2, Math.min(6, settings.targetColorCount));
  const { centroids, assignments } = kmeans(labPixels, k, locked.length > 0 ? locked : undefined);

  // Build clusterIds array for the bounding box
  let clusterIds = new Uint8Array(bboxW * bboxH) as Uint8Array<ArrayBuffer>;

  for (let i = 0; i < n; i++) {
    const pixelIdx = indices[i];
    const globalX = pixelIdx % imageWidth;
    const globalY = Math.floor(pixelIdx / imageWidth);
    const localX = globalX - bbox.x;
    const localY = globalY - bbox.y;
    clusterIds[localY * bboxW + localX] = assignments[i];
  }

  // Build cluster objects
  const clusterList = centroids.map((c, idx) => ({ idx, L: c[0], centroid: c }));
  clusterList.sort((a, b) => b.L - a.L);

  const clusters: Cluster[] = clusterList.map((cl, rank) => {
    let rgbColor: [number, number, number];
    if (settings.colorSpace === 'lab') {
      const [r, g, b] = labToRgb(cl.centroid[0], cl.centroid[1], cl.centroid[2]);
      rgbColor = [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    } else {
      rgbColor = [
        Math.round(cl.centroid[0] / 100 * 255),
        Math.round(cl.centroid[1] / 100 * 255),
        Math.round(cl.centroid[2] / 100 * 255),
      ];
    }
    return {
      id: cl.idx,
      segmentId,
      labColor: [cl.centroid[0], cl.centroid[1], cl.centroid[2]] as [number, number, number],
      rgbColor,
      lightnessRank: rank,
      locked: !!(lockedColors[cl.idx]),
    };
  });

  const output: QuantizeOutput = {
    type: 'done',
    clusterIds: clusterIds.buffer,
    clusters,
  };

  self.postMessage(output, { transfer: [clusterIds.buffer] });
};
