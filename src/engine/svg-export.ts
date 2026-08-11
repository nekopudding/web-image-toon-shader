import type { Segment, ClusteredMap, ContourPath } from './types';

export function exportSvg(
  segments: Segment[],
  clusteredMaps: Map<number, ClusteredMap>,
  contourPaths: Map<number, ContourPath[]>,
  options: {
    includeStrokes: boolean;
    structure: 'groups' | 'flat';
    width: number;
    height: number;
  },
): string {
  const { includeStrokes, structure, width, height } = options;

  const pathsToSvgD = (points: { x: number; y: number }[], close = false): string => {
    if (points.length === 0) return '';
    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
    }
    if (close) d += ' Z';
    return d;
  };

  const elements: string[] = [];

  for (const segment of segments) {
    if (!segment.visible) continue;

    const cm = clusteredMaps.get(segment.id);
    const paths = contourPaths.get(segment.id) ?? [];

    const segmentElements: string[] = [];

    if (cm) {
      // Group clusters by their fill color and build polygons
      for (const cluster of cm.clusters) {
        let fillColor: string;
        if (cluster.manualColor) {
          fillColor = cluster.manualColor;
        } else {
          const [r, g, b] = cluster.rgbColor;
          fillColor = `rgb(${r},${g},${b})`;
        }

        // Find shade boundary paths for this cluster
        const clusterPaths = paths.filter(
          p => p.type === 'shade-boundary' && p.clusterId === cluster.id,
        );

        for (const cp of clusterPaths) {
          const d = pathsToSvgD(cp.points, true);
          if (d) {
            segmentElements.push(
              `    <path d="${d}" fill="${fillColor}" />`,
            );
          }
        }
      }
    }

    // Outlines
    if (includeStrokes && segment.outlineSettings.visible) {
      const outlinePaths = paths.filter(p => p.type === 'segment-boundary');
      for (const cp of outlinePaths) {
        const d = pathsToSvgD(cp.points, true);
        if (d) {
          segmentElements.push(
            `    <path d="${d}" fill="none" stroke="${segment.outlineSettings.strokeColor}" stroke-width="${segment.outlineSettings.strokeWidth}" stroke-linejoin="round" />`,
          );
        }
      }
    }

    if (structure === 'groups') {
      elements.push(
        `  <g id="segment-${segment.id}" data-label="${segment.label}">`,
        ...segmentElements,
        `  </g>`,
      );
    } else {
      elements.push(...segmentElements);
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    ...elements,
    `</svg>`,
  ].join('\n');
}
