# CLAUDE.md — Development notes for this codebase

## Stack

- **Runtime**: React 19 + TypeScript 7 + Vite 8
- **Package manager**: pnpm
- **Styling**: Inline styles only. Tailwind v4 is installed but its `prefix` option does NOT accept hyphens (`tw-` is invalid). Since all components use inline styles, Tailwind is effectively unused.
- **ML**: `@huggingface/transformers` v4 — SlimSAM-50 for interactive segmentation, via WebGPU with WASM fallback.

## Dev server

```
pnpm dev
```

## Key architectural rules

### State management
- `src/store/project-store.ts` — plain pub-sub store, no Redux/Zustand.
- Undo/redo is snapshot-based (cap 50). Only `ADD_SEGMENT`, `UPDATE_SEGMENT`, `DELETE_SEGMENT` push history.
- `SELECT_SEGMENT` always clears `pendingPoints` and `pendingMask` — do not rely on pending state surviving a segment switch.

### SAM (Segment Anything Model)
- Module-level state in `src/engine/sam.ts` holds the embedding tensors (`samSession`). These are NOT serializable and must never be stored in React/Redux state.
- `computeEmbedding()` populates `samSession`. `clearSamSession()` wipes it (called on new image load).
- `decodeMask()` returns `Uint8Array | null`. The mask is height×width, row-major, values 0 or 255.
- `post_process_masks` may return either `boolean[][]` (2D, rows×cols) or `boolean[]` (flat) depending on transformers.js version — the decode function handles both.
- If `decodeMask` returns null and SAM badge shows ready: check the console for `[SAM]` prefixed warnings. An all-zero mask triggers a specific warning rather than an error.

### Quantization worker
- `src/workers/quantize.worker.ts` — runs k-means in Lab/RGB space off the main thread.
- Triggered two ways: (1) `confirmSegment` in Canvas.tsx launches it inline; (2) the dirty-segment `useEffect` in Canvas.tsx launches it for any segment in `state.dirty`.
- Buffer transfer: always `.slice(0)` image and segMap buffers before `postMessage` so the originals remain usable.
- Active workers are tracked in `quantizeWorkersRef` (Canvas.tsx). When a segment becomes dirty again (slider changed), the stale worker is terminated before launching a new one.

### Canvas transform
- Pan+zoom via CSS `transform: translate(panX, panY) scale(zoom)` with `transformOrigin: center center`.
- Zoom-toward-cursor math: `newPan = cursor - (newZoom/oldZoom) * (cursor - oldPan)`.
- Wheel handler reads `zoomRef`/`panRef` (not state directly) to avoid stale closures and prevent the listener from being torn down/re-added on every scroll.

### Compositor
- `src/engine/compositor.ts` — `renderToCanvas` handles `original`/`segments`/`result` modes.
- **Critical**: use `ctx.drawImage(offscreenCanvas, x, y)` (not `ctx.putImageData`) for per-segment overlays. `putImageData` replaces the entire rectangle including transparent pixels, clobbering earlier-rendered segments.
- Segments whose bbox has zero width or height are skipped silently.

### React effects sizing
- All `useEffect` calls in Canvas.tsx that register DOM event listeners must have a **constant-size deps array** between renders. HMR will warn if the size changes.
- The container-size and wheel-zoom effects both use `[dispatch, state.stage]` (size 2).

## Fail-fast conventions

- **Always log failure paths** with a `[Module]` prefix so they're grep-able:
  - `console.error('[SAM] ...')` for model/decode failures
  - `console.error('[AutoSegment] ...')` for k-means issues
  - `console.error('[QuantizeWorker] ...')` for worker errors
  - `console.error('[Canvas] ...')` for image load failures
- Workers log their own errors via `worker.onerror`.
- Never swallow errors silently — if a path can fail, log it before continuing.

## TypeScript quirks

- `Uint8Array<ArrayBuffer>` (not `Uint8Array<ArrayBufferLike>`) is required in some TS7 contexts. Use explicit type annotations or `as Uint8Array<ArrayBuffer>` casts in worker output.
- `ImageData` constructor requires `Uint8ClampedArray` with a clean `ArrayBuffer` backing — use `new Uint8ClampedArray(sourceImage.data)` (copy), not `.buffer` directly.
- `allowArbitraryExtensions: true` in `tsconfig.json` is required for `import './index.css'`.
