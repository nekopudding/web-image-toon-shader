# Cel-Shading Editor — UI Spec

A browser-based tool that converts rendered artwork/photos (character art focus) into cel-shaded images. Workflow: upload image → click to segment objects (SAM-assisted) → set per-segment color count → review/adjust quantized shading → export.

## Overall layout

Three-panel workspace, desktop-first (min width ~1280px):

- **Left panel (~240px)**: Layers/segments list
- **Center panel (flexible, main focus)**: Canvas + toolbar
- **Right panel (~280px)**: Selected segment's properties

Top bar spans full width above all three panels: file name, undo/redo, view toggles, export button.

## Top bar

- App/file name (editable text, left-aligned)
- Undo / redo icon buttons
- View toggle group: `Original` / `Segments` / `Result` (segmented control, 3 options)
- Zoom control (percentage + fit-to-screen button)
- Primary button, right-aligned: `Export`

## Left panel — Segments list

- Header: "Segments" + a small `+ New` button (starts a fresh segmentation click)
- Scrollable list of segment rows. Each row:
  - Small color swatch (average/base color of the segment)
  - Editable label (e.g. "Hair", "Skin — face", double-click to rename)
  - Color count badge (e.g. "3 tones")
  - Visibility toggle (eye icon)
  - Row is selectable (click to select on canvas + populate right panel); selected row has an accent-colored left border
- Segments can be nested one level (parent segment with child sub-segments, slightly indented, e.g. "Character" > "Skin" > "Face highlight")
- Drag handle per row for reordering (affects paint/stacking order, not z-depth of masks)
- Empty state (no segments yet): centered icon + text "Click an object on the canvas to start segmenting" + example illustration

## Center panel — Canvas

- Large canvas area, image centered, checkerboard background outside image bounds
- Floating toolbar (top-center or left-edge, small pill-shaped bar) with tool icons:
  - Pointer/select tool
  - Add-positive-point tool (click to mark "include this")
  - Add-negative-point tool (click to mark "exclude this")
  - Pan tool
  - Each tool shows a tooltip on hover with keyboard shortcut
- While a segment mask is being refined: show the point markers overlaid on canvas (small circles, green for positive, red for negative) and a semi-transparent color overlay for the current mask preview
- Loading state during SAM embedding computation: a progress bar or spinner overlay on the canvas with text like "Analyzing image…" (this step can take up to a minute — make it feel like real progress, not a frozen screen)
- Mask generation (per click) should feel instant — no loading state needed for that, maybe a subtle flash/pulse on the updated mask region
- Bottom-left corner: small readout of cursor position / zoom level

## Right panel — Segment properties

Shown when a segment is selected. Sections stacked vertically:

1. **Segment name** — editable text field, plus parent segment breadcrumb if nested
2. **Color count** — stepper or slider, range 2–6, live-updating label ("3 colors")
3. **Color palette preview** — row of color swatches representing the current clusters for this segment, ordered light-to-dark. Each swatch:
   - Click to open a color picker (manual override / lock)
   - Small lock icon toggle (prevents recompute from changing this swatch)
4. **Shade role labels** under each swatch — small text tags: "Highlight" / "Base" / "Shadow" (auto-assigned by lightness, editable if needed)
5. **Outline settings** for this segment — toggle "Show outline," stroke width slider, stroke color swatch
6. **Advanced** (collapsed by default): color space toggle (Lab / RGB), smoothing strength slider

## Global export panel (modal or drawer, opened by top-bar Export button)

- Format choice: PNG (raster) / SVG (vector, from traced contours)
- Resolution/scale selector for PNG
- Toggle: "Include outline strokes"
- Toggle: "Flatten to single layer" vs "Keep segments as groups" (SVG only)
- Preview thumbnail of the final export
- Confirm button: `Download`

## States to design

- **Empty/upload state**: drag-and-drop zone, centered, with supported format hint (PNG/JPG)
- **Embedding in progress**: canvas with progress overlay
- **Active segmentation**: canvas with point markers + live mask preview + floating toolbar
- **Segment selected, editing colors**: right panel populated, palette swatches interactive
- **Multiple segments, nested hierarchy**: left panel showing indentation and expand/collapse carets
- **Export modal**: format options + preview

## Visual tone

Clean, tool-like, neutral — similar register to a lightweight image editor (think Figma/Photopad, not a playful consumer app). Character art will be colorful, so the chrome around it should stay quiet and desaturated so the artwork stays the visual focus. Generous canvas space; side panels compact but legible.
