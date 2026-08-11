# Cel-Shading Editor — Implementation Plan

Client-side (browser-only) tool that converts rendered artwork/photos into cel-shaded images via SAM-assisted segmentation and per-segment color quantization. This document covers implementation details for the processing pipeline — the "engine," not the UI.

---

## 1. Tech stack

**Framework/tooling**: TypeScript + React, styled with Tailwind (all Tailwind classes use the `tw-` prefix — configure via `prefix: "tw-"` in `tailwind.config`). Package manager: pnpm.

| Concern | Choice | Notes |
|---|---|---|
| Segmentation model | SlimSAM or MobileSAM via Transformers.js (onnxruntime-web) | WebGPU with WASM fallback. Avoid full SAM-ViT-H — too heavy for interactive use. |
| Inference runtime | onnxruntime-web | Loaded via Transformers.js wrapper, or directly if more control over encoder/decoder split is needed |
| Heavy compute (quantization, filtering, contour tracing) | Plain JS/TypeScript in Web Workers | Keep off main thread; canvas work + UI stay responsive |
| Rendering | Canvas 2D API | Raster preview and compositing |
| Vector export | Hand-rolled marching-squares → SVG path serialization | No external vectorization library needed; keep it in-house so it shares data structures with the raster path |
| State management | Plain reactive store (framework-agnostic; e.g. a small pub-sub store or whatever the app framework provides) | Must support scoped/partial recompute (see §7) |
| Language | TypeScript throughout | Type-checking the pixel/segment data structures avoids a whole class of off-by-one and buffer-size bugs |

No server component. No image ever leaves the browser.

---

## 2. Project structure

```
/src
  /engine
    sam.ts               # model loading, embedding cache, click → mask
    segmentation-map.ts   # SegmentationMap class, paint/query operations
    color-space.ts        # sRGB <-> Lab conversions
    quantize.ts            # k-means clustering
    cleanup.ts             # mode filter / morphological smoothing
    contours.ts             # marching squares, path simplification
    compositor.ts            # raster compositing (fill + stroke)
    svg-export.ts             # vector export serialization
    types.ts                   # shared type defs (Segment, Cluster, etc.)
  /workers
    quantize.worker.ts
    contours.worker.ts
  /store
    project-store.ts        # central state, recompute scheduling
  /ui
    ...                        # React components, Tailwind (tw- prefix); out of scope for this doc
/tests
  quantize.test.ts
  contours.test.ts
  color-space.test.ts
```

Managed with pnpm (`pnpm install`, `pnpm dev`, `pnpm test`). `/engine` and `/workers` stay framework-agnostic plain TypeScript with no React/Tailwind dependency — only `/ui` touches those.

Keep `/engine` framework-agnostic and UI-agnostic — every function here should be testable with plain pixel arrays in Node, no DOM required except where Canvas APIs are unavoidable (those get thin wrappers so the core logic is still testable).

---

## 3. Core data types

```typescript
interface SourceImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;   // RGBA, from canvas ImageData
  embedding?: Float32Array;   // cached SAM image embedding, invalidated on new upload
}

interface Segment {
  id: number;                 // 1-indexed; 0 reserved for "unassigned"
  parentId: number | null;
  label: string;
  promptPoints: SamPoint[];   // stored so mask can be re-edited later
  boundingBox: BBox;
  colorSettings: {
    targetColorCount: number;   // 2-6
    colorSpace: "lab" | "rgb";
    smoothing: number;           // 0-1, pre-quantization blur strength
  };
  outlineSettings: {
    visible: boolean;
    strokeWidth: number;
    strokeColor: string;
  };
}

interface SamPoint {
  x: number;
  y: number;
  label: 1 | 0;   // 1 = positive, 0 = negative
}

interface BBox { x: number; y: number; width: number; height: number; }

interface Cluster {
  id: number;
  segmentId: number;
  labColor: [number, number, number];
  rgbColor: [number, number, number];
  lightnessRank: number;     // 0 = darkest
  locked: boolean;
}

interface ContourPath {
  points: { x: number; y: number }[];
  type: "segment-boundary" | "shade-boundary";
  segmentId: number;
  clusterId?: number;         // present for shade-boundary paths
}
```

**`SegmentationMap`** — not a plain object, a typed-array-backed class for performance:

```typescript
class SegmentationMap {
  width: number;
  height: number;
  ids: Uint16Array;   // one entry per pixel, segment id (0 = unassigned)

  paint(mask: Uint8Array, segmentId: number, bbox: BBox): void;
  query(x: number, y: number): number;
  pixelsForSegment(segmentId: number): { indices: Uint32Array; bbox: BBox };
}
```

**`ClusteredMap`** — scoped to a segment's bounding box, not the whole image, so recompute stays cheap:

```typescript
interface ClusteredMap {
  segmentId: number;
  bbox: BBox;
  clusterIds: Uint8Array;   // one entry per pixel within bbox
  clusters: Cluster[];
}
```

---

## 4. Stage 1 — SAM segmentation

### 4.1 Model loading
- Load SlimSAM/MobileSAM via Transformers.js at app start (or on first upload) — show a one-time "loading model" state, this is a ~5-40MB download depending on chosen model, cache in IndexedDB via the browser cache so repeat visits skip the download.
- Prefer WebGPU backend, fall back to WASM automatically if unavailable (Transformers.js handles this via `device: "webgpu" | "wasm"` config — detect via `navigator.gpu` and choose accordingly).

### 4.2 Embedding computation (once per image)
- On image upload/decode, run the encoder once → `Float32Array` embedding, store on `SourceImage.embedding`.
- This is the slow step (seconds, possibly up to ~30-60s on WASM fallback for larger images/models). Surface real progress if the runtime exposes it; otherwise an indeterminate progress state with elapsed time.
- Downscale the image for the encoder pass if it exceeds the model's expected input resolution (typically 1024×1024) — SAM models expect a fixed input size, so resize + pad while preserving aspect ratio, and remember the transform to map mask coordinates back to original resolution.

### 4.3 Click → mask (interactive, per segment)
- Each click adds a `SamPoint` (positive or negative) to the *current* segment's `promptPoints`.
- Decoder call: `embedding + promptPoints → mask logits`. This should run in well under a second — no worker needed here, can run on main thread since UI needs the result immediately, but debounce rapid clicks if the user drags across the canvas.
- Threshold logits at 0 (standard SAM convention) → binary mask (`Uint8Array`, same shape as encoder input, then upscaled back to source resolution via nearest-neighbor).
- Live preview: overlay the binary mask at ~40% opacity in an accent color while the user is still adding points; don't commit to `SegmentationMap` until the user confirms (e.g. presses Enter, clicks "Add segment," or selects a new tool).

### 4.4 Committing a segment
- On confirm: allocate a new `segmentId`, create the `Segment` record, and call `SegmentationMap.paint(mask, segmentId, bbox)`.
- **Sub-segmentation**: if the user is splitting an existing segment (UI indicates "carve from parent"), only allow paint operations *within* the parent's existing pixel region — intersect the new mask with the parent's current pixel set before painting, and set `parentId` accordingly. This keeps children strictly nested inside parents in the `SegmentationMap`.
- Re-editing: if the user reopens a committed segment and adds/removes points, recompute the mask, re-paint (overwriting the old region for that id first — clear old id pixels, then paint new), and trigger downstream recompute for that segment only (see §7).

---

## 5. Stage 2 — Color quantization (per segment)

Runs in a Web Worker, triggered whenever a segment is committed/edited or its `targetColorCount`/`smoothing` changes.

### 5.1 Extract segment pixels
- Use `SegmentationMap.pixelsForSegment(id)` to get the pixel indices and bbox.
- Read RGB values for those pixels from `SourceImage.data`.

### 5.2 Pre-quantization smoothing
- Apply a small edge-preserving blur (bilateral filter, radius ~2-3px) restricted to the segment's pixels, weighted by `colorSettings.smoothing`. This prevents texture noise/dithering/jpeg artifacts from fragmenting into tiny spurious clusters. A simple separable bilateral approximation is sufficient — full bilateral is not needed at this scale.

### 5.3 Convert to Lab
Standard sRGB → linear RGB → XYZ → Lab conversion. Implement as pure functions operating on flat arrays for speed:

```typescript
function srgbToLinear(c: number): number { /* gamma expand, c in [0,1] */ }
function rgbToXyz(r: number, g: number, b: number): [number, number, number] { /* matrix multiply */ }
function xyzToLab(x: number, y: number, z: number): [number, number, number] { /* standard D65 formulas */ }
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [rl, gl, bl] = [srgbToLinear(r/255), srgbToLinear(g/255), srgbToLinear(b/255)];
  const [x, y, z] = rgbToXyz(rl, gl, bl);
  return xyzToLab(x, y, z);
}
```
(And the inverse `labToRgb` for converting cluster centroids back for display/export.)

### 5.4 K-means clustering
- k = `targetColorCount` (2–6, user-set).
- **Initialization**: k-means++ (weighted random seeding based on distance from already-chosen centroids) rather than plain random init — meaningfully more stable results for small k on skewed color distributions (e.g. mostly-skin-tone segments with a small shadow region).
- **Distance metric**: Euclidean in Lab space.
- **Convergence**: iterate until centroid movement < epsilon (e.g. 0.5 in Lab units) or a max iteration cap (e.g. 30) — cap matters more than precision here, this needs to feel instant.
- Output: `Cluster[]` with `labColor` centroids, plus a `clusterIds: Uint8Array` mapping each segment pixel to its assigned cluster.

### 5.5 Post-processing
- Sort clusters by L (lightness) ascending → assign `lightnessRank`.
- Convert each `labColor` to `rgbColor` for display/export.
- Respect `locked` clusters from a prior run: if the user manually set/locked a swatch, exclude it from re-seeding and re-clustering — treat it as a fixed centroid and only re-assign/re-fit the remaining unlocked clusters. (This means k-means needs a variant that accepts a set of frozen centroids — straightforward: initialize with the locked ones fixed, only update the unlocked centroids each iteration.)

---

## 6. Stage 3 — Boundary cleanup

Raw per-pixel cluster assignment produces speckled/ragged boundaries, especially in areas with subtle gradients. Clean before tracing contours.

- **Mode filter**: for each pixel, replace its cluster id with the majority id among its 3×3 (or 5×5) neighborhood, restricted to pixels within the same segment. Run 1-2 passes — more than that starts eroding intentional small shade details (e.g. a small highlight on an eye).
- **Small-region removal**: after the mode filter, run connected-component labeling per cluster; any component below a minimum pixel-area threshold (configurable, scale relative to segment size) gets reassigned to the cluster of its largest neighboring component. This removes stray single-pixel islands without needing more aggressive blurring.

Output: a cleaned `clusterIds` array, same shape as before, ready for contour tracing.

---

## 7. Stage 4 — Contour extraction

Two independent passes, both using marching squares:

### 7.1 Segment boundaries (structural outline)
- Input: `SegmentationMap.ids`, treating "does this pixel belong to segment N" as the binary field.
- Run marching squares over each segment's bbox region → list of closed polylines.
- Simplify with Ramer–Douglas–Peucker (tolerance ~1-2px) to reduce point count without visibly changing the outline — this matters a lot for SVG export file size and for keeping the paths editable.

### 7.2 Shade boundaries (internal cel lines)
- Input: cleaned `ClusteredMap.clusterIds` for each segment, one binary field per cluster ("does this pixel belong to cluster N").
- Same marching-squares + simplification approach, scoped to the segment's bbox.
- Store separately from segment boundaries (`ContourPath.type`) so they can be styled/toggled independently in the UI.

Marching squares implementation notes:
- Operate on a padded grid (1px border of "outside" values) to avoid edge-case boundary artifacts.
- Standard 16-case lookup table for cell configurations; handle the two ambiguous saddle cases with consistent tie-breaking (e.g. always resolve based on average value) to avoid contour discontinuities.
- Output raw pixel-grid-aligned polylines first, then simplify — don't try to smooth during tracing itself.

---

## 8. Stage 5 — Compositing and export

### 8.1 Raster preview/export (Canvas)
- For each segment, for each cluster, fill the corresponding pixel region with `cluster.rgbColor` directly into an offscreen canvas (`ImageData` write is faster than path-fill for pixel-perfect regions — use the `clusterIds` map directly rather than filling traced paths for the raster path).
- Draw outline strokes as a second pass: stroke each `ContourPath` (filtered by segment/cluster visibility + `outlineSettings`) using Canvas 2D path API (`moveTo`/`lineTo` through the polyline points), respecting per-segment `strokeWidth`/`strokeColor`.
- Composite in segment order (respecting parent/child nesting — children draw after/on top of parents).

### 8.2 Vector export (SVG)
- Each cluster's contour becomes an `<path>` with `fill` = cluster color, `fill-rule="evenodd"` if a cluster region has holes (e.g. a ring-shaped shadow).
- Each visible outline contour becomes a separate `<path>` with `fill="none"` and the configured stroke.
- Group by segment (`<g id="segment-{label}">`) if "keep segments as groups" export option is chosen; otherwise flatten to a single `<g>` in z-order.
- Coordinates: emit directly in source-image pixel space, set `viewBox` accordingly — no extra scaling needed.

---

## 9. State management and recompute scoping

This is the detail that makes or breaks perceived performance. Recompute must be scoped as narrowly as possible:

| User action | What reruns |
|---|---|
| New image uploaded | Everything (new embedding, all segments cleared) |
| New segment committed | Stages 2-4 for that segment only |
| Existing segment's mask edited (points added/removed) | Stage 1 repaint for that segment + stages 2-4 for that segment (and any children, since their pixel region may have changed) |
| `targetColorCount` or `smoothing` changed | Stages 2-4 for that segment only |
| A cluster swatch manually recolored/locked | Stage 2 re-fit (locked-aware) + stages 3-4 for that segment only |
| Outline stroke width/color changed | Recomposite only (stage 5) — no need to re-quantize or re-trace |
| Outline visibility toggled | Recomposite only |
| Segment reordered (z-order) | Recomposite only |

Implementation approach: a simple dependency-tagged store where each segment's derived data (`ClusteredMap`, `ContourPath[]`) is invalidated and lazily recomputed on next render/read, keyed by segment id. Avoid a global "dirty" flag — track dirtiness per segment.

---

## 10. Performance considerations

- **Web Workers for stages 2-4.** Quantization + cleanup + contour tracing should never block the main thread — post the relevant pixel buffers (via `Transferable`/`ArrayBuffer` transfer, not copy) to a worker, return results the same way.
- **Typed arrays everywhere.** Avoid arrays-of-objects for per-pixel data; `Uint8Array`/`Uint16Array`/`Float32Array` throughout the hot paths.
- **Segment-scoped buffers.** Never allocate a full-image-sized buffer for a single segment's cluster map — always allocate at `bbox` size and offset accordingly. This matters a lot for images with many small segments (e.g. detailed character line art with dozens of clothing/accessory pieces).
- **Debounce slider inputs** (color count, smoothing) so quantization doesn't rerun on every intermediate slider tick — recompute on release or after a short idle delay, with a lightweight preview (e.g. last computed state) shown during drag.
- **SAM encoder pass is the one unavoidable slow step** — see §4.2. Everything downstream should feel instant by comparison; if it doesn't, that's a signal something is running on the main thread that shouldn't be.

---

## 11. Testing strategy

- **Unit tests, pure functions**: color space conversions (round-trip RGB→Lab→RGB within tolerance), k-means convergence on synthetic clustered data, marching squares against known shapes (circle, square with hole) with expected contour point counts/areas.
- **Golden-image tests**: run the full pipeline on a handful of fixed sample images (flat-color test image, gradient test image, a real character illustration) and compare quantized output against a checked-in reference within a pixel-difference tolerance — catches regressions in the clustering/cleanup/contour chain.
- **Manual QA focus areas**: skin-tone gradients (common failure mode for naive quantization — banding or incorrect hue shifts), hair with fine strands (segmentation edge quality), semi-transparent/glow elements (may not fit the flat-region model well — worth explicitly deciding this is out of scope for v1 rather than fighting it).

---

## 12. Suggested build order (milestones)

1. **Static pipeline, no SAM** — hardcode one full-image "segment," get quantization → cleanup → contour → composite working end-to-end on a single region. Validates stages 2-5 in isolation.
2. **SAM integration** — model loading, embedding cache, click → mask, single-segment commit. Validates stage 1 and the `SegmentationMap`.
3. **Multi-segment + sub-segmentation** — parent/child nesting, per-segment independent color settings.
4. **Recompute scoping** — move quantization/contours into workers, wire up the dependency-tagged invalidation from §9.
5. **Export** — raster PNG, then SVG.
6. **Polish** — locked swatches, shade-role auto-labeling, smoothing controls, small-region cleanup tuning against real character art samples.

Building in this order means the visually-hardest problem (quantization + cel-look quality) gets validated early against a trivial segmentation, before adding the complexity of interactive masking on top.
