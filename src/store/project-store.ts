import type {
  AppStage,
  ViewMode,
  SourceImage,
  Segment,
  ClusteredMap,
  ContourPath,
  SamPoint,
} from '../engine/types';

export interface ProjectState {
  stage: AppStage;
  viewMode: ViewMode;
  sourceImage: SourceImage | null;
  segments: Segment[];
  selectedSegmentId: number | null;
  clusteredMaps: Map<number, ClusteredMap>;
  contourPaths: Map<number, ContourPath[]>;
  pendingPoints: SamPoint[];
  pendingMask: Uint8Array | null;
  embeddingProgress: number | null; // 0-1 or null
  zoom: number;
  panOffset: { x: number; y: number };
  filename: string;
  exportOpen: boolean;
  dirty: Set<number>; // segment ids needing k-means recompute
  forceRecompute: Set<number>; // subset of dirty — bypass cache
  smoothDirty: Set<number>; // segment ids needing smoothing re-applied (no k-means rerun)
  resegmentPending: boolean; // triggers Canvas to re-run buildAutoSegments
  autoSegmentCount: number; // how many top-level segments buildAutoSegments produces
  history: SnapshotState[];
  historyIndex: number;
  canvasContainerSize: { w: number; h: number } | null;
  mergePending: { fromId: number; toId: number } | null;
}

// Serializable snapshot (no circular refs)
interface SnapshotState {
  stage: AppStage;
  viewMode: ViewMode;
  segments: Segment[];
  selectedSegmentId: number | null;
  clusteredMaps: Map<number, ClusteredMap>;
  contourPaths: Map<number, ContourPath[]>;
  zoom: number;
  filename: string;
}

export type ProjectAction =
  | { type: 'SET_IMAGE'; image: SourceImage; filename: string }
  | { type: 'SET_STAGE'; stage: AppStage }
  | { type: 'SET_VIEW_MODE'; viewMode: ViewMode }
  | { type: 'SET_EMBEDDING_PROGRESS'; progress: number | null }
  | { type: 'ADD_PENDING_POINT'; point: SamPoint }
  | { type: 'SET_PENDING_MASK'; mask: Uint8Array | null }
  | { type: 'CLEAR_PENDING' }
  | { type: 'ADD_SEGMENT'; segment: Segment }
  | { type: 'UPDATE_SEGMENT'; segmentId: number; updates: Partial<Segment> }
  | { type: 'DELETE_SEGMENT'; segmentId: number }
  | { type: 'SELECT_SEGMENT'; segmentId: number | null }
  | { type: 'SET_CLUSTERED_MAP'; segmentId: number; map: ClusteredMap }
  | { type: 'SET_CONTOUR_PATHS'; segmentId: number; paths: ContourPath[] }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'SET_ZOOM_AND_PAN'; zoom: number; panX: number; panY: number }
  | { type: 'SET_FILENAME'; filename: string }
  | { type: 'SET_EXPORT_OPEN'; open: boolean }
  | { type: 'MARK_DIRTY'; segmentId: number }
  | { type: 'CLEAR_DIRTY'; segmentId: number }
  | { type: 'CLEAR_SMOOTH_DIRTY'; segmentId: number }
  | { type: 'FORCE_RECOMPUTE'; segmentId: number }
  | { type: 'REQUEST_RESEGMENT' }
  | { type: 'APPLY_RESEGMENT'; segments: Segment[]; clusteredMaps: Map<number, ClusteredMap> }
  | { type: 'SET_AUTO_SEGMENT_COUNT'; count: number }
  | { type: 'SET_CONTAINER_SIZE'; w: number; h: number }
  | { type: 'REQUEST_MERGE'; fromId: number; toId: number }
  | { type: 'CLEAR_MERGE_PENDING' }
  | { type: 'UNDO' }
  | { type: 'REDO' };

const MAX_HISTORY = 50;

function createInitialState(): ProjectState {
  return {
    stage: 'upload',
    viewMode: 'original',
    sourceImage: null,
    segments: [],
    selectedSegmentId: null,
    clusteredMaps: new Map(),
    contourPaths: new Map(),
    pendingPoints: [],
    pendingMask: null,
    embeddingProgress: null,
    zoom: 1,
    panOffset: { x: 0, y: 0 },
    filename: 'untitled',
    exportOpen: false,
    dirty: new Set(),
    forceRecompute: new Set(),
    smoothDirty: new Set(),
    resegmentPending: false,
    autoSegmentCount: 3,
    history: [],
    historyIndex: -1,
    canvasContainerSize: null,
    mergePending: null,
  };
}

function snapshot(state: ProjectState): SnapshotState {
  return {
    stage: state.stage,
    viewMode: state.viewMode,
    segments: JSON.parse(JSON.stringify(state.segments)),
    selectedSegmentId: state.selectedSegmentId,
    clusteredMaps: new Map(state.clusteredMaps),
    contourPaths: new Map(state.contourPaths),
    zoom: state.zoom,
    filename: state.filename,
  };
}

function applySnapshot(state: ProjectState, snap: SnapshotState): ProjectState {
  return {
    ...state,
    stage: snap.stage,
    viewMode: snap.viewMode,
    segments: snap.segments,
    selectedSegmentId: snap.selectedSegmentId,
    clusteredMaps: snap.clusteredMaps,
    contourPaths: snap.contourPaths,
    zoom: snap.zoom,
    filename: snap.filename,
  };
}

export class ProjectStore {
  private state: ProjectState;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.state = createInitialState();
  }

  getState(): ProjectState {
    return this.state;
  }

  setState(updater: (s: ProjectState) => Partial<ProjectState>): void {
    const updates = updater(this.state);
    this.state = { ...this.state, ...updates };
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private pushHistory(): void {
    const snap = snapshot(this.state);
    const newHistory = this.state.history.slice(0, this.state.historyIndex + 1);
    newHistory.push(snap);
    if (newHistory.length > MAX_HISTORY) {
      newHistory.shift();
    }
    this.state = {
      ...this.state,
      history: newHistory,
      historyIndex: newHistory.length - 1,
    };
  }

  dispatch(action: ProjectAction): void {
    const prev = this.state;

    switch (action.type) {
      case 'SET_IMAGE': {
        this.state = {
          ...this.state,
          sourceImage: action.image,
          filename: action.filename,
          segments: [],
          clusteredMaps: new Map(),
          contourPaths: new Map(),
          dirty: new Set(),
          forceRecompute: new Set(),
          smoothDirty: new Set(),
          resegmentPending: false,
          pendingPoints: [],
          pendingMask: null,
        };
        break;
      }

      case 'SET_STAGE': {
        this.state = { ...this.state, stage: action.stage };
        break;
      }

      case 'SET_VIEW_MODE': {
        this.state = { ...this.state, viewMode: action.viewMode };
        break;
      }

      case 'SET_EMBEDDING_PROGRESS': {
        this.state = { ...this.state, embeddingProgress: action.progress };
        break;
      }

      case 'ADD_PENDING_POINT': {
        this.state = {
          ...this.state,
          pendingPoints: [...this.state.pendingPoints, action.point],
        };
        break;
      }

      case 'SET_PENDING_MASK': {
        this.state = { ...this.state, pendingMask: action.mask };
        break;
      }

      case 'CLEAR_PENDING': {
        this.state = { ...this.state, pendingPoints: [], pendingMask: null };
        break;
      }

      case 'ADD_SEGMENT': {
        this.pushHistory();
        this.state = {
          ...this.state,
          segments: [...this.state.segments, action.segment],
          selectedSegmentId: action.segment.id,
        };
        break;
      }

      case 'UPDATE_SEGMENT': {
        this.pushHistory();
        const prevSeg = this.state.segments.find(s => s.id === action.segmentId);
        const colorSettingsChanged =
          action.updates.colorSettings !== undefined &&
          prevSeg !== undefined &&
          JSON.stringify(action.updates.colorSettings) !== JSON.stringify(prevSeg.colorSettings);
        const smoothingChanged =
          action.updates.smoothing !== undefined &&
          prevSeg !== undefined &&
          action.updates.smoothing !== prevSeg.smoothing;
        this.state = {
          ...this.state,
          segments: this.state.segments.map(s =>
            s.id === action.segmentId ? { ...s, ...action.updates } : s,
          ),
          dirty: colorSettingsChanged
            ? new Set([...this.state.dirty, action.segmentId])
            : this.state.dirty,
          smoothDirty: smoothingChanged
            ? new Set([...this.state.smoothDirty, action.segmentId])
            : this.state.smoothDirty,
        };
        break;
      }

      case 'DELETE_SEGMENT': {
        this.pushHistory();
        const newMaps = new Map(this.state.clusteredMaps);
        newMaps.delete(action.segmentId);
        const newPaths = new Map(this.state.contourPaths);
        newPaths.delete(action.segmentId);
        this.state = {
          ...this.state,
          segments: this.state.segments.filter(s => s.id !== action.segmentId),
          clusteredMaps: newMaps,
          contourPaths: newPaths,
          selectedSegmentId:
            this.state.selectedSegmentId === action.segmentId
              ? null
              : this.state.selectedSegmentId,
        };
        break;
      }

      case 'SELECT_SEGMENT': {
        this.state = {
          ...this.state,
          selectedSegmentId: action.segmentId,
          pendingPoints: [],
          pendingMask: null,
        };
        break;
      }

      case 'SET_CLUSTERED_MAP': {
        const newMaps = new Map(this.state.clusteredMaps);
        newMaps.set(action.segmentId, action.map);
        this.state = { ...this.state, clusteredMaps: newMaps };
        break;
      }

      case 'SET_CONTOUR_PATHS': {
        const newPaths = new Map(this.state.contourPaths);
        newPaths.set(action.segmentId, action.paths);
        this.state = { ...this.state, contourPaths: newPaths };
        break;
      }

      case 'SET_ZOOM': {
        this.state = { ...this.state, zoom: action.zoom };
        break;
      }

      case 'SET_ZOOM_AND_PAN': {
        this.state = {
          ...this.state,
          zoom: action.zoom,
          panOffset: { x: action.panX, y: action.panY },
        };
        break;
      }

      case 'SET_CONTAINER_SIZE': {
        this.state = {
          ...this.state,
          canvasContainerSize: { w: action.w, h: action.h },
        };
        break;
      }

      case 'SET_FILENAME': {
        this.state = { ...this.state, filename: action.filename };
        break;
      }

      case 'SET_EXPORT_OPEN': {
        this.state = { ...this.state, exportOpen: action.open };
        break;
      }

      case 'MARK_DIRTY': {
        const newDirty = new Set(this.state.dirty);
        newDirty.add(action.segmentId);
        this.state = { ...this.state, dirty: newDirty };
        break;
      }

      case 'CLEAR_DIRTY': {
        const newDirty = new Set(this.state.dirty);
        newDirty.delete(action.segmentId);
        const newForce = new Set(this.state.forceRecompute);
        newForce.delete(action.segmentId);
        this.state = { ...this.state, dirty: newDirty, forceRecompute: newForce };
        break;
      }

      case 'CLEAR_SMOOTH_DIRTY': {
        const newSmoothDirty = new Set(this.state.smoothDirty);
        newSmoothDirty.delete(action.segmentId);
        this.state = { ...this.state, smoothDirty: newSmoothDirty };
        break;
      }

      case 'FORCE_RECOMPUTE': {
        const newDirty = new Set(this.state.dirty);
        newDirty.add(action.segmentId);
        const newForce = new Set(this.state.forceRecompute);
        newForce.add(action.segmentId);
        this.state = { ...this.state, dirty: newDirty, forceRecompute: newForce };
        break;
      }

      case 'REQUEST_RESEGMENT': {
        this.state = { ...this.state, resegmentPending: true };
        break;
      }

      case 'APPLY_RESEGMENT': {
        this.pushHistory();
        this.state = {
          ...this.state,
          segments: action.segments,
          clusteredMaps: action.clusteredMaps,
          contourPaths: new Map(),
          dirty: new Set(),
          forceRecompute: new Set(),
          smoothDirty: new Set(),
          selectedSegmentId: action.segments[0]?.id ?? null,
          resegmentPending: false,
        };
        break;
      }

      case 'SET_AUTO_SEGMENT_COUNT': {
        this.state = { ...this.state, autoSegmentCount: Math.max(1, Math.min(10, action.count)) };
        break;
      }

      case 'REQUEST_MERGE': {
        this.state = { ...this.state, mergePending: { fromId: action.fromId, toId: action.toId } };
        break;
      }

      case 'CLEAR_MERGE_PENDING': {
        this.state = { ...this.state, mergePending: null };
        break;
      }

      case 'UNDO': {
        if (this.state.historyIndex > 0) {
          const newIndex = this.state.historyIndex - 1;
          const snap = this.state.history[newIndex];
          this.state = applySnapshot(
            { ...this.state, historyIndex: newIndex },
            snap,
          );
        }
        break;
      }

      case 'REDO': {
        if (this.state.historyIndex < this.state.history.length - 1) {
          const newIndex = this.state.historyIndex + 1;
          const snap = this.state.history[newIndex];
          this.state = applySnapshot(
            { ...this.state, historyIndex: newIndex },
            snap,
          );
        }
        break;
      }
    }

    if (this.state !== prev) {
      this.notify();
    }
  }
}

export const store = new ProjectStore();
