import type { SourceImage, Segment, ClusteredMap, ContourPath, ViewMode } from './types';

// Segment tint colors for visualization
const TINT_COLORS = [
  [61, 111, 214],
  [214, 93, 61],
  [61, 214, 93],
  [214, 61, 158],
  [61, 195, 214],
  [158, 214, 61],
  [214, 158, 61],
  [93, 61, 214],
];

function getTintColor(segmentId: number): [number, number, number] {
  return TINT_COLORS[segmentId % TINT_COLORS.length] as [number, number, number];
}

export function renderToCanvas(
  canvas: HTMLCanvasElement,
  sourceImage: SourceImage,
  segments: Segment[],
  clusteredMaps: Map<number, ClusteredMap>,
  contourPaths: Map<number, ContourPath[]>,
  viewMode: ViewMode,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = sourceImage.width;
  canvas.height = sourceImage.height;

  if (viewMode === 'original') {
    // Draw source image directly
    const copy = new Uint8ClampedArray(sourceImage.data);
    const imgData = new ImageData(copy, sourceImage.width, sourceImage.height);
    ctx.putImageData(imgData, 0, 0);
    return;
  }

  if (viewMode === 'segments') {
    // Draw source image dimmed so segment overlays stand out clearly
    const copy = new Uint8ClampedArray(sourceImage.data);
    const imgData = new ImageData(copy, sourceImage.width, sourceImage.height);
    ctx.putImageData(imgData, 0, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(0, 0, sourceImage.width, sourceImage.height);

    // Draw solid segment fills (offscreen canvas → drawImage to avoid clobbering)
    for (const segment of segments) {
      if (!segment.visible) continue;

      const [tr, tg, tb] = getTintColor(segment.id);
      const cm = clusteredMaps.get(segment.id);

      if (cm && cm.bbox.width > 0 && cm.bbox.height > 0) {
        const offscreen = document.createElement('canvas');
        offscreen.width = cm.bbox.width;
        offscreen.height = cm.bbox.height;
        const offCtx = offscreen.getContext('2d');
        if (!offCtx) continue;
        const overlay = offCtx.createImageData(cm.bbox.width, cm.bbox.height);
        for (let i = 0; i < cm.clusterIds.length; i++) {
          // Only fill pixels that belong to a cluster (non-255 sentinel)
          if (cm.clusterIds[i] === 255) continue;
          overlay.data[i * 4] = tr;
          overlay.data[i * 4 + 1] = tg;
          overlay.data[i * 4 + 2] = tb;
          overlay.data[i * 4 + 3] = 210;
        }
        offCtx.putImageData(overlay, 0, 0);
        ctx.drawImage(offscreen, cm.bbox.x, cm.bbox.y);
      }

      // Draw outlines
      if (segment.outlineSettings.visible) {
        const paths = contourPaths.get(segment.id) ?? [];
        ctx.strokeStyle = segment.outlineSettings.strokeColor;
        ctx.lineWidth = segment.outlineSettings.strokeWidth;
        ctx.lineJoin = 'round';

        for (const path of paths) {
          if (path.type !== 'segment-boundary') continue;
          if (path.points.length < 2) continue;

          ctx.beginPath();
          ctx.moveTo(path.points[0].x, path.points[0].y);
          for (let i = 1; i < path.points.length; i++) {
            ctx.lineTo(path.points[i].x, path.points[i].y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
    return;
  }

  if (viewMode === 'result') {
    // Start with white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, sourceImage.width, sourceImage.height);

    // Each segment is composited via a per-segment offscreen canvas so that
    // transparent (non-member) pixels don't clobber previously rendered segments.
    for (const segment of segments) {
      if (!segment.visible) continue;

      const cm = clusteredMaps.get(segment.id);
      if (!cm || cm.bbox.width <= 0 || cm.bbox.height <= 0) continue;

      // Build segment overlay on an offscreen canvas
      const offscreen = document.createElement('canvas');
      offscreen.width = cm.bbox.width;
      offscreen.height = cm.bbox.height;
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) continue;

      const overlay = offCtx.createImageData(cm.bbox.width, cm.bbox.height);

      for (let i = 0; i < cm.clusterIds.length; i++) {
        const clusterId = cm.clusterIds[i];
        const cluster = cm.clusters.find(c => c.id === clusterId);
        if (!cluster) continue;

        let r: number, g: number, b: number;
        if (cluster.manualColor) {
          const hex = cluster.manualColor.replace('#', '');
          r = parseInt(hex.substring(0, 2), 16);
          g = parseInt(hex.substring(2, 4), 16);
          b = parseInt(hex.substring(4, 6), 16);
        } else {
          [r, g, b] = cluster.rgbColor;
        }

        overlay.data[i * 4] = r;
        overlay.data[i * 4 + 1] = g;
        overlay.data[i * 4 + 2] = b;
        overlay.data[i * 4 + 3] = 255;
      }

      offCtx.putImageData(overlay, 0, 0);
      // drawImage uses source-over compositing — transparent pixels are no-ops
      ctx.drawImage(offscreen, cm.bbox.x, cm.bbox.y);
    }

    // Draw outlines on top
    for (const segment of segments) {
      if (!segment.visible || !segment.outlineSettings.visible) continue;

      const paths = contourPaths.get(segment.id) ?? [];
      ctx.strokeStyle = segment.outlineSettings.strokeColor;
      ctx.lineWidth = segment.outlineSettings.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      for (const path of paths) {
        if (path.points.length < 2) continue;

        ctx.beginPath();
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        if (path.type === 'segment-boundary') ctx.closePath();
        ctx.stroke();
      }
    }
  }
}
