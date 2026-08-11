import React from 'react';
import { TopBar } from './TopBar';
import { SegmentList } from './SegmentList';
import { Canvas } from './Canvas';
import { PropertiesPanel } from './PropertiesPanel';
import { ExportModal } from './ExportModal';
import { useProjectStore } from './hooks/useProjectStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

export function App(): React.ReactElement {
  const [, dispatch] = useProjectStore();
  useKeyboardShortcuts(dispatch);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#f4f3f1',
        color: '#2b2a28',
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        WebkitFontSmoothing: 'antialiased',
        overflow: 'hidden',
      }}
    >
      <TopBar />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <SegmentList />
        <Canvas />
        <PropertiesPanel />
      </div>
      <ExportModal />
    </div>
  );
}
