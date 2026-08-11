import React, { useRef } from 'react';
import { useProjectStore } from './hooks/useProjectStore';
import type { ViewMode } from '../engine/types';

export function TopBar(): React.ReactElement {
  const [state, dispatch] = useProjectStore();
  const filenameRef = useRef<HTMLInputElement>(null);

  const canUndo = state.historyIndex > 0;
  const canRedo = state.historyIndex < state.history.length - 1;

  const viewModes: { key: ViewMode; label: string }[] = [
    { key: 'original', label: 'Original' },
    { key: 'segments', label: 'Segments' },
    { key: 'result', label: 'Result' },
  ];

  const zoomLevels = [0.25, 0.5, 1, 1.5, 2, 3, 4];
  const currentZoomPct = Math.round(state.zoom * 100);

  const zoomIn = () => {
    const next = zoomLevels.find(z => z > state.zoom) ?? 4;
    dispatch({ type: 'SET_ZOOM', zoom: next });
  };

  const zoomOut = () => {
    const prev = [...zoomLevels].reverse().find(z => z < state.zoom) ?? 0.25;
    dispatch({ type: 'SET_ZOOM', zoom: prev });
  };

  const fitToScreen = () => {
    dispatch({ type: 'SET_ZOOM', zoom: 1 });
  };

  return (
    <header
      style={{
        height: 52,
        background: '#fff',
        borderBottom: '1px solid #e2dfda',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 16,
        paddingRight: 16,
        gap: 8,
        flexShrink: 0,
        zIndex: 10,
      }}
    >
      {/* Logo */}
      <div
        style={{
          width: 22,
          height: 22,
          background: '#2b2a28',
          borderRadius: 4,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            border: '2px solid #f4f3f1',
            borderRadius: 2,
          }}
        />
      </div>

      {/* Filename */}
      <input
        ref={filenameRef}
        type="text"
        value={state.filename}
        onChange={e => dispatch({ type: 'SET_FILENAME', filename: e.target.value })}
        style={{
          border: 'none',
          background: 'transparent',
          fontSize: 14,
          fontWeight: 500,
          color: '#2b2a28',
          outline: 'none',
          padding: '2px 6px',
          borderRadius: 4,
          cursor: 'text',
          minWidth: 80,
          maxWidth: 200,
        }}
        onFocus={e => {
          e.currentTarget.style.background = '#f1efec';
        }}
        onBlur={e => {
          e.currentTarget.style.background = 'transparent';
        }}
      />

      <div style={{ width: 1, height: 24, background: '#e2dfda' }} />

      {/* Undo/Redo */}
      <button
        onClick={() => dispatch({ type: 'UNDO' })}
        disabled={!canUndo}
        title="Undo (⌘Z)"
        style={{
          width: 32,
          height: 32,
          border: 'none',
          background: 'transparent',
          borderRadius: 6,
          cursor: canUndo ? 'pointer' : 'default',
          color: canUndo ? '#2b2a28' : '#a9a49c',
          fontSize: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={e => { if (canUndo) e.currentTarget.style.background = '#f1efec'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        ↺
      </button>

      <button
        onClick={() => dispatch({ type: 'REDO' })}
        disabled={!canRedo}
        title="Redo (⌘⇧Z)"
        style={{
          width: 32,
          height: 32,
          border: 'none',
          background: 'transparent',
          borderRadius: 6,
          cursor: canRedo ? 'pointer' : 'default',
          color: canRedo ? '#2b2a28' : '#a9a49c',
          fontSize: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={e => { if (canRedo) e.currentTarget.style.background = '#f1efec'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        ↻
      </button>

      <div style={{ width: 1, height: 24, background: '#e2dfda' }} />

      {/* View mode toggle */}
      <div
        style={{
          display: 'flex',
          background: '#f1efec',
          borderRadius: 8,
          padding: 2,
          gap: 1,
        }}
      >
        {viewModes.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', viewMode: key })}
            style={{
              padding: '4px 12px',
              fontSize: 13,
              fontWeight: 500,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              background: state.viewMode === key ? '#2b2a28' : 'transparent',
              color: state.viewMode === key ? '#fff' : '#6f6b65',
              transition: 'all 0.1s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Zoom controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          onClick={zoomOut}
          disabled={state.zoom <= 0.25}
          style={{
            width: 28,
            height: 28,
            border: '1px solid #e2dfda',
            background: '#fff',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#2b2a28',
          }}
        >
          −
        </button>

        <span
          style={{
            fontSize: 13,
            color: '#2b2a28',
            fontFamily: 'ui-monospace, Menlo, monospace',
            minWidth: 44,
            textAlign: 'center',
          }}
        >
          {currentZoomPct}%
        </span>

        <button
          onClick={zoomIn}
          disabled={state.zoom >= 4}
          style={{
            width: 28,
            height: 28,
            border: '1px solid #e2dfda',
            background: '#fff',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#2b2a28',
          }}
        >
          +
        </button>

        <button
          onClick={fitToScreen}
          style={{
            padding: '4px 10px',
            fontSize: 13,
            border: '1px solid #e2dfda',
            background: '#fff',
            borderRadius: 6,
            cursor: 'pointer',
            color: '#2b2a28',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f1efec'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
        >
          Fit
        </button>
      </div>

      <div style={{ width: 1, height: 24, background: '#e2dfda' }} />

      {/* Export button */}
      <button
        onClick={() => dispatch({ type: 'SET_EXPORT_OPEN', open: true })}
        disabled={state.segments.length === 0}
        style={{
          padding: '6px 16px',
          fontSize: 13,
          fontWeight: 600,
          border: 'none',
          background: state.segments.length > 0 ? '#2b2a28' : '#a9a49c',
          color: '#fff',
          borderRadius: 8,
          cursor: state.segments.length > 0 ? 'pointer' : 'default',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => {
          if (state.segments.length > 0) e.currentTarget.style.background = '#444240';
        }}
        onMouseLeave={e => {
          if (state.segments.length > 0) e.currentTarget.style.background = '#2b2a28';
        }}
      >
        Export
      </button>
    </header>
  );
}
