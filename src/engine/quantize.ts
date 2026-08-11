import type { SourceImage, Segment, ClusteredMap, Cluster } from './types';
import { rgbToLab, labToRgb } from './color-space';
import { SegmentationMap } from './segmentation-map';

function labDist2(a: Float32Array | number[], aOff: number, b: Float32Array | number[], bOff: number): number {
  const dL = a[aOff] - b[bOff];
  const da = a[aOff + 1] - b[bOff + 1];
  const db = a[aOff + 2] - b[bOff + 2];
  return dL * dL + da * da + db * db;
}

function kmeansppInit(pixels: Float32Array, k: number, n: number): Float32Array[] {
  const centroids: Float32Array[] = [];

  // Pick first centroid randomly
  const firstIdx = Math.floor(Math.random() * n);
  centroids.push(new Float32Array([
    pixels[firstIdx * 3],
    pixels[firstIdx * 3 + 1],
    pixels[firstIdx * 3 + 2],
  ]));

  for (let c = 1; c < k; c++) {
    const distances = new Float32Array(n);
    let totalDist = 0;

    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const d = labDist2(pixels, i * 3, centroid, 0);
        if (d < minDist) minDist = d;
      }
      distances[i] = minDist;
      totalDist += minDist;
    }

    // Weighted random selection
    let rand = Math.random() * totalDist;
    let chosen = 0;
    for (let i = 0; i < n; i++) {
      rand -= distances[i];
      if (rand <= 0) {
        chosen = i;
        break;
      }
    }

    centroids.push(new Float32Array([
      pixels[chosen * 3],
      pixels[chosen * 3 + 1],
      pixels[chosen * 3 + 2],
    ]));
  }

  return centroids;
}

export function kmeans(
  pixels: Float32Array,
  k: number,
  lockedCentroids?: Float32Array[],
): { centroids: Float32Array[]; assignments: Uint8Array } {
  const n = pixels.length / 3;
  const maxIter = 30;
  const epsilon = 0.5;

  if (n === 0 || k === 0) {
    return { centroids: [], assignments: new Uint8Array(0) };
  }

  k = Math.min(k, n);

  let centroids = kmeansppInit(pixels, k, n);

  // Override with locked centroids if provided
  if (lockedCentroids) {
    for (let i = 0; i < lockedCentroids.length && i < k; i++) {
      if (lockedCentroids[i]) {
        centroids[i] = new Float32Array(lockedCentroids[i]);
      }
    }
  }

  const assignments = new Uint8Array(n);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assignment step
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let minC = 0;
      for (let c = 0; c < k; c++) {
        const d = labDist2(pixels, i * 3, centroids[c], 0);
        if (d < minDist) {
          minDist = d;
          minC = c;
        }
      }
      assignments[i] = minC;
    }

    // Update step
    let maxShift = 0;
    const newCentroids: Float32Array[] = [];

    for (let c = 0; c < k; c++) {
      // Skip locked centroids
      if (lockedCentroids && lockedCentroids[c]) {
        newCentroids.push(centroids[c]);
        continue;
      }

      const sum = new Float64Array(3);
      let count = 0;
      for (let i = 0; i < n; i++) {
        if (assignments[i] === c) {
          sum[0] += pixels[i * 3];
          sum[1] += pixels[i * 3 + 1];
          sum[2] += pixels[i * 3 + 2];
          count++;
        }
      }

      if (count === 0) {
        newCentroids.push(centroids[c]);
        continue;
      }

      const nc = new Float32Array([sum[0] / count, sum[1] / count, sum[2] / count]);
      const shift = Math.sqrt(labDist2(nc, 0, centroids[c], 0));
      if (shift > maxShift) maxShift = shift;
      newCentroids.push(nc);
    }

    centroids = newCentroids;

    if (maxShift < epsilon) break;
  }

  return { centroids, assignments };
}

export async function quantizeSegment(
  sourceImage: SourceImage,
  map: SegmentationMap,
  segment: Segment,
  lockedColors?: ([number, number, number] | null)[],
): Promise<ClusteredMap> {
  const { indices, bbox } = map.pixelsForSegment(segment.id);
  const n = indices.length;

  if (n === 0) {
    return {
      segmentId: segment.id,
      bbox: segment.boundingBox,
      clusterIds: new Uint8Array(0),
      clusters: [],
    };
  }

  // Extract Lab pixels for this segment
  const labPixels = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const pixelIdx = indices[i];
    const r = sourceImage.data[pixelIdx * 4] / 255;
    const g = sourceImage.data[pixelIdx * 4 + 1] / 255;
    const b = sourceImage.data[pixelIdx * 4 + 2] / 255;
    const [L, a, bLab] = rgbToLab(r, g, b);
    labPixels[i * 3] = L;
    labPixels[i * 3 + 1] = a;
    labPixels[i * 3 + 2] = bLab;
  }

  // Build locked centroids array
  const locked: Float32Array[] = [];
  if (lockedColors) {
    for (let i = 0; i < lockedColors.length; i++) {
      const lc = lockedColors[i];
      if (lc) {
        const [L, a, b] = rgbToLab(lc[0] / 255, lc[1] / 255, lc[2] / 255);
        locked.push(new Float32Array([L, a, b]));
      } else {
        locked.push(new Float32Array(0));
      }
    }
  }

  const k = segment.colorSettings.targetColorCount;
  const { centroids, assignments } = kmeans(labPixels, k, locked.length > 0 ? locked : undefined);

  // Map back to image space
  const bboxW = bbox.width;
  const bboxH = bbox.height;
  const clusterIds = new Uint8Array(bboxW * bboxH);

  for (let i = 0; i < n; i++) {
    const pixelIdx = indices[i];
    const globalX = pixelIdx % sourceImage.width;
    const globalY = Math.floor(pixelIdx / sourceImage.width);
    const localX = globalX - bbox.x;
    const localY = globalY - bbox.y;
    clusterIds[localY * bboxW + localX] = assignments[i];
  }

  // Build cluster objects sorted by lightness
  const clusterList: Array<{ idx: number; L: number; centroid: Float32Array }> = centroids.map(
    (c, idx) => ({ idx, L: c[0], centroid: c }),
  );
  clusterList.sort((a, b) => b.L - a.L); // descending lightness = highlight first

  const clusters: Cluster[] = clusterList.map((cl, rank) => {
    const [r, g, b] = labToRgb(cl.centroid[0], cl.centroid[1], cl.centroid[2]);
    return {
      id: cl.idx,
      segmentId: segment.id,
      labColor: [cl.centroid[0], cl.centroid[1], cl.centroid[2]],
      rgbColor: [
        Math.round(r * 255),
        Math.round(g * 255),
        Math.round(b * 255),
      ],
      lightnessRank: rank,
      locked: !!(lockedColors && lockedColors[cl.idx]),
    };
  });

  return {
    segmentId: segment.id,
    bbox,
    clusterIds,
    clusters,
  };
}
