import React, { useState } from 'react';
import { useProjectStore } from './hooks/useProjectStore';
import type { Segment, ClusteredMap } from '../engine/types';

const TINT_COLORS = [
  '#3d6fd6', '#d65d3d', '#3dd65d', '#d63d9e',
  '#3dc3d6', '#9ed63d', '#d69e3d', '#5d3dd6',
];

function getSegmentColor(segmentId: number): string {
  return TINT_COLORS[segmentId % TINT_COLORS.length];
}

function getToneCount(segment: Segment, clusteredMaps: Map<number, ClusteredMap>): number {
  const cm = clusteredMaps.get(segment.id);
  return cm ? cm.clusters.length : segment.colorSettings.targetColorCount;
}

interface SegmentRowProps {
  segment: Segment;
  isSelected: boolean;
  isChild: boolean;
  toneCount: number;
  onSelect: () => void;
  onToggleVisibility: () => void;
}

function SegmentRow({
  segment,
  isSelected,
  isChild,
  toneCount,
  onSelect,
  onToggleVisibility,
}: SegmentRowProps): React.ReactElement {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 36,
        paddingLeft: isChild ? 42 : 12,
        paddingRight: 8,
        cursor: 'pointer',
        background: isSelected ? '#f0f4fc' : 'transparent',
        borderLeft: isSelected ? '2px solid #3d6fd6' : '2px solid transparent',
        gap: 8,
        userSelect: 'none',
      }}
      onMouseEnter={e => {
        if (!isSelected) e.currentTarget.style.background = '#f8f7f5';
      }}
      onMouseLeave={e => {
        if (!isSelected) e.currentTarget.style.background = 'transparent';
      }}
    >
      {isChild && (
        <span style={{ color: '#a9a49c', fontSize: 12, marginLeft: -8 }}>—</span>
      )}

      {/* Color swatch */}
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: 3,
          background: getSegmentColor(segment.id),
          flexShrink: 0,
        }}
      />

      {/* Label */}
      <span
        style={{
          fontSize: 13,
          color: isSelected ? '#2b2a28' : '#3d3b38',
          fontWeight: isSelected ? 500 : 400,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {segment.label}
      </span>

      {/* Tone count */}
      <span
        style={{
          fontSize: 11,
          color: '#8d8880',
          fontFamily: 'ui-monospace, Menlo, monospace',
          background: '#f1efec',
          padding: '1px 5px',
          borderRadius: 4,
        }}
      >
        {toneCount}t
      </span>

      {/* Visibility toggle */}
      <button
        onClick={e => {
          e.stopPropagation();
          onToggleVisibility();
        }}
        style={{
          width: 24,
          height: 24,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
          color: segment.visible ? '#6f6b65' : '#c0bcb7',
          fontSize: 14,
          padding: 0,
        }}
        title={segment.visible ? 'Hide' : 'Show'}
      >
        {segment.visible ? '●' : '○'}
      </button>
    </div>
  );
}

export function SegmentList(): React.ReactElement {
  const [state, dispatch] = useProjectStore();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const topLevel = state.segments.filter(s => s.parentId === null);
  const childrenOf = (id: number) => state.segments.filter(s => s.parentId === id);

  const toggleCollapse = (id: number) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  return (
    <aside
      style={{
        width: 240,
        flexShrink: 0,
        borderRight: '1px solid #e2dfda',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 14,
          paddingRight: 8,
          borderBottom: '1px solid #e2dfda',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: '#8d8880',
            flex: 1,
          }}
        >
          SEGMENTS
        </span>
      </div>

      {/* Segment list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {state.segments.length === 0 ? (
          <div
            style={{
              padding: '32px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            {/* SVG icon */}
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="6" y="6" width="28" height="28" rx="4" stroke="#c0bcb7" strokeWidth="1.5" />
              <path d="M13 20 L20 13 L27 20 L20 27 Z" stroke="#c0bcb7" strokeWidth="1.5" fill="none" />
              <circle cx="20" cy="20" r="2" fill="#c0bcb7" />
            </svg>
            <p
              style={{
                fontSize: 13,
                color: '#8d8880',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              Click an object on the canvas to start segmenting
            </p>
          </div>
        ) : (
          topLevel.map(segment => {
            const children = childrenOf(segment.id);
            const isCollapsed = collapsed.has(segment.id);

            return (
              <div key={segment.id}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {children.length > 0 && (
                    <button
                      onClick={() => toggleCollapse(segment.id)}
                      style={{
                        width: 20,
                        height: 36,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        color: '#8d8880',
                        fontSize: 10,
                        paddingLeft: 8,
                        flexShrink: 0,
                      }}
                    >
                      {isCollapsed ? '▶' : '▼'}
                    </button>
                  )}
                  <div style={{ flex: 1, paddingLeft: children.length === 0 ? 0 : 0 }}>
                    <SegmentRow
                      segment={segment}
                      isSelected={state.selectedSegmentId === segment.id}
                      isChild={false}
                      toneCount={getToneCount(segment, state.clusteredMaps)}
                      onSelect={() => dispatch({ type: 'SELECT_SEGMENT', segmentId: segment.id })}
                      onToggleVisibility={() =>
                        dispatch({
                          type: 'UPDATE_SEGMENT',
                          segmentId: segment.id,
                          updates: { visible: !segment.visible },
                        })
                      }
                    />
                  </div>
                </div>

                {!isCollapsed &&
                  children.map(child => (
                    <SegmentRow
                      key={child.id}
                      segment={child}
                      isSelected={state.selectedSegmentId === child.id}
                      isChild={true}
                      toneCount={getToneCount(child, state.clusteredMaps)}
                      onSelect={() => dispatch({ type: 'SELECT_SEGMENT', segmentId: child.id })}
                      onToggleVisibility={() =>
                        dispatch({
                          type: 'UPDATE_SEGMENT',
                          segmentId: child.id,
                          updates: { visible: !child.visible },
                        })
                      }
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          height: 36,
          borderTop: '1px solid #e2dfda',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 14,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: '#a9a49c',
            fontFamily: 'ui-monospace, Menlo, monospace',
          }}
        >
          {state.segments.length} segment{state.segments.length !== 1 ? 's' : ''}
        </span>
      </div>
    </aside>
  );
}
