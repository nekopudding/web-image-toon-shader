import React, { useState, useRef, useEffect } from 'react';
import { useProjectStore } from './hooks/useProjectStore';
import { exportSvg } from '../engine/svg-export';
import { renderToCanvas } from '../engine/compositor';

type Format = 'png' | 'svg';
type Scale = 1 | 2 | 4;
type Structure = 'groups' | 'flat';

export function ExportModal(): React.ReactElement | null {
  const [state, dispatch] = useProjectStore();
  const [format, setFormat] = useState<Format>('png');
  const [scale, setScale] = useState<Scale>(1);
  const [structure, setStructure] = useState<Structure>('groups');
  const [includeStrokes, setIncludeStrokes] = useState(true);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const { sourceImage } = state;

  // Render preview
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !sourceImage) return;

    renderToCanvas(
      canvas,
      sourceImage,
      state.segments,
      state.clusteredMaps,
      state.contourPaths,
      'result',
    );
  }, [sourceImage, state.segments, state.clusteredMaps, state.contourPaths]);

  if (!state.exportOpen) return null;

  const close = () => dispatch({ type: 'SET_EXPORT_OPEN', open: false });

  const handleDownload = () => {
    if (!sourceImage) return;

    if (format === 'png') {
      const offscreen = document.createElement('canvas');
      offscreen.width = sourceImage.width * scale;
      offscreen.height = sourceImage.height * scale;
      const ctx = offscreen.getContext('2d')!;
      ctx.scale(scale, scale);

      renderToCanvas(
        offscreen,
        sourceImage,
        state.segments,
        state.clusteredMaps,
        state.contourPaths,
        'result',
      );

      offscreen.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${state.filename}-cel.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    } else {
      const svgStr = exportSvg(
        state.segments,
        state.clusteredMaps,
        state.contourPaths,
        {
          includeStrokes,
          structure,
          width: sourceImage.width,
          height: sourceImage.height,
        },
      );

      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${state.filename}-cel.svg`;
      a.click();
      URL.revokeObjectURL(url);
    }

    close();
  };

  const imgW = sourceImage?.width ?? 0;
  const imgH = sourceImage?.height ?? 0;

  const cardStyle = (selected: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '16px',
    border: selected ? '2px solid #3d6fd6' : '2px solid #e2dfda',
    borderRadius: 10,
    cursor: 'pointer',
    background: selected ? '#f0f4fc' : '#fff',
    textAlign: 'center',
    transition: 'all 0.1s',
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={e => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          width: 480,
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid #e2dfda',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600, color: '#2b2a28', flex: 1 }}>
            Export
          </span>
          <button
            onClick={close}
            style={{
              width: 28,
              height: 28,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 18,
              color: '#8d8880',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Format picker */}
          <div>
            <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#8d8880', letterSpacing: '0.06em' }}>
              FORMAT
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={cardStyle(format === 'png')} onClick={() => setFormat('png')}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>🖼️</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#2b2a28' }}>PNG</div>
                <div style={{ fontSize: 12, color: '#8d8880' }}>Raster image</div>
              </div>
              <div style={cardStyle(format === 'svg')} onClick={() => setFormat('svg')}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>✦</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#2b2a28' }}>SVG</div>
                <div style={{ fontSize: 12, color: '#8d8880' }}>Vector paths</div>
              </div>
            </div>
          </div>

          {/* PNG options */}
          {format === 'png' && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#8d8880', letterSpacing: '0.06em' }}>
                SCALE
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {([1, 2, 4] as Scale[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setScale(s)}
                    style={{
                      padding: '6px 16px',
                      border: scale === s ? '2px solid #3d6fd6' : '2px solid #e2dfda',
                      background: scale === s ? '#f0f4fc' : '#fff',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 600,
                      color: scale === s ? '#3d6fd6' : '#2b2a28',
                    }}
                  >
                    {s}×
                  </button>
                ))}
                <span
                  style={{
                    alignSelf: 'center',
                    fontSize: 12,
                    color: '#8d8880',
                    fontFamily: 'ui-monospace, Menlo, monospace',
                  }}
                >
                  {imgW * scale} × {imgH * scale}px
                </span>
              </div>
            </div>
          )}

          {/* SVG options */}
          {format === 'svg' && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#8d8880', letterSpacing: '0.06em' }}>
                STRUCTURE
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([
                  { value: 'groups', label: 'Keep segments as groups' },
                  { value: 'flat', label: 'Flatten to single layer' },
                ] as { value: Structure; label: string }[]).map(opt => (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      cursor: 'pointer',
                      fontSize: 14,
                      color: '#2b2a28',
                    }}
                  >
                    <input
                      type="radio"
                      name="structure"
                      value={opt.value}
                      checked={structure === opt.value}
                      onChange={() => setStructure(opt.value)}
                      style={{ accentColor: '#3d6fd6' }}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Include strokes toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              id="include-strokes"
              checked={includeStrokes}
              onChange={e => setIncludeStrokes(e.target.checked)}
              style={{ accentColor: '#3d6fd6', width: 16, height: 16, cursor: 'pointer' }}
            />
            <label
              htmlFor="include-strokes"
              style={{ fontSize: 14, color: '#2b2a28', cursor: 'pointer' }}
            >
              Include outline strokes
            </label>
          </div>

          {/* Preview thumbnail */}
          <div>
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: '#8d8880', letterSpacing: '0.06em' }}>
              PREVIEW
            </p>
            <div
              style={{
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid #e2dfda',
                height: 120,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#f4f3f1',
              }}
            >
              <canvas
                ref={previewRef}
                width={imgW}
                height={imgH}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #e2dfda',
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={close}
            style={{
              padding: '9px 20px',
              fontSize: 14,
              border: '1px solid #e2dfda',
              background: '#fff',
              borderRadius: 8,
              cursor: 'pointer',
              color: '#6f6b65',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            style={{
              padding: '9px 20px',
              fontSize: 14,
              fontWeight: 600,
              border: 'none',
              background: '#2b2a28',
              color: '#fff',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
