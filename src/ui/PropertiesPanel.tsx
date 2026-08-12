import React, { useState } from 'react';
import { useProjectStore } from './hooks/useProjectStore';
import type { Cluster } from '../engine/types';

function InfoTip({ text }: { text: string }): React.ReactElement {
  return (
    <span
      title={text}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        borderRadius: '50%',
        border: '1px solid #c0bcb7',
        fontSize: 9,
        fontWeight: 700,
        color: '#a9a49c',
        cursor: 'default',
        userSelect: 'none',
        flexShrink: 0,
        lineHeight: 1,
        fontStyle: 'italic',
      }}
    >
      i
    </span>
  );
}

function Switch({
  checked,
  onChange,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}): React.ReactElement {
  return (
    <button
      title={title}
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 100,
        border: 'none',
        background: checked ? '#3d6fd6' : '#c0bcb7',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.15s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}): React.ReactElement {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      style={{
        width: '100%',
        height: 4,
        accentColor: '#3d6fd6',
        cursor: 'pointer',
      }}
    />
  );
}

function ColorSwatch({
  cluster,
  isSelected,
  onClick,
  onLockToggle,
}: {
  cluster: Cluster;
  isSelected: boolean;
  onClick: () => void;
  onLockToggle: () => void;
}): React.ReactElement {
  const [r, g, b] = cluster.rgbColor;
  const hexColor = cluster.manualColor ?? `rgb(${r},${g},${b})`;

  const roleLabel =
    cluster.lightnessRank === 0
      ? 'Highlight'
      : cluster.lightnessRank === 1
      ? 'Base'
      : 'Shadow';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        flex: '1 1 0',
        minWidth: 0,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          paddingBottom: '100%',
        }}
      >
        <button
          onClick={onClick}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 8,
            background: hexColor,
            border: isSelected ? '2px solid #3d6fd6' : '2px solid transparent',
            cursor: 'pointer',
            boxShadow: isSelected ? '0 0 0 2px #fff inset' : 'none',
          }}
        />
        {/* Lock icon */}
        <button
          onClick={e => { e.stopPropagation(); onLockToggle(); }}
          title={cluster.locked ? 'Unlock color' : 'Lock color'}
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            width: 16,
            height: 16,
            border: 'none',
            background: cluster.locked ? 'rgba(255,255,255,0.9)' : 'transparent',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: cluster.locked ? '#2b2a28' : 'rgba(255,255,255,0.5)',
          }}
        >
          {cluster.locked ? '🔒' : '🔓'}
        </button>
      </div>

      {/* Hex label */}
      <span
        style={{
          fontSize: 9,
          fontFamily: 'ui-monospace, Menlo, monospace',
          color: '#8d8880',
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}
      >
        {cluster.manualColor ??
          `#${cluster.rgbColor
            .map(v => Math.max(0, Math.min(255, isNaN(v) ? 0 : Math.round(v))).toString(16).padStart(2, '0'))
            .join('')}`}
      </span>

      <span style={{ fontSize: 9, color: '#a9a49c', textAlign: 'center' }}>
        {roleLabel}
      </span>
    </div>
  );
}

export function PropertiesPanel(): React.ReactElement {
  const [state, dispatch] = useProjectStore();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);

  const segment = state.segments.find(s => s.id === state.selectedSegmentId) ?? null;
  const cm = segment ? state.clusteredMaps.get(segment.id) ?? null : null;
  const isRecomputing = segment ? state.dirty.has(segment.id) : false;

  if (!segment) {
    return (
      <aside
        style={{
          width: 280,
          flexShrink: 0,
          borderLeft: '1px solid #e2dfda',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <p
          style={{
            fontSize: 13,
            color: '#8d8880',
            textAlign: 'center',
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          Select a segment to adjust its tones and outline
        </p>
      </aside>
    );
  }

  const updateColorSettings = (updates: Partial<typeof segment.colorSettings>) => {
    dispatch({
      type: 'UPDATE_SEGMENT',
      segmentId: segment.id,
      updates: { colorSettings: { ...segment.colorSettings, ...updates } },
    });
  };

  const updateOutlineSettings = (updates: Partial<typeof segment.outlineSettings>) => {
    dispatch({
      type: 'UPDATE_SEGMENT',
      segmentId: segment.id,
      updates: { outlineSettings: { ...segment.outlineSettings, ...updates } },
    });
  };

  const otherSegments = state.segments.filter(s => s.id !== segment.id);

  // Breadcrumb path
  const breadcrumb: string[] = [];
  let current = segment;
  while (current.parentId !== null) {
    const parent = state.segments.find(s => s.id === current.parentId);
    if (!parent) break;
    breadcrumb.unshift(parent.label);
    current = parent;
  }

  const sectionStyle: React.CSSProperties = {
    borderTop: '1px solid #e2dfda',
    padding: '16px 16px',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: '#8d8880',
    marginBottom: 8,
    display: 'block',
  };

  return (
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        borderLeft: '1px solid #e2dfda',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ padding: '16px 16px 12px' }}>
        {breadcrumb.length > 0 && (
          <p
            style={{
              fontSize: 11,
              fontFamily: 'ui-monospace, Menlo, monospace',
              color: '#a9a49c',
              margin: '0 0 6px',
            }}
          >
            {breadcrumb.join(' / ')}
          </p>
        )}
        <input
          type="text"
          value={segment.label}
          onChange={e =>
            dispatch({
              type: 'UPDATE_SEGMENT',
              segmentId: segment.id,
              updates: { label: e.target.value },
            })
          }
          style={{
            width: '100%',
            border: '1px solid #e2dfda',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 14,
            fontWeight: 500,
            color: '#2b2a28',
            background: '#fff',
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = '#3d6fd6'; }}
          onBlur={e => { e.currentTarget.style.borderColor = '#e2dfda'; }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Color count section */}
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>TONES</span>
            <InfoTip text="How many distinct flat tones to quantize this segment into. 2–3 gives a classic cel-shaded look; 4–6 adds more gradation. Changes trigger a re-computation." />
            {isRecomputing && (
              <span
                title="Recomputing tones…"
                style={{
                  marginLeft: 'auto',
                  fontSize: 10.5,
                  fontFamily: 'ui-monospace, Menlo, monospace',
                  color: '#8a6800',
                  background: '#fef6e4',
                  padding: '1px 6px',
                  borderRadius: 4,
                  animation: 'pulse 1s ease-in-out infinite',
                }}
              >
                computing…
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <button
              onClick={() =>
                updateColorSettings({
                  targetColorCount: Math.max(2, segment.colorSettings.targetColorCount - 1),
                })
              }
              disabled={segment.colorSettings.targetColorCount <= 2}
              title="Fewer tones"
              style={{
                width: 28,
                height: 28,
                border: '1px solid #e2dfda',
                background: '#fff',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 16,
                color: '#2b2a28',
              }}
            >
              −
            </button>
            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: '#2b2a28',
                minWidth: 24,
                textAlign: 'center',
              }}
            >
              {segment.colorSettings.targetColorCount}
            </span>
            <button
              onClick={() =>
                updateColorSettings({
                  targetColorCount: Math.min(6, segment.colorSettings.targetColorCount + 1),
                })
              }
              disabled={segment.colorSettings.targetColorCount >= 6}
              title="More tones"
              style={{
                width: 28,
                height: 28,
                border: '1px solid #e2dfda',
                background: '#fff',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 16,
                color: '#2b2a28',
              }}
            >
              +
            </button>
            <div style={{ flex: 1 }}>
              <Slider
                value={segment.colorSettings.targetColorCount}
                min={2}
                max={6}
                step={1}
                onChange={v => updateColorSettings({ targetColorCount: Math.round(v) })}
              />
            </div>
          </div>
        </div>

        {/* Palette section */}
        {cm && cm.clusters.length > 0 && (
          <div style={sectionStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
              <span style={{ ...labelStyle, marginBottom: 0 }}>PALETTE</span>
              <InfoTip text="The quantized colors for this segment, sorted lightest to darkest. Click a swatch to select it. Lock a color (🔒) to pin it during re-quantization so it won't move." />
            </div>
            <div style={{ opacity: isRecomputing ? 0.4 : 1, transition: 'opacity 0.2s', pointerEvents: isRecomputing ? 'none' : undefined }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {[...cm.clusters]
                  .sort((a, b) => a.lightnessRank - b.lightnessRank)
                  .map(cluster => (
                    <ColorSwatch
                      key={cluster.id}
                      cluster={cluster}
                      isSelected={selectedClusterId === cluster.id}
                      onClick={() =>
                        setSelectedClusterId(
                          selectedClusterId === cluster.id ? null : cluster.id,
                        )
                      }
                      onLockToggle={() => {
                        const updatedClusters = cm.clusters.map(c =>
                          c.id === cluster.id ? { ...c, locked: !c.locked } : c,
                        );
                        dispatch({
                          type: 'SET_CLUSTERED_MAP',
                          segmentId: segment.id,
                          map: { ...cm, clusters: updatedClusters },
                        });
                      }}
                    />
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* Outline section */}
        <div style={sectionStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: 12,
              justifyContent: 'space-between',
            }}
          >
            <div className="flex gap-1 items-center"><span style={{ ...labelStyle, marginBottom: 0 }}>OUTLINE</span>
            <InfoTip text="Draw a stroke around this segment's boundary. Toggle off to hide it." /></div>
            <Switch
              checked={segment.outlineSettings.visible}
              onChange={v => updateOutlineSettings({ visible: v })}
              title="Toggle outline visibility"
            />
          </div>

          {segment.outlineSettings.visible && (
            <>
              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 12, color: '#6f6b65' }} title="Stroke thickness in image pixels">Width</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      color: '#8d8880',
                    }}
                  >
                    {segment.outlineSettings.strokeWidth.toFixed(1)}px
                  </span>
                </div>
                <Slider
                  value={segment.outlineSettings.strokeWidth}
                  min={0.5}
                  max={8}
                  step={0.5}
                  onChange={v => updateOutlineSettings({ strokeWidth: v })}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#6f6b65', flex: 1 }} title="Outline stroke color">Color</span>
                <input
                  type="color"
                  value={segment.outlineSettings.strokeColor}
                  onChange={e => updateOutlineSettings({ strokeColor: e.target.value })}
                  style={{
                    width: 32,
                    height: 24,
                    border: '1px solid #e2dfda',
                    borderRadius: 4,
                    cursor: 'pointer',
                    padding: 1,
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    color: '#8d8880',
                  }}
                >
                  {segment.outlineSettings.strokeColor}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Advanced section (collapsible) */}
        <div style={sectionStyle}>
          <button
            onClick={() => setAdvancedOpen(v => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <span style={{ ...labelStyle, marginBottom: 0, flex: 1, textAlign: 'left' }}>
              ADVANCED
            </span>
            <span style={{ fontSize: 10, color: '#8d8880' }}>
              {advancedOpen ? '▲' : '▼'}
            </span>
          </button>

          {advancedOpen && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Color space toggle */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: '#6f6b65' }}>Color space</span>
                  <InfoTip text="LAB clusters colors perceptually (recommended — matches how humans see lightness). RGB clusters by raw channel values and can produce muddy mid-tones." />
                </div>
                <div
                  style={{
                    display: 'flex',
                    background: '#f1efec',
                    borderRadius: 6,
                    padding: 2,
                    gap: 1,
                  }}
                >
                  {(['lab', 'rgb'] as const).map(cs => (
                    <button
                      key={cs}
                      onClick={() => updateColorSettings({ colorSpace: cs })}
                      style={{
                        flex: 1,
                        padding: '4px 8px',
                        fontSize: 12,
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        background:
                          segment.colorSettings.colorSpace === cs ? '#fff' : 'transparent',
                        color:
                          segment.colorSettings.colorSpace === cs ? '#2b2a28' : '#8d8880',
                        fontWeight: segment.colorSettings.colorSpace === cs ? 600 : 400,
                        boxShadow:
                          segment.colorSettings.colorSpace === cs
                            ? '0 1px 3px rgba(0,0,0,0.08)'
                            : 'none',
                      }}
                    >
                      {cs.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Smoothing slider */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 12, color: '#6f6b65' }} title="Applies a mode filter to reduce noise and speckles in the tone regions. Higher = smoother boundaries but may lose fine detail.">Smoothing</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      color: '#8d8880',
                    }}
                  >
                    {Math.round(segment.colorSettings.smoothing * 100)}%
                  </span>
                </div>
                <Slider
                  value={segment.colorSettings.smoothing}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={v => updateColorSettings({ smoothing: v })}
                />
              </div>
            </div>
          )}
        </div>

        {/* Delete / merge segment */}
        <div style={{ padding: '8px 16px 16px' }}>
          {showMergeConfirm ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#6f6b65' }}>Merge pixels into:</span>
              {otherSegments.length === 0 ? (
                <p style={{ fontSize: 12, color: '#8d8880', margin: 0 }}>
                  No other segments — pixels will become unassigned.
                </p>
              ) : (
                <select
                  value={mergeTargetId ?? ''}
                  onChange={e => setMergeTargetId(Number(e.target.value))}
                  style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2dfda', background: '#fff' }}
                >
                  <option value="" disabled>Choose segment…</option>
                  {otherSegments.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => {
                    if (otherSegments.length > 0 && mergeTargetId !== null) {
                      dispatch({ type: 'REQUEST_MERGE', fromId: segment.id, toId: mergeTargetId });
                    } else {
                      dispatch({ type: 'DELETE_SEGMENT', segmentId: segment.id });
                    }
                    setShowMergeConfirm(false);
                  }}
                  disabled={otherSegments.length > 0 && mergeTargetId === null}
                  style={{ flex: 1, padding: '7px 0', fontSize: 13, border: 'none', background: '#c0392b', color: '#fff', borderRadius: 6, cursor: 'pointer' }}
                >
                  {otherSegments.length > 0 ? 'Merge & Delete' : 'Delete'}
                </button>
                <button
                  onClick={() => setShowMergeConfirm(false)}
                  style={{ padding: '7px 12px', fontSize: 13, border: '1px solid #e2dfda', background: '#fff', borderRadius: 6, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setShowMergeConfirm(true); setMergeTargetId(null); }}
              style={{
                width: '100%',
                padding: '7px 0',
                fontSize: 13,
                border: '1px solid #f0c4c4',
                background: '#fff',
                color: '#c0392b',
                borderRadius: 6,
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#fff5f5'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
            >
              Delete segment
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
