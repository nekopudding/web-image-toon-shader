export interface SourceImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  embedding?: Float32Array;
}

export interface SamPoint {
  x: number;
  y: number;
  label: 1 | 0;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Segment {
  id: number;
  parentId: number | null;
  label: string;
  promptPoints: SamPoint[];
  boundingBox: BBox;
  colorSettings: {
    targetColorCount: number; // 2-6
    colorSpace: 'lab' | 'rgb';
  };
  smoothing: number; // 0-1, applied post-k-means on main thread
  outlineSettings: {
    visible: boolean;
    strokeWidth: number;
    strokeColor: string;
  };
  visible: boolean;
}

export interface Cluster {
  id: number;
  segmentId: number;
  labColor: [number, number, number];
  rgbColor: [number, number, number];
  lightnessRank: number;
  locked: boolean;
  manualColor?: string; // hex override
}

export interface ContourPath {
  points: { x: number; y: number }[];
  type: 'segment-boundary' | 'shade-boundary';
  segmentId: number;
  clusterId?: number;
}

export interface ClusteredMap {
  segmentId: number;
  bbox: BBox;
  clusterIds: Uint8Array;
  clusters: Cluster[];
}

export type AppStage = 'upload' | 'embedding' | 'segmenting' | 'editing';
export type ViewMode = 'original' | 'segments' | 'result';
