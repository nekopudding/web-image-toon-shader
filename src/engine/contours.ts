import type { ContourPath, ClusteredMap, Segment } from './types';
import { SegmentationMap } from './segmentation-map';

// Marching squares edge table
// Each case is encoded as 4 bits (top-left, top-right, bottom-right, bottom-left)
// Returns pairs of edge midpoints to connect
const MS_EDGES: Array<[number, number][]> = [
  [],                                           // 0000
  [[3, 2]],                                     // 0001
  [[2, 1]],                                     // 0010
  [[3, 1]],                                     // 0011
  [[1, 0]],                                     // 0100
  [[3, 0], [1, 2]],                             // 0101 (saddle)
  [[2, 0]],                                     // 0110
  [[3, 0]],                                     // 0111
  [[0, 3]],                                     // 1000
  [[0, 2]],                                     // 1001
  [[0, 1], [2, 3]],                             // 1010 (saddle)
  [[0, 1]],                                     // 1011
  [[1, 3]],                                     // 1100
  [[1, 2]],                                     // 1101
  [[2, 3]],                                     // 1110
  [],                                           // 1111
];

// Edge midpoint positions relative to cell (x, y):
// 0: top    (x+0.5, y)
// 1: right  (x+1,   y+0.5)
// 2: bottom (x+0.5, y+1)
// 3: left   (x,     y+0.5)
function edgeMidpoint(edge: number, cx: number, cy: number): { x: number; y: number } {
  switch (edge) {
    case 0: return { x: cx + 0.5, y: cy };
    case 1: return { x: cx + 1,   y: cy + 0.5 };
    case 2: return { x: cx + 0.5, y: cy + 1 };
    case 3: return { x: cx,       y: cy + 0.5 };
    default: return { x: cx, y: cy };
  }
}

export function traceContours(
  binaryField: Uint8Array,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
): { x: number; y: number }[][] {
  // Build segments list from marching squares
  const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];

  for (let cy = 0; cy < height - 1; cy++) {
    for (let cx = 0; cx < width - 1; cx++) {
      const tl = binaryField[cy * width + cx] > 0 ? 1 : 0;
      const tr = binaryField[cy * width + (cx + 1)] > 0 ? 1 : 0;
      const br = binaryField[(cy + 1) * width + (cx + 1)] > 0 ? 1 : 0;
      const bl = binaryField[(cy + 1) * width + cx] > 0 ? 1 : 0;

      const caseIndex = (tl << 3) | (tr << 2) | (br << 1) | bl;
      const edges = MS_EDGES[caseIndex];

      for (const [e1, e2] of edges) {
        const p1 = edgeMidpoint(e1, cx + offsetX, cy + offsetY);
        const p2 = edgeMidpoint(e2, cx + offsetX, cy + offsetY);
        segments.push([p1, p2]);
      }
    }
  }

  // Chain segments into polylines
  const chains: Array<{ x: number; y: number }[]> = [];
  const used = new Uint8Array(segments.length);

  for (let si = 0; si < segments.length; si++) {
    if (used[si]) continue;
    used[si] = 1;

    const chain: { x: number; y: number }[] = [segments[si][0], segments[si][1]];
    let extended = true;

    while (extended) {
      extended = false;
      const tail = chain[chain.length - 1];

      for (let sj = 0; sj < segments.length; sj++) {
        if (used[sj]) continue;
        const [p1, p2] = segments[sj];

        if (Math.abs(p1.x - tail.x) < 0.01 && Math.abs(p1.y - tail.y) < 0.01) {
          chain.push(p2);
          used[sj] = 1;
          extended = true;
          break;
        }
        if (Math.abs(p2.x - tail.x) < 0.01 && Math.abs(p2.y - tail.y) < 0.01) {
          chain.push(p1);
          used[sj] = 1;
          extended = true;
          break;
        }
      }
    }

    if (chain.length > 1) {
      chains.push(chain);
    }
  }

  return chains;
}

export function simplifyPath(
  points: { x: number; y: number }[],
  tolerance: number,
): { x: number; y: number }[] {
  if (points.length <= 2) return points;

  function perpendicularDist(
    pt: { x: number; y: number },
    line1: { x: number; y: number },
    line2: { x: number; y: number },
  ): number {
    const dx = line2.x - line1.x;
    const dy = line2.y - line1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) return Math.hypot(pt.x - line1.x, pt.y - line1.y);
    return Math.abs((dy * pt.x - dx * pt.y + line2.x * line1.y - line2.y * line1.x) / len);
  }

  function rdp(pts: { x: number; y: number }[], start: number, end: number, result: Set<number>): void {
    if (end <= start + 1) return;

    let maxDist = 0;
    let maxIdx = start;

    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDist(pts[i], pts[start], pts[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance) {
      result.add(maxIdx);
      rdp(pts, start, maxIdx, result);
      rdp(pts, maxIdx, end, result);
    }
  }

  const keep = new Set<number>([0, points.length - 1]);
  rdp(points, 0, points.length - 1, keep);

  return Array.from(keep)
    .sort((a, b) => a - b)
    .map(i => points[i]);
}

export function extractContours(
  map: SegmentationMap,
  clusteredMaps: Map<number, ClusteredMap>,
  segment: Segment,
): ContourPath[] {
  const result: ContourPath[] = [];
  const { bbox } = map.pixelsForSegment(segment.id);

  if (bbox.width === 0 || bbox.height === 0) return result;

  // Segment boundary contour
  const binaryField = new Uint8Array(map.width * map.height);
  for (let i = 0; i < map.ids.length; i++) {
    binaryField[i] = map.ids[i] === segment.id ? 1 : 0;
  }

  // Crop to bbox + 1px padding
  const padX = Math.max(0, bbox.x - 1);
  const padY = Math.max(0, bbox.y - 1);
  const padW = Math.min(map.width, bbox.x + bbox.width + 2) - padX;
  const padH = Math.min(map.height, bbox.y + bbox.height + 2) - padY;

  const croppedBinary = new Uint8Array(padW * padH);
  for (let y = 0; y < padH; y++) {
    for (let x = 0; x < padW; x++) {
      croppedBinary[y * padW + x] = binaryField[(padY + y) * map.width + (padX + x)];
    }
  }

  const boundaryChains = traceContours(croppedBinary, padW, padH, padX, padY);
  const tolerance = 0.8;

  for (const chain of boundaryChains) {
    result.push({
      points: simplifyPath(chain, tolerance),
      type: 'segment-boundary',
      segmentId: segment.id,
    });
  }

  // Shade boundary contours (between cluster regions)
  const cm = clusteredMaps.get(segment.id);
  if (!cm) return result;

  const { clusterIds, clusters } = cm;
  const cmW = cm.bbox.width;
  const cmH = cm.bbox.height;

  for (const cluster of clusters) {
    const clusterField = new Uint8Array(cmW * cmH);
    for (let i = 0; i < clusterIds.length; i++) {
      // Only include pixels that belong to both this cluster and this segment
      const globalX = cm.bbox.x + (i % cmW);
      const globalY = cm.bbox.y + Math.floor(i / cmW);
      const segId = map.query(globalX, globalY);
      if (segId === segment.id && clusterIds[i] === cluster.id) {
        clusterField[i] = 1;
      }
    }

    const shadeChains = traceContours(clusterField, cmW, cmH, cm.bbox.x, cm.bbox.y);
    for (const chain of shadeChains) {
      result.push({
        points: simplifyPath(chain, tolerance),
        type: 'shade-boundary',
        segmentId: segment.id,
        clusterId: cluster.id,
      });
    }
  }

  return result;
}
