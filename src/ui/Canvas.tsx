import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useProjectStore } from './hooks/useProjectStore';
import { renderToCanvas } from '../engine/compositor';
import { loadModel, computeEmbedding, clearSamSession } from '../engine/sam';
import { SegmentationMap } from '../engine/segmentation-map';
import { kmeans } from '../engine/quantize';
import { rgbToLab, labToRgb } from '../engine/color-space';
import { modeFilter, removeSmallRegions } from '../engine/cleanup';
import { traceContours, simplifyPath } from '../engine/contours';
import type { ProjectAction } from '../store/project-store';
import type { SourceImage, Segment, BBox, Cluster, ClusteredMap, ContourPath } from '../engine/types';

const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage: `
    linear-gradient(45deg, #e5e2dd 25%, transparent 25%),
    linear-gradient(-45deg, #e5e2dd 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e5e2dd 75%),
    linear-gradient(-45deg, transparent 75%, #e5e2dd 75%)
  `,
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
  backgroundColor: '#eceae6',
};

function createSampleImage(): SourceImage {
  const w = 320;
  const h = 320;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const cx = x - w / 2;
      const cy = y - h / 2;
      const r = Math.sqrt(cx * cx + cy * cy);
      // Concentric regions: sky, body, shadow
      if (r < 60) {
        data[idx] = 231; data[idx + 1] = 193; data[idx + 2] = 163;
      } else if (r < 120) {
        data[idx] = 91; data[idx + 1] = 111; data[idx + 2] = 146;
      } else {
        data[idx] = 61; data[idx + 1] = 79; data[idx + 2] = 108;
      }
      // Slight gradient shading
      const g = 0.85 + 0.15 * (y / h);
      data[idx] = Math.round(data[idx] * g);
      data[idx + 1] = Math.round(data[idx + 1] * g);
      data[idx + 2] = Math.round(data[idx + 2] * g);
      data[idx + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

// Global segmentation map (lives outside React state — contains typed arrays)
let globalSegMap: SegmentationMap | null = null;

// ── Auto-segment helpers ─────────────────────────────────────────────────────

function buildAutoSegments(
  image: SourceImage,
  segMap: SegmentationMap,
  numClusters = 3,
): { segments: Segment[]; clusteredMaps: Map<number, ClusteredMap> } {
  const { width, height, data } = image;
  const n = width * height;

  // Build Lab pixel array for the whole image
  const labPixels = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    const [L, a, bv] = rgbToLab(r, g, b);
    labPixels[i * 3] = L;
    labPixels[i * 3 + 1] = a;
    labPixels[i * 3 + 2] = bv;
  }

  const { centroids, assignments } = kmeans(labPixels, numClusters);

  // Sort centroids by lightness descending (highlight → shadow)
  const centroidList = centroids.map((c, idx) => ({ idx, L: c[0], c }));
  centroidList.sort((a, b) => b.L - a.L);

  const segments: Segment[] = [];
  const clusteredMaps = new Map<number, ClusteredMap>();

  for (let rank = 0; rank < centroidList.length; rank++) {
    const { idx: clusterIdx, c: centroid } = centroidList[rank];
    const segId = rank + 1;

    // Build a mask for pixels belonging to this cluster
    const mask = new Uint8Array(n);
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let pixelCount = 0;

    for (let i = 0; i < n; i++) {
      if (assignments[i] === clusterIdx) {
        mask[i] = 255;
        const px = i % width;
        const py = Math.floor(i / width);
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
        pixelCount++;
      }
    }

    if (pixelCount === 0) continue;

    const bbox: BBox = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };

    // Paint into seg map
    segMap.paint(mask, segId, { x: 0, y: 0, width, height });

    const [r, g, b] = labToRgb(centroid[0], centroid[1], centroid[2]);
    const rgbColor: [number, number, number] = [
      Math.round(r * 255),
      Math.round(g * 255),
      Math.round(b * 255),
    ];

    const roleLabels = ['Highlight', 'Base', 'Shadow', 'Dark', 'Darkest', 'Darkest+'];

    const cluster: Cluster = {
      id: 0,
      segmentId: segId,
      labColor: [centroid[0], centroid[1], centroid[2]],
      rgbColor,
      lightnessRank: rank,
      locked: false,
    };

    // Build clusterIds for bbox
    const bboxW = bbox.width;
    const bboxH = bbox.height;
    const clusterIds = new Uint8Array(bboxW * bboxH);
    for (let localY = 0; localY < bboxH; localY++) {
      for (let localX = 0; localX < bboxW; localX++) {
        clusterIds[localY * bboxW + localX] = segMap.query(bbox.x + localX, bbox.y + localY) === segId ? 0 : 255;
      }
    }

    const segment: Segment = {
      id: segId,
      parentId: null,
      label: roleLabels[rank] ?? `Region ${segId}`,
      promptPoints: [],
      boundingBox: bbox,
      colorSettings: { targetColorCount: 3, colorSpace: 'lab' },
      smoothing: 0.5,
      outlineSettings: { visible: true, strokeWidth: 1.5, strokeColor: '#2b2a28' },
      visible: true,
    };

    segments.push(segment);
    clusteredMaps.set(segId, {
      segmentId: segId,
      bbox,
      clusterIds,
      clusters: [cluster],
    });
  }

  return { segments, clusteredMaps };
}

// Apply a circular brush to a mask (set pixels to 255 or 0).
// When painting (not erasing), only marks pixels that belong to segmentId in segMap.
// When erasing, clears any painted pixel regardless of segment ownership.
function applyBrush(
  x: number, y: number,
  mask: Uint8Array,
  erasing: boolean,
  w: number, h: number,
  radius: number,
  segMap: SegmentationMap | null,
  segmentId: number | null,
): void {
  const r2 = radius * radius;
  const x0 = Math.max(0, x - radius);
  const x1 = Math.min(w - 1, x + radius);
  const y0 = Math.max(0, y - radius);
  const y1 = Math.min(h - 1, y + radius);
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - x;
      const dy = py - y;
      if (dx * dx + dy * dy <= r2) {
        if (!erasing && segMap && segmentId !== null) {
          if (segMap.ids[py * w + px] !== segmentId) continue;
        }
        mask[py * w + px] = erasing ? 0 : 255;
      }
    }
  }
}

// Apply smoothing + cleanup + sentinel masking + contour tracing synchronously on the main thread.
// rawClusterIds: output of k-means worker (unsmoothed, non-segment pixels = 0).
// Returns dispatches SET_CLUSTERED_MAP and SET_CONTOUR_PATHS for the segment.
function applySmoothing(
  segmentId: number,
  rawClusterIds: Uint8Array,
  clusters: Cluster[],
  bbox: BBox,
  smoothing: number,
  segMap: SegmentationMap,
  imageWidth: number,
  dispatch: (action: ProjectAction) => void,
): void {
  const bboxW = bbox.width;
  const bboxH = bbox.height;

  let clusterIds = rawClusterIds.slice(0) as Uint8Array<ArrayBuffer>;

  // Apply mode filter (smoothing)
  const smoothPasses = Math.round(smoothing * 3);
  if (smoothPasses > 0) {
    clusterIds = modeFilter(clusterIds, bboxW, bboxH, smoothPasses);
  }
  clusterIds = removeSmallRegions(clusterIds, bboxW, bboxH, 10);

  // Build contours BEFORE sentinel masking (need actual cluster ids for shade boundaries)
  const contours: ContourPath[] = [];

  // Segment boundary
  const segBinaryField = new Uint8Array(bboxW * bboxH);
  for (let i = 0; i < segBinaryField.length; i++) {
    const globalX = bbox.x + (i % bboxW);
    const globalY = bbox.y + Math.floor(i / bboxW);
    segBinaryField[i] = segMap.ids[globalY * imageWidth + globalX] === segmentId ? 1 : 0;
  }
  const boundaryChains = traceContours(segBinaryField, bboxW, bboxH, bbox.x, bbox.y);
  for (const chain of boundaryChains) {
    contours.push({ points: simplifyPath(chain, 0.8), type: 'segment-boundary', segmentId });
  }

  // Shade boundaries
  for (const cluster of clusters) {
    const field = new Uint8Array(bboxW * bboxH);
    for (let i = 0; i < clusterIds.length; i++) {
      const globalX = bbox.x + (i % bboxW);
      const globalY = bbox.y + Math.floor(i / bboxW);
      if (segMap.ids[globalY * imageWidth + globalX] === segmentId && clusterIds[i] === cluster.id) {
        field[i] = 1;
      }
    }
    const shadeChains = traceContours(field, bboxW, bboxH, bbox.x, bbox.y);
    for (const chain of shadeChains) {
      contours.push({ points: simplifyPath(chain, 0.8), type: 'shade-boundary', segmentId, clusterId: cluster.id });
    }
  }

  // Sentinel masking: mark non-segment pixels as 255 so compositor skips them
  for (let i = 0; i < bboxW * bboxH; i++) {
    const globalX = bbox.x + (i % bboxW);
    const globalY = bbox.y + Math.floor(i / bboxW);
    if (segMap.ids[globalY * imageWidth + globalX] !== segmentId) {
      clusterIds[i] = 255;
    }
  }

  const newMap: ClusteredMap = { segmentId, bbox, clusterIds, clusters };
  dispatch({ type: 'SET_CLUSTERED_MAP', segmentId, map: newMap });
  dispatch({ type: 'SET_CONTOUR_PATHS', segmentId, paths: contours });
}

export function Canvas(): React.ReactElement {
  const [state, dispatch] = useProjectStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showGuide, setShowGuide] = useState(false);
  const [samStatus, setSamStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [activeTool, setActiveTool] = useState<'paint' | 'paint-erase'>('paint');
  const [paintAllLayers, setPaintAllLayers] = useState(false);
  const [paintMask, setPaintMask] = useState<Uint8Array | null>(null);
  const [brushSize, setBrushSize] = useState(20);
  const [isPainting, setIsPainting] = useState(false);
  const isPaintingRef = useRef(false);
  const paintMaskRef = useRef<Uint8Array | null>(null);
  const [paintTarget, setPaintTarget] = useState<number | 'new'>('new');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const embeddingStartRef = useRef<number>(0);
  // Tracks in-flight quantize workers by segmentId so we cancel stale runs
  // when settings change mid-computation (e.g. slider dragging).
  const quantizeWorkersRef = useRef<Map<number, Worker>>(new Map());
  // Cache of raw k-means results keyed by segmentId → colorSettingsKey → raw result.
  // Smoothing is NOT part of the cache key — it's applied on the main thread after retrieval.
  // Cleared per-segment when the underlying pixel mask changes (merge, paint, new image).
  const quantizeCacheRef = useRef<Map<number, Map<string, { rawClusterIds: Uint8Array; clusters: Cluster[]; bbox: BBox }>>>(new Map());
  // Ref mirror of clusteredMaps so the dirty effect can read lockedColors without
  // taking clusteredMaps as a dep — which would restart all in-flight workers every
  // time any single worker finishes and dispatches SET_CLUSTERED_MAP.
  const clusteredMapsRef = useRef(state.clusteredMaps);
  clusteredMapsRef.current = state.clusteredMaps;
  const autoSegmentCountRef = useRef(state.autoSegmentCount);
  autoSegmentCountRef.current = state.autoSegmentCount;

  // Keep refs in sync with latest zoom/pan so the wheel handler never goes stale.
  // Using refs avoids putting zoom/panOffset in the wheel effect's deps array,
  // which would cause the listener to be torn down and re-added on every scroll.
  const zoomRef = useRef(state.zoom);
  const panRef = useRef(state.panOffset);
  zoomRef.current = state.zoom;
  panRef.current = state.panOffset;

  // Keep refs in sync so paint callbacks always see the latest values
  // without being torn down on every selection/toggle change.
  const selectedSegmentIdRef = useRef(state.selectedSegmentId);
  selectedSegmentIdRef.current = state.selectedSegmentId;
  const paintAllLayersRef = useRef(paintAllLayers);
  paintAllLayersRef.current = paintAllLayers;

  // Report container size for fit-to-screen.
  // Must re-run when stage changes because the container div only renders
  // after the upload state exits — containerRef.current is null on first mount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const report = () => {
      dispatch({ type: 'SET_CONTAINER_SIZE', w: el.clientWidth, h: el.clientHeight });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dispatch, state.stage]);

  // Scroll-to-zoom: zoom toward the cursor position.
  // Must use addEventListener (not React onWheel) with passive:false so
  // preventDefault() is allowed to suppress page scroll.
  // Reads zoom/panOffset from refs so deps stay stable across scroll events.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      // Cursor offset from container centre (the transform origin)
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;

      const ZOOM_SPEED = 0.001;
      const factor = Math.exp(-e.deltaY * ZOOM_SPEED);
      const oldZoom = zoomRef.current;
      const newZoom = Math.max(0.1, Math.min(4, oldZoom * factor));

      // Derive the pan offset that keeps the canvas point under the cursor
      // at the same screen position after the zoom change.
      const oldPan = panRef.current;
      const newPanX = mx - (newZoom / oldZoom) * (mx - oldPan.x);
      const newPanY = my - (newZoom / oldZoom) * (my - oldPan.y);

      dispatch({ type: 'SET_ZOOM_AND_PAN', zoom: newZoom, panX: newPanX, panY: newPanY });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [dispatch, state.stage]);

  // Render main canvas when state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state.sourceImage) return;
    renderToCanvas(
      canvas,
      state.sourceImage,
      state.segments,
      state.clusteredMaps,
      state.contourPaths,
      state.viewMode,
    );
  }, [state.sourceImage, state.segments, state.clusteredMaps, state.contourPaths, state.viewMode]);

  // Render overlay (paint mask + brush cursor)
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !state.sourceImage) return;

    overlay.width = state.sourceImage.width;
    overlay.height = state.sourceImage.height;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (paintMask) {
      const imgData = ctx.createImageData(overlay.width, overlay.height);
      for (let i = 0; i < paintMask.length; i++) {
        if (paintMask[i] > 0) {
          imgData.data[i * 4] = 255;
          imgData.data[i * 4 + 1] = 140;
          imgData.data[i * 4 + 2] = 0;
          imgData.data[i * 4 + 3] = 120;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    // Draw brush cursor circle
    if (cursorPos) {
      const zoom = state.zoom;
      const isErase = activeTool === 'paint-erase';
      ctx.beginPath();
      ctx.arc(cursorPos.x, cursorPos.y, brushSize, 0, Math.PI * 2);
      ctx.strokeStyle = isErase ? '#ff4444' : '#ff8c00';
      ctx.lineWidth = 1.5 / zoom;
      if (isErase) {
        ctx.setLineDash([4 / zoom, 3 / zoom]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [paintMask, cursorPos, state.sourceImage, state.zoom, activeTool]);

  // Re-quantize any segment marked dirty (e.g. after tones slider change or auto-segment init).
  // Cancels any in-flight worker for the same segment so rapid slider changes don't pile up.
  // Cache: if this exact colorSettings was computed before (and it's not a forced recompute),
  // restore the cached result instantly instead of spawning a worker.
  useEffect(() => {
    if (!state.sourceImage || !globalSegMap || state.dirty.size === 0) return;

    for (const segmentId of state.dirty) {
      // Cancel stale in-flight worker for this segment
      const existing = quantizeWorkersRef.current.get(segmentId);
      if (existing) { existing.terminate(); quantizeWorkersRef.current.delete(segmentId); }

      const segment = state.segments.find(s => s.id === segmentId);
      if (!segment) { dispatch({ type: 'CLEAR_DIRTY', segmentId }); continue; }

      const cacheKey = `${segment.colorSettings.targetColorCount}:${segment.colorSettings.colorSpace}`;
      const segCache = quantizeCacheRef.current.get(segmentId);

      if (!state.forceRecompute.has(segmentId) && segCache?.has(cacheKey)) {
        // Cache hit — re-apply smoothing on main thread, no k-means worker needed
        const cached = segCache.get(cacheKey)!;
        applySmoothing(segmentId, cached.rawClusterIds, cached.clusters, cached.bbox, segment.smoothing, globalSegMap!, state.sourceImage!.width, dispatch);
        dispatch({ type: 'CLEAR_DIRTY', segmentId });
        continue;
      }

      // Force recompute: drop the stale cache entry for this key so fresh result is stored
      if (state.forceRecompute.has(segmentId)) {
        segCache?.delete(cacheKey);
      }

      const cm = clusteredMapsRef.current.get(segmentId);
      const lockedColors: ([number, number, number] | null)[] = cm
        ? cm.clusters.map(c => c.locked ? c.rgbColor : null)
        : [];

      const worker = new Worker(
        new URL('../workers/quantize.worker.ts', import.meta.url),
        { type: 'module' },
      );
      quantizeWorkersRef.current.set(segmentId, worker);

      worker.onmessage = (evt) => {
        quantizeWorkersRef.current.delete(segmentId);
        const { clusterIds: rawBuf, clusters } = evt.data;
        const rawClusterIds = new Uint8Array(rawBuf);
        // Store raw result in cache (keyed without smoothing — smoothing is applied separately)
        if (!quantizeCacheRef.current.has(segmentId)) {
          quantizeCacheRef.current.set(segmentId, new Map());
        }
        quantizeCacheRef.current.get(segmentId)!.set(cacheKey, { rawClusterIds, clusters, bbox: segment.boundingBox });
        // Apply smoothing synchronously on main thread
        if (globalSegMap && state.sourceImage) {
          applySmoothing(segmentId, rawClusterIds, clusters, segment.boundingBox, segment.smoothing, globalSegMap, state.sourceImage.width, dispatch);
        }
        dispatch({ type: 'CLEAR_DIRTY', segmentId });
        worker.terminate();
      };
      worker.onerror = (err) => {
        quantizeWorkersRef.current.delete(segmentId);
        console.error('[QuantizeWorker] Recompute failed for segment', segmentId, ':', err);
        dispatch({ type: 'CLEAR_DIRTY', segmentId });
        worker.terminate();
      };

      const imgBuf = state.sourceImage.data.buffer.slice(0);
      const segBuf = globalSegMap.ids.buffer.slice(0);
      worker.postMessage(
        {
          type: 'quantize',
          imageData: imgBuf,
          width: state.sourceImage.width,
          height: state.sourceImage.height,
          segmentIds: segBuf,
          segmentId,
          bbox: segment.boundingBox,
          settings: segment.colorSettings,
          lockedColors,
        },
        { transfer: [imgBuf, segBuf] },
      );
    }
  }, [state.dirty, state.forceRecompute, state.segments, state.sourceImage, dispatch]);

  // Re-apply smoothing for any segment where only the smoothing value changed.
  // Reads raw k-means result from cache — no worker needed.
  useEffect(() => {
    if (!state.sourceImage || !globalSegMap || state.smoothDirty.size === 0) return;

    for (const segmentId of state.smoothDirty) {
      const segment = state.segments.find(s => s.id === segmentId);
      if (!segment) { dispatch({ type: 'CLEAR_SMOOTH_DIRTY', segmentId }); continue; }

      const cacheKey = `${segment.colorSettings.targetColorCount}:${segment.colorSettings.colorSpace}`;
      const cached = quantizeCacheRef.current.get(segmentId)?.get(cacheKey);
      if (!cached) {
        // No cached raw result yet — k-means hasn't run, nothing to do
        dispatch({ type: 'CLEAR_SMOOTH_DIRTY', segmentId });
        continue;
      }

      applySmoothing(segmentId, cached.rawClusterIds, cached.clusters, cached.bbox, segment.smoothing, globalSegMap, state.sourceImage.width, dispatch);
      dispatch({ type: 'CLEAR_SMOOTH_DIRTY', segmentId });
    }
  }, [state.smoothDirty, state.segments, state.sourceImage, dispatch]);

  // Resegment effect: re-run buildAutoSegments when REQUEST_RESEGMENT is dispatched.
  // Replaces all segments and their initial clusteredMaps but does NOT mark dirty,
  // so existing per-segment palette computation is not re-triggered.
  useEffect(() => {
    if (!state.resegmentPending || !state.sourceImage) return;
    // Reset the global pixel assignment map so buildAutoSegments starts clean
    globalSegMap = new SegmentationMap(state.sourceImage.width, state.sourceImage.height);
    // Clear quantize cache — old segment IDs are being replaced
    quantizeCacheRef.current.clear();
    // Terminate any in-flight workers from the old segments
    for (const worker of quantizeWorkersRef.current.values()) worker.terminate();
    quantizeWorkersRef.current.clear();

    const { segments, clusteredMaps } = buildAutoSegments(state.sourceImage, globalSegMap, autoSegmentCountRef.current);
    if (segments.length === 0) {
      console.error('[AutoSegment] Resegment produced no clusters.');
      dispatch({ type: 'APPLY_RESEGMENT', segments: [], clusteredMaps: new Map() });
      return;
    }
    dispatch({ type: 'APPLY_RESEGMENT', segments, clusteredMaps });
  }, [state.resegmentPending, state.sourceImage, dispatch]);

  // Merge effect: when mergePending is set, reassign pixels from fromId to toId
  useEffect(() => {
    const mp = state.mergePending;
    if (!mp || !globalSegMap || !state.sourceImage) return;
    const { fromId, toId } = mp;

    for (let i = 0; i < globalSegMap.ids.length; i++) {
      if (globalSegMap.ids[i] === fromId) globalSegMap.ids[i] = toId;
    }

    // Pixel mask of toId changed — stale cache entries are invalid
    quantizeCacheRef.current.delete(toId);
    quantizeCacheRef.current.delete(fromId);

    const { bbox } = globalSegMap.pixelsForSegment(toId);
    dispatch({ type: 'UPDATE_SEGMENT', segmentId: toId, updates: { boundingBox: bbox } });
    dispatch({ type: 'DELETE_SEGMENT', segmentId: fromId });
    dispatch({ type: 'MARK_DIRTY', segmentId: toId });
    dispatch({ type: 'CLEAR_MERGE_PENDING' });
  }, [state.mergePending, state.sourceImage, dispatch]);

  // Brush size keyboard shortcuts: [ to shrink, ] to grow (5px increments)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '[') setBrushSize(s => Math.max(1, s - 5));
      else if (e.key === ']') setBrushSize(s => Math.min(200, s + 5));
      else if (e.key === 'p') setActiveTool('paint');
      else if (e.key === 'e') setActiveTool('paint-erase');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Embedding timer
  useEffect(() => {
    if (state.stage === 'embedding') {
      embeddingStartRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - embeddingStartRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setElapsedTime(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.stage]);

  const runAutoSegment = useCallback((image: SourceImage, segMap: SegmentationMap) => {
    try {
      const { segments, clusteredMaps } = buildAutoSegments(image, segMap, autoSegmentCountRef.current);
      if (segments.length === 0) {
        console.error('[AutoSegment] k-means produced no clusters — image may be empty or degenerate.');
        return;
      }
      for (const seg of segments) {
        dispatch({ type: 'ADD_SEGMENT', segment: seg });
        // Set the initial single-cluster placeholder so the canvas shows something
        // immediately, then mark dirty so the quantize worker refines it into proper tones.
        const cm = clusteredMaps.get(seg.id);
        if (cm) dispatch({ type: 'SET_CLUSTERED_MAP', segmentId: seg.id, map: cm });
        dispatch({ type: 'MARK_DIRTY', segmentId: seg.id });
      }
      dispatch({ type: 'SET_STAGE', stage: 'editing' });
      dispatch({ type: 'SET_VIEW_MODE', viewMode: 'result' });
      dispatch({ type: 'SELECT_SEGMENT', segmentId: segments[0].id });
    } catch (err) {
      console.error('[AutoSegment] Failed to auto-segment image:', err);
    }
  }, [dispatch]);

  const startEmbedding = useCallback(async (image: SourceImage, filename: string) => {
    globalSegMap = new SegmentationMap(image.width, image.height);
    clearSamSession();
    quantizeCacheRef.current.clear();

    dispatch({ type: 'SET_IMAGE', image, filename });
    dispatch({ type: 'SET_ZOOM_AND_PAN', zoom: 1, panX: 0, panY: 0 });
    dispatch({ type: 'SET_STAGE', stage: 'embedding' });

    // Run auto-segmentation immediately (doesn't need SAM)
    runAutoSegment(image, globalSegMap);

    // Then try to load SAM in background for interactive clicks
    setSamStatus('loading');
    try {
      await loadModel();
      await computeEmbedding(image.data, image.width, image.height, pct => {
        dispatch({ type: 'SET_EMBEDDING_PROGRESS', progress: pct });
      });
      dispatch({ type: 'SET_EMBEDDING_PROGRESS', progress: null });
      dispatch({ type: 'SET_STAGE', stage: 'editing' });
      setSamStatus('ready');
    } catch (err) {
      console.error('[SAM] Model load or embedding failed — interactive segmentation disabled. Error:', err);
      dispatch({ type: 'SET_EMBEDDING_PROGRESS', progress: null });
      dispatch({ type: 'SET_STAGE', stage: 'editing' });
      setSamStatus('unavailable');
    }
  }, [dispatch, runAutoSegment]);

  const loadFile = useCallback(async (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => {
        console.error('[Canvas] Failed to decode image file:', file.name, e);
        reject(new Error(`Failed to decode ${file.name}`));
      };
      img.src = url;
    });
    const offscreen = document.createElement('canvas');
    offscreen.width = img.width;
    offscreen.height = img.height;
    const ctx = offscreen.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, img.width, img.height);
    URL.revokeObjectURL(url);

    const sourceImage: SourceImage = { width: imgData.width, height: imgData.height, data: imgData.data };
    const filename = file.name.replace(/\.[^.]+$/, '');
    await startEmbedding(sourceImage, filename);
  }, [startEmbedding]);

  const loadSample = useCallback(async () => {
    const sample = createSampleImage();
    await startEmbedding(sample, 'sample');
  }, [startEmbedding]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadFile(file);
  };

  // Get image-space coordinates from a mouse event on the canvas
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !state.sourceImage) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = state.sourceImage.width / rect.width;
    const scaleY = state.sourceImage.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (state.stage !== 'segmenting' && state.stage !== 'editing') return;
      if (!state.sourceImage) return;

      const coords = getCanvasCoords(e);
      if (!coords) return;

      const w = state.sourceImage.width;
      const h = state.sourceImage.height;
      const erasing = activeTool === 'paint-erase';

      // Initialize mask if not already present
      if (!paintMaskRef.current) {
        paintMaskRef.current = new Uint8Array(w * h);
      }

      applyBrush(coords.x, coords.y, paintMaskRef.current, erasing, w, h, brushSize, paintAllLayersRef.current ? null : globalSegMap, paintAllLayersRef.current ? null : selectedSegmentIdRef.current);
      setPaintMask(new Uint8Array(paintMaskRef.current));
      setIsPainting(true);
      isPaintingRef.current = true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.stage, state.sourceImage, activeTool, brushSize],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!state.sourceImage) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = state.sourceImage.width / rect.width;
      const scaleY = state.sourceImage.height / rect.height;
      const coords = {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY),
      };
      setCursorPos(coords);

      if (isPaintingRef.current && paintMaskRef.current && state.sourceImage) {
        const w = state.sourceImage.width;
        const h = state.sourceImage.height;
        const erasing = activeTool === 'paint-erase';
        applyBrush(coords.x, coords.y, paintMaskRef.current, erasing, w, h, brushSize, paintAllLayersRef.current ? null : globalSegMap, paintAllLayersRef.current ? null : selectedSegmentIdRef.current);
        setPaintMask(new Uint8Array(paintMaskRef.current));
      }
    },
    [state.sourceImage, activeTool, brushSize],
  );

  const handleMouseUp = useCallback(() => {
    setIsPainting(false);
    isPaintingRef.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    setCursorPos(null);
    setIsPainting(false);
    isPaintingRef.current = false;
  }, []);

  const confirmPaint = useCallback(() => {
    if (!paintMask || !globalSegMap || !state.sourceImage) return;
    const w = state.sourceImage.width;
    const h = state.sourceImage.height;
    const fullBBox = { x: 0, y: 0, width: w, height: h };

    const affected = new Set<number>();
    for (let i = 0; i < paintMask.length; i++) {
      if (paintMask[i] > 0) {
        const sid = globalSegMap.ids[i];
        if (sid !== 0) affected.add(sid);
      }
    }

    if (paintTarget === 'new') {
      const nextId = Math.max(0, ...state.segments.map(s => s.id)) + 1;
      globalSegMap.paint(paintMask, nextId, fullBBox);
      const { bbox } = globalSegMap.pixelsForSegment(nextId);
      if (bbox.width === 0 || bbox.height === 0) {
        console.error('[Canvas] Paint new segment: zero bbox, no pixels painted');
        setPaintMask(null); paintMaskRef.current = null; return;
      }
      const segment: Segment = {
        id: nextId, parentId: null, label: `Segment ${nextId}`,
        promptPoints: [],
        boundingBox: bbox,
        colorSettings: { targetColorCount: 3, colorSpace: 'lab' },
        smoothing: 0.5,
        outlineSettings: { visible: true, strokeWidth: 1.5, strokeColor: '#2b2a28' },
        visible: true,
      };
      dispatch({ type: 'ADD_SEGMENT', segment });
      dispatch({ type: 'MARK_DIRTY', segmentId: nextId });
    } else {
      const targetId = paintTarget as number;
      globalSegMap.paint(paintMask, targetId, fullBBox);
      const { bbox } = globalSegMap.pixelsForSegment(targetId);
      // Pixel mask changed — stale cache is invalid
      quantizeCacheRef.current.delete(targetId);
      dispatch({ type: 'UPDATE_SEGMENT', segmentId: targetId, updates: { boundingBox: bbox } });
      dispatch({ type: 'MARK_DIRTY', segmentId: targetId });
      affected.delete(targetId);
    }

    for (const sid of affected) {
      // These segments lost pixels — stale cache is invalid
      quantizeCacheRef.current.delete(sid);
      dispatch({ type: 'MARK_DIRTY', segmentId: sid });
    }
    setPaintMask(null); paintMaskRef.current = null;
    dispatch({ type: 'SET_VIEW_MODE', viewMode: 'result' });
  }, [paintMask, paintTarget, state.sourceImage, state.segments, dispatch]);

  // Count painted pixels for the confirm bar
  const paintedPixelCount = paintMask ? paintMask.reduce((sum, v) => sum + (v > 0 ? 1 : 0), 0) : 0;
  const hasPaint = paintedPixelCount > 0;

  // ── Upload state ─────────────────────────────────────────────────────────
  if (state.stage === 'upload') {
    return (
      <div
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', ...CHECKER_STYLE }}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <div style={{
          background: 'rgba(255,255,255,0.88)',
          borderRadius: 14,
          border: `1.5px dashed ${isDragging ? '#3d6fd6' : '#c8c3bb'}`,
          padding: '52px 44px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          textAlign: 'center',
          maxWidth: 520,
        }}>
          <svg viewBox="0 0 48 48" style={{ width: 44, height: 44, color: '#a9a49c' }} fill="none">
            <rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="17" cy="21" r="3.4" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 34l10-9 8 7 6-5 8 7" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <div>
            <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 16, letterSpacing: '-0.015em', color: '#2b2a28' }}>
              Drop artwork to cel-shade it
            </p>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: '#6f6b65', maxWidth: 320 }}>
              Rendered illustration, 3D render or photo. Everything is processed on your device — nothing is uploaded.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ padding: '9px 16px', borderRadius: 7, background: '#2b2a28', color: '#fff', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' }}
            >
              Choose file
            </button>
            <button
              onClick={loadSample}
              style={{ padding: '9px 16px', borderRadius: 7, border: '1px solid #d3cfc8', fontSize: 12, fontWeight: 500, cursor: 'pointer', background: '#fff', color: '#2b2a28' }}
            >
              Use sample
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 10, fontFamily: 'ui-monospace,Menlo,monospace', color: '#a9a49c' }}>
            PNG · JPG · up to 4096 px
          </p>
        </div>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={handleFileChange} style={{ display: 'none' }} />
      </div>
    );
  }

  const imgW = state.sourceImage?.width ?? 0;
  const imgH = state.sourceImage?.height ?? 0;
  const pct = state.embeddingProgress ?? 0;

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', ...CHECKER_STYLE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Canvas with zoom */}
      <div style={{ transform: `translate(${state.panOffset.x}px, ${state.panOffset.y}px) scale(${state.zoom})`, transformOrigin: 'center center', position: 'relative', boxShadow: '0 2px 18px rgba(0,0,0,0.14)', lineHeight: 0 }}>
        <canvas
          ref={canvasRef}
          width={imgW}
          height={imgH}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          style={{ display: 'block', cursor: state.stage === 'segmenting' || state.stage === 'editing' ? 'crosshair' : 'default' }}
        />
        <canvas
          ref={overlayRef}
          width={imgW}
          height={imgH}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        />
      </div>

      {/* Embedding progress overlay */}
      {state.stage === 'embedding' && (
        <div style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(244,243,241,0.94)',
          borderRadius: 10,
          padding: '12px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: 'center',
          boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
          minWidth: 240,
        }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#2b2a28', letterSpacing: '-0.01em' }}>
            Analyzing image…
          </p>
          <div style={{ width: '100%', height: 5, borderRadius: 3, background: '#dcd8d2', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(pct * 100)}%`, height: '100%', background: '#3d6fd6', borderRadius: 3, transition: 'width 0.2s' }} />
          </div>
          <p style={{ margin: 0, fontSize: 10.5, fontFamily: 'ui-monospace,Menlo,monospace', color: '#6f6b65' }}>
            encoder pass · {Math.round(pct * 100)}% · {elapsedTime}s elapsed
          </p>
        </div>
      )}

      {/* Floating toolbar + guide */}
      {state.stage !== 'embedding' && (
        <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          {/* Toolbar pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 3, padding: 4,
            background: '#fff', border: '1px solid #e2dfda', borderRadius: 11,
            boxShadow: '0 3px 14px rgba(0,0,0,0.09)',
          }}>
            {([
              { key: 'paint' as const, glyph: '⬤', tip: 'Paint brush — drag to select area, then assign to a segment', color: '#e07800', activeBg: '#fff4e5' },
              { key: 'paint-erase' as const, glyph: '◯', tip: 'Erase from paint selection', color: '#e07800', activeBg: '#fff4e5' },
            ]).map(tool => {
              const isActive = activeTool === tool.key;
              return (
                <button
                  key={tool.key}
                  title={tool.tip}
                  onClick={() => setActiveTool(tool.key)}
                  style={{
                    width: 32, height: 32, borderRadius: 7,
                    border: isActive ? `1.5px solid ${tool.color}` : '1.5px solid transparent',
                    background: isActive ? tool.activeBg : 'transparent',
                    cursor: 'pointer', fontSize: 15, color: isActive ? tool.color : '#6f6b65',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 600,
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f1efec'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  {tool.glyph}
                </button>
              );
            })}
            <div style={{ width: 1, height: 20, background: '#e8e5e0', margin: '0 2px' }} />
            {/* SAM status */}
            <span
              title={
                samStatus === 'ready' ? 'SAM ready — model is loaded for background processing' :
                samStatus === 'loading' ? 'SAM model is loading…' :
                samStatus === 'unavailable' ? 'SAM failed to load — interactive mask preview unavailable' :
                'SAM not started'
              }
              style={{
                padding: '2px 7px',
                fontSize: 10.5,
                fontFamily: 'ui-monospace,Menlo,monospace',
                borderRadius: 5,
                background:
                  samStatus === 'ready' ? '#eaf6ef' :
                  samStatus === 'loading' ? '#fef6e4' :
                  samStatus === 'unavailable' ? '#fcecea' : '#f1efec',
                color:
                  samStatus === 'ready' ? '#2a7a4b' :
                  samStatus === 'loading' ? '#8a6800' :
                  samStatus === 'unavailable' ? '#a03028' : '#8d8880',
              }}
            >
              {samStatus === 'ready' ? '● SAM ready' :
               samStatus === 'loading' ? '◌ SAM loading…' :
               samStatus === 'unavailable' ? '✕ SAM unavailable' : 'SAM'}
            </span>
            <div style={{ width: 1, height: 20, background: '#e8e5e0', margin: '0 2px' }} />
            <button
              title="How to use"
              onClick={() => setShowGuide(v => !v)}
              style={{
                width: 22, height: 22, borderRadius: '50%', border: '1.5px solid #c8c3bb',
                background: showGuide ? '#2b2a28' : '#fff',
                color: showGuide ? '#fff' : '#6f6b65',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginRight: 2, flexShrink: 0,
              }}
            >
              ?
            </button>
          </div>

          {/* Brush size pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
            background: '#fff', border: '1px solid #e2dfda', borderRadius: 9,
            boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
          }}>
            <span style={{ fontSize: 10, color: '#8d8880', fontFamily: 'ui-monospace,Menlo,monospace', flexShrink: 0 }}>⬤</span>
            <input
              type="range"
              min={1}
              max={200}
              step={1}
              value={brushSize}
              onChange={e => setBrushSize(parseInt(e.target.value))}
              style={{ width: 80, height: 4, accentColor: '#e07800', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 10, color: '#3d3b38', minWidth: 32, fontFamily: 'ui-monospace,Menlo,monospace', flexShrink: 0 }}>
              {brushSize}px
            </span>
            <div style={{ width: 1, height: 14, background: '#e2dfda', flexShrink: 0 }} />
            <button
              onClick={() => setPaintAllLayers(v => !v)}
              title={paintAllLayers ? 'Painting all segments — click to restrict to current segment' : 'Painting current segment only — click to paint across all segments'}
              style={{
                padding: '2px 6px', fontSize: 10, borderRadius: 4, flexShrink: 0,
                border: `1px solid ${paintAllLayers ? '#e07800' : '#e2dfda'}`,
                background: paintAllLayers ? '#fff4e5' : 'transparent',
                color: paintAllLayers ? '#e07800' : '#8d8880',
                cursor: 'pointer', fontWeight: 600,
              }}
            >
              {paintAllLayers ? 'all layers' : 'this layer'}
            </button>
          </div>

          {/* Guide panel */}
          {showGuide && (
            <div style={{
              background: '#fff', border: '1px solid #e2dfda', borderRadius: 10,
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              padding: '14px 16px', width: 340,
              fontSize: 12, lineHeight: 1.55, color: '#3d3b38',
            }}>
              <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 13, color: '#2b2a28' }}>How to use</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>①</span>
                  <span><strong>Upload an image</strong> — the app auto-segments it into colour regions immediately.</span>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>②</span>
                  <span>Select the <strong>paint tool ⬤</strong>, then drag on the canvas to paint an area you want to assign.</span>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>③</span>
                  <span>Choose a segment to assign the painted area to, or <strong>＋ New segment</strong>, then click <strong>Assign →</strong>.</span>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>④</span>
                  <span>Use the <strong>erase tool ◯</strong> to remove parts of the paint selection before confirming.</span>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>⑤</span>
                  <span>To move pixels between segments: paint the area you want to move, then assign it to the target segment.</span>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>⑥</span>
                  <span>Adjust tones and palette in the right panel. Use the <strong>−/+ buttons</strong> to resize the brush.</span>
                </div>
              </div>

              <p style={{ margin: '10px 0 0', fontSize: 10.5, fontFamily: 'ui-monospace,Menlo,monospace', color: '#a9a49c' }}>
                SAM (segment anything model) runs locally in your browser via WebGPU or WASM — no data leaves your device.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Paint confirm bar */}
      {hasPaint && (
        <div style={{
          position: 'absolute',
          bottom: 52,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 8px 6px 12px',
          borderRadius: 8,
          background: 'rgba(28,27,26,0.92)',
          color: '#fff',
          boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 11 }}>
            Paint · {paintedPixelCount.toLocaleString()} px selected
          </span>
          <select
            value={paintTarget === 'new' ? 'new' : String(paintTarget)}
            onChange={e => {
              const v = e.target.value;
              setPaintTarget(v === 'new' ? 'new' : Number(v));
            }}
            style={{
              fontSize: 11, padding: '3px 6px', borderRadius: 5,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.12)', color: '#fff',
              cursor: 'pointer',
            }}
          >
            <option value="new" style={{ background: '#1c1b1a', color: '#fff' }}>＋ New segment</option>
            {state.segments.map(s => (
              <option key={s.id} value={String(s.id)} style={{ background: '#1c1b1a', color: '#fff' }}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={confirmPaint}
            style={{ padding: '4px 10px', borderRadius: 5, border: 'none', background: '#3d6fd6', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          >
            Assign →
          </button>
          <button
            onClick={() => { setPaintMask(null); paintMaskRef.current = null; }}
            style={{ padding: '4px 9px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#fff', fontSize: 11, cursor: 'pointer' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Bottom-left readout */}
      <div style={{
        position: 'absolute',
        left: 12,
        bottom: 10,
        display: 'flex',
        gap: 10,
        fontSize: 10,
        fontFamily: 'ui-monospace,Menlo,monospace',
        color: '#7d7871',
      }}>
        {cursorPos && <span>x {cursorPos.x} · y {cursorPos.y}</span>}
        <span>{Math.round(state.zoom * 100)}%</span>
        <span>{state.stage === 'embedding' ? 'encoder running' : 'idle'}</span>
      </div>

      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={handleFileChange} style={{ display: 'none' }} />
    </div>
  );
}
