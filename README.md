# Web Image Toon Shader

**[Live demo →](https://nekopudding.github.io/web-image-toon-shader/)**

A browser-based cel-shading editor. Upload a rendered illustration, 3D render, or photo and turn it into a flat, cel-shaded image — entirely on your device, nothing uploaded.

## What it does

1. **Auto-segments** the image on load using k-means color clustering (Highlight / Base / Shadow regions appear immediately).
2. **Paint-to-reassign** — drag a brush over pixels to select them, then assign the selection to an existing segment or a new one. Brush size is adjustable via slider or `[` / `]` keys. Toggle between painting the current segment only or all layers.
3. **Color quantization** — each segment is independently quantized into 2–6 flat tones using k-means in CIE Lab space.
4. **Contour tracing** — marching-squares traces the boundary of each segment and tone region; Ramer-Douglas-Peucker simplifies the paths.
5. **Export** — download as PNG or grouped SVG.

## Technical concepts

### SAM — Segment Anything Model (SlimSAM-50)

SAM is a foundation model for interactive image segmentation. It works in two phases:

- **Embedding phase** — the image is encoded into a dense feature map (`image_embeddings`) once, which is stored in memory. This is the slow step (~5–30s depending on hardware).
- **Decode phase** — given a set of point prompts (positive = include, negative = exclude), the model decodes a binary mask in milliseconds by combining the stored embeddings with the point inputs.

The app uses `Xenova/slimsam-50-uniform` from Hugging Face, running via `@huggingface/transformers` in the browser. It prefers WebGPU (fast) and falls back to WASM (slower but universally supported).

### CIE Lab color space

Lab separates lightness (L*) from color (a*, b*), matching how the human visual system works. Clustering in Lab produces perceptually uniform tone separation — highlights, midtones, and shadows naturally separate — whereas clustering in RGB can produce muddy or unbalanced groupings.

### k-means++

Color quantization uses k-means++ initialization (spread initial centroids to avoid bad random starts) with a 30-iteration cap and epsilon convergence. Locked palette entries are pinned as fixed centroids that don't move during iteration.

### Marching squares

Contour tracing uses a 16-case marching-squares lookup on a 1-pixel-padded binary field. This produces closed chains of 2D points around each region. Ramer-Douglas-Peucker with ε=0.8px then simplifies the chains for clean SVG export.

### Web Worker pipeline

Quantization and contour tracing run in a `Worker` so the UI stays responsive during computation. The image pixel data and segmentation map are transferred (not copied) to the worker via `ArrayBuffer` transfer. The canvas renders an immediate single-color placeholder while the worker computes.

## Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript 7 |
| Build | Vite 8 |
| Package manager | pnpm |
| ML inference | `@huggingface/transformers` v4 |
| Rendering | Canvas 2D |
| Off-thread compute | Web Workers |

## Getting started

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`, drop in an image, and use the `+` tool to place point prompts on the canvas.

## Usage

1. Drop or choose an image. Three initial segments appear automatically (Highlight / Base / Shadow).
2. Select a segment in the left panel, then use the **paint tool `⬤`** to drag over the pixels you want to reassign. The brush only marks pixels belonging to the selected segment by default — toggle **all layers** to paint across all segments.
3. Switch to **erase `◯`** to remove parts of the selection before confirming. Adjust brush size with the slider or `[` / `]` keys (`p` / `e` to toggle tools).
4. When the selection looks right, choose a target in the assign bar and click **Assign →** — or pick **＋ New segment** to create one from the painted area.
5. To remove a segment, click **Delete segment** in the right panel and choose which segment to merge its pixels into.
6. Adjust **Tones** (2–6) per segment in the right panel. Changes re-quantize in the background.
7. Switch to **Segments** view to see colored region overlays; **Result** to see the flat cel-shaded output.
8. Click **Export** to download PNG or SVG.
