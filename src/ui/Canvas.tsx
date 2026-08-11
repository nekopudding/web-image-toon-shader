import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useProjectStore } from './hooks/useProjectStore';
import { renderToCanvas } from '../engine/compositor';
import { loadModel, computeEmbedding, decodeMask } from '../engine/sam';
import { SegmentationMap } from '../engine/segmentation-map';
import type { SourceImage, Segment, SamPoint } from '../engine/types';

// Checkerboard background via CSS
const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage: `
    linear-gradient(45deg, #eceae6 25%, transparent 25%),
    linear-gradient(-45deg, #eceae6 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #eceae6 75%),
    linear-gradient(-45deg, transparent 75%, #eceae6 75%)
  `,
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
  backgroundColor: '#e5e2dd',
};

function createSampleImage(): SourceImage {
  const w = 256;
  const h = 256;
  const data = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      // Create simple colored regions
      if (x < w / 2 && y < h / 2) {
        // Top-left: warm orange
        data[idx] = 230;
        data[idx + 1] = 120;
        data[idx + 2] = 60;
      } else if (x >= w / 2 && y < h / 2) {
        // Top-right: cool blue
        data[idx] = 60;
        data[idx + 1] = 120;
        data[idx + 2] = 220;
      } else if (x < w / 2 && y >= h / 2) {
        // Bottom-left: green
        data[idx] = 80;
        data[idx + 1] = 180;
        data[idx + 2] = 80;
      } else {
        // Bottom-right: purple
        data[idx] = 160;
        data[idx + 1] = 60;
        data[idx + 2] = 200;
      }
      // Add gradient shading
      const gradient = (x + y) / (w + h);
      data[idx] = Math.round(data[idx] * (0.7 + 0.3 * gradient));
      data[idx + 1] = Math.round(data[idx + 1] * (0.7 + 0.3 * gradient));
      data[idx + 2] = Math.round(data[idx + 2] * (0.7 + 0.3 * gradient));
      data[idx + 3] = 255;
    }
  }

  return { width: w, height: h, data };
}

// Global segmentation map
let globalSegMap: SegmentationMap | null = null;

export function Canvas(): React.ReactElement {
  const [state, dispatch] = useProjectStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const embeddingStartRef = useRef<number>(0);

  // Render to canvas when state changes
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
  }, [
    state.sourceImage,
    state.segments,
    state.clusteredMaps,
    state.contourPaths,
    state.viewMode,
  ]);

  // Render pending mask overlay
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !state.sourceImage) return;

    overlay.width = state.sourceImage.width;
    overlay.height = state.sourceImage.height;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (state.pendingMask) {
      const imgData = ctx.createImageData(overlay.width, overlay.height);
      for (let i = 0; i < state.pendingMask.length; i++) {
        if (state.pendingMask[i] > 0) {
          imgData.data[i * 4] = 61;
          imgData.data[i * 4 + 1] = 111;
          imgData.data[i * 4 + 2] = 214;
          imgData.data[i * 4 + 3] = 100;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    // Draw pending points
    for (const pt of state.pendingPoints) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = pt.label === 1 ? '#3f9e6a' : '#cf4f43';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [state.pendingMask, state.pendingPoints, state.sourceImage]);

  // Timer for embedding progress
  useEffect(() => {
    if (state.stage === 'embedding') {
      embeddingStartRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - embeddingStartRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsedTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state.stage]);

  const loadImage = useCallback(async (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });

    const offscreen = document.createElement('canvas');
    offscreen.width = img.width;
    offscreen.height = img.height;
    const ctx = offscreen.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, img.width, img.height);

    URL.revokeObjectURL(url);

    const sourceImage: SourceImage = {
      width: imgData.width,
      height: imgData.height,
      data: imgData.data,
    };

    globalSegMap = new SegmentationMap(img.width, img.height);

    const filename = file.name.replace(/\.[^.]+$/, '');
    dispatch({ type: 'SET_IMAGE', image: sourceImage, filename });
    dispatch({ type: 'SET_STAGE', stage: 'embedding' });

    // Start SAM embedding
    try {
      await loadModel();
      const embedding = await computeEmbedding(sourceImage, pct => {
        dispatch({ type: 'SET_EMBEDDING_PROGRESS', progress: pct });
      });

      const updatedImage = { ...sourceImage, embedding };
      dispatch({ type: 'SET_IMAGE', image: updatedImage, filename });
      dispatch({ type: 'SET_STAGE', stage: 'segmenting' });
      dispatch({ type: 'SET_EMBEDDING_PROGRESS', progress: null });
    } catch (err) {
      console.warn('SAM embedding failed (likely no WebGPU/WASM):', err);
      dispatch({ type: 'SET_STAGE', stage: 'segmenting' });
      dispatch({ type: 'SET_EMBEDDING_PROGRESS', progress: null });
    }
  }, [dispatch]);

  const loadSample = useCallback(async () => {
    const sample = createSampleImage();
    globalSegMap = new SegmentationMap(sample.width, sample.height);

    dispatch({ type: 'SET_IMAGE', image: sample, filename: 'sample' });
    dispatch({ type: 'SET_STAGE', stage: 'embedding' });

    try {
      await loadModel();
      const embedding = await computeEmbedding(sample, pct => {
        dispatch({ type: 'SET_EMBEDDING_PROGRESS', progress: pct });
      });

      const updatedImage = { ...sample, embedding };
      dispatch({ type: 'SET_IMAGE', image: updatedImage, filename: 'sample' });
    } catch (err) {
      console.warn('SAM embedding failed:', err);
    }

    dispatch({ type: 'SET_STAGE', stage: 'segmenting' });
    dispatch({ type: 'SET_EMBEDDING_PROGRESS', progress: null });
  }, [dispatch]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadImage(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      loadImage(file);
    }
  };

  const handleCanvasClick = useCallback(
    async (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (state.stage !== 'segmenting' && state.stage !== 'editing') return;
      if (!state.sourceImage) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = state.sourceImage.width / rect.width;
      const scaleY = state.sourceImage.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      const label: 1 | 0 = e.shiftKey ? 0 : 1;
      const point: SamPoint = { x, y, label };

      dispatch({ type: 'ADD_PENDING_POINT', point });

      // Try to decode mask if embedding exists
      if (state.sourceImage.embedding) {
        try {
          const points = [...state.pendingPoints, point];
          const mask = await decodeMask(
            state.sourceImage.embedding,
            points,
            { w: state.sourceImage.width, h: state.sourceImage.height },
          );
          dispatch({ type: 'SET_PENDING_MASK', mask });
        } catch (err) {
          console.warn('Mask decoding failed:', err);
        }
      }
    },
    [state, dispatch],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!state.sourceImage) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = state.sourceImage.width / rect.width;
      const scaleY = state.sourceImage.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      setCursorPos({ x, y });
    },
    [state.sourceImage],
  );

  const confirmSegment = useCallback(() => {
    if (!state.pendingMask || !state.sourceImage || !globalSegMap) return;

    const nextId = Math.max(0, ...state.segments.map(s => s.id)) + 1;

    // Find bbox from mask
    let minX = state.sourceImage.width;
    let minY = state.sourceImage.height;
    let maxX = 0;
    let maxY = 0;
    const w = state.sourceImage.width;

    for (let i = 0; i < state.pendingMask.length; i++) {
      if (state.pendingMask[i] > 0) {
        const px = i % w;
        const py = Math.floor(i / w);
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }

    const bbox = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };

    const segment: Segment = {
      id: nextId,
      parentId: null,
      label: `Segment ${nextId}`,
      promptPoints: [...state.pendingPoints],
      boundingBox: bbox,
      colorSettings: {
        targetColorCount: 3,
        colorSpace: 'lab',
        smoothing: 0.5,
      },
      outlineSettings: {
        visible: true,
        strokeWidth: 1.5,
        strokeColor: '#000000',
      },
      visible: true,
    };

    // Paint mask to segmentation map
    globalSegMap.paint(state.pendingMask, nextId, {
      x: 0,
      y: 0,
      width: state.sourceImage.width,
      height: state.sourceImage.height,
    });

    dispatch({ type: 'ADD_SEGMENT', segment });
    dispatch({ type: 'CLEAR_PENDING' });
    dispatch({ type: 'SET_STAGE', stage: 'editing' });

    // Trigger quantize worker
    runQuantize(nextId, segment);
  }, [state, dispatch]);

  const runQuantize = useCallback(
    (segmentId: number, segment: Segment) => {
      if (!state.sourceImage || !globalSegMap) return;

      const worker = new Worker(
        new URL('../workers/quantize.worker.ts', import.meta.url),
        { type: 'module' },
      );

      worker.onmessage = (evt) => {
        const { clusterIds, clusters, contours } = evt.data;
        const { bbox } = globalSegMap!.pixelsForSegment(segmentId);

        dispatch({
          type: 'SET_CLUSTERED_MAP',
          segmentId,
          map: {
            segmentId,
            bbox,
            clusterIds: new Uint8Array(clusterIds),
            clusters,
          },
        });

        dispatch({
          type: 'SET_CONTOUR_PATHS',
          segmentId,
          paths: contours,
        });

        dispatch({ type: 'CLEAR_DIRTY', segmentId });
        worker.terminate();
      };

      worker.onerror = (err) => {
        console.error('Quantize worker error:', err);
        worker.terminate();
      };

      const pixelData = state.sourceImage.data.buffer.slice(0);
      const segMapData = globalSegMap.ids.buffer.slice(0);
      const { bbox } = globalSegMap.pixelsForSegment(segmentId);

      worker.postMessage(
        {
          type: 'quantize',
          imageData: pixelData,
          width: state.sourceImage.width,
          height: state.sourceImage.height,
          segmentIds: segMapData,
          segmentId,
          bbox,
          settings: segment.colorSettings,
          lockedColors: [],
        },
        [pixelData, segMapData],
      );
    },
    [state.sourceImage, dispatch],
  );

  const cancelPending = () => {
    dispatch({ type: 'CLEAR_PENDING' });
  };

  // Upload stage
  if (state.stage === 'upload') {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...CHECKER_STYLE,
        }}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            border: `2px dashed ${isDragging ? '#3d6fd6' : '#c0bcb7'}`,
            padding: '48px 56px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            transition: 'border-color 0.15s',
            boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          }}
        >
          {/* Upload icon */}
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect x="4" y="4" width="40" height="40" rx="10" fill="#f4f3f1" />
            <path d="M24 30V18M24 18L18 24M24 18L30 24" stroke="#6f6b65" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 34h20" stroke="#a9a49c" strokeWidth="2" strokeLinecap="round" />
          </svg>

          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 16, color: '#2b2a28' }}>
              Drop an image here
            </p>
            <p style={{ margin: 0, fontSize: 13, color: '#8d8880' }}>
              PNG, JPEG supported
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: '9px 20px',
                fontSize: 14,
                fontWeight: 500,
                border: '1px solid #e2dfda',
                background: '#fff',
                borderRadius: 8,
                cursor: 'pointer',
                color: '#2b2a28',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f1efec'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
            >
              Choose file
            </button>
            <button
              onClick={loadSample}
              style={{
                padding: '9px 20px',
                fontSize: 14,
                fontWeight: 500,
                border: 'none',
                background: '#3d6fd6',
                borderRadius: 8,
                cursor: 'pointer',
                color: '#fff',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#3361c0'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#3d6fd6'; }}
            >
              Use sample
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>
    );
  }

  // Embedding stage
  if (state.stage === 'embedding') {
    const pct = state.embeddingProgress ?? 0;
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...CHECKER_STYLE,
        }}
      >
        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            padding: '36px 48px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 20,
            boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
            minWidth: 300,
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: '#2b2a28' }}>
            Computing image embedding…
          </p>

          <div style={{ width: '100%', background: '#f1efec', borderRadius: 100, height: 6, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.round(pct * 100)}%`,
                height: '100%',
                background: '#3d6fd6',
                borderRadius: 100,
                transition: 'width 0.2s',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 24, width: '100%', justifyContent: 'center' }}>
            <span style={{ fontSize: 13, color: '#6f6b65' }}>
              {Math.round(pct * 100)}%
            </span>
            <span style={{ fontSize: 13, color: '#a9a49c', fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {elapsedTime}s elapsed
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Active canvas
  const imgW = state.sourceImage?.width ?? 0;
  const imgH = state.sourceImage?.height ?? 0;
  const hasPending = state.pendingPoints.length > 0;

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        ...CHECKER_STYLE,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Canvas container with zoom */}
      <div
        style={{
          transform: `scale(${state.zoom})`,
          transformOrigin: 'center center',
          position: 'relative',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          lineHeight: 0,
        }}
      >
        {/* Main canvas */}
        <canvas
          ref={canvasRef}
          width={imgW}
          height={imgH}
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setCursorPos(null)}
          style={{
            display: 'block',
            cursor: state.stage === 'segmenting' || state.stage === 'editing'
              ? 'crosshair'
              : 'default',
          }}
        />

        {/* Overlay canvas for points/mask */}
        <canvas
          ref={overlayRef}
          width={imgW}
          height={imgH}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Floating tool pill */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#fff',
          border: '1px solid #e2dfda',
          borderRadius: 100,
          padding: '6px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
        }}
      >
        <span style={{ fontSize: 12, color: '#6f6b65' }}>
          {state.stage === 'segmenting' || state.stage === 'editing'
            ? 'Click to add segment point • Shift+click for negative point'
            : 'View mode'}
        </span>
      </div>

      {/* Pending segment confirm bar */}
      {hasPending && (
        <div
          style={{
            position: 'absolute',
            bottom: 48,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#fff',
            border: '1px solid #e2dfda',
            borderRadius: 12,
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          }}
        >
          <span style={{ fontSize: 13, color: '#6f6b65' }}>
            {state.pendingPoints.length} point{state.pendingPoints.length !== 1 ? 's' : ''} placed
          </span>
          <button
            onClick={cancelPending}
            style={{
              padding: '5px 12px',
              fontSize: 13,
              border: '1px solid #e2dfda',
              background: '#fff',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#6f6b65',
            }}
          >
            Cancel
          </button>
          <button
            onClick={confirmSegment}
            style={{
              padding: '5px 14px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              background: '#2b2a28',
              color: '#fff',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Add segment ⏎
          </button>
        </div>
      )}

      {/* Bottom-left readout */}
      {cursorPos && state.sourceImage && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            background: 'rgba(43,42,40,0.85)',
            color: '#fff',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 11,
            fontFamily: 'ui-monospace, Menlo, monospace',
            display: 'flex',
            gap: 12,
            backdropFilter: 'blur(4px)',
          }}
        >
          <span>{cursorPos.x}, {cursorPos.y}</span>
          <span>{Math.round(state.zoom * 100)}%</span>
        </div>
      )}

      {/* Hidden file input for drag-drop reopen */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
