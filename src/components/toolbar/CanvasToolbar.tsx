'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Undo2,
  Redo2,
  LayoutGrid,
  Save,
  FolderOpen,
  Download,
  Upload,
  Trash2,
  Sparkles,
  Magnet,
  Sun,
  Moon,
  Monitor,
  Minus,
  Plus,
  Maximize2
} from 'lucide-react';
import { useReactFlow, useStore } from '@xyflow/react';
import './toolbar.css';
import { CommandEngine } from '@/core/commands/commandEngine';
import { DiagramDocument, createEmptyDiagramDocument } from '@/core/diagram/types';
import {
  loadDiagramFromStorage,
  exportDiagramToFile,
  importDiagramFromJson
} from '@/core/diagram/storage';
import { LayoutResult } from '@/core/layout/elkCompoundLayout';
import { computeBestCompoundLayoutInWorker } from '@/core/layout/layoutWorkerClient';
import { measureVisualsInBrowser } from '@/core/layout/visualMetrics';
import { ApplyLayoutCommand, SetDiagramDocumentCommand } from '@/core/commands/commands';
import { KoraArchitectureModel } from '@/core/ir/types';
import { ThemeMode } from '@/core/theme/types';
import { OperationState, OperationTicket } from '@/core/diagram/operationCoordinator';
import { ValidationIssue } from '@/core/validation/issues';
import { validateDiagramDocument } from '@/core/diagram/validator';
import { renderDiagramSvg } from '@/core/export/svg';
import { rasterizeDiagramPng } from '@/core/export/png';
import { startDiagramDownload } from '@/core/export/download';
import { DiagramExportError } from '@/core/export/limits';
import { cancelActiveInteractions, settleActiveInteractions } from '@/core/editor/interactionSettlement';

interface CanvasToolbarProps {
  engine: CommandEngine;
  document: DiagramDocument;
  onShowMessage: (msg: string) => void;
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  onThemeChange: (t: ThemeMode) => void;
  isSnapEnabled: boolean;
  onToggleSnap: () => void;
  onOpenPrompt: () => void;
  onBeginOperation: () => OperationTicket;
  onInspectOperation: (ticket: OperationTicket) => OperationState;
  onFinishOperation: (ticket: OperationTicket) => boolean;
  onInvalidateOperations: () => void;
  onAcceptDocument: (doc: DiagramDocument, issues: ValidationIssue[], ticket: OperationTicket, description: string, persist?: boolean) => boolean;
  onSetIssues: (issues: ValidationIssue[]) => void;
  onSaveDocument: () => void;
  onPausePersistence: (reason: string) => void;
}

export const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  engine,
  document: doc,
  onShowMessage,
  theme,
  resolvedTheme,
  onThemeChange,
  isSnapEnabled,
  onToggleSnap,
  onOpenPrompt,
  onBeginOperation,
  onInspectOperation,
  onFinishOperation,
  onInvalidateOperations,
  onAcceptDocument,
  onSetIssues,
  onSaveDocument,
  onPausePersistence
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportJobRef = useRef<AbortController | null>(null);
  const exportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const zoomLevel = useStore((s) => Math.round(s.transform[2] * 100));

  useEffect(() => () => {
    if (exportTimeoutRef.current) clearTimeout(exportTimeoutRef.current);
    exportJobRef.current?.abort(new DOMException('Export cancelled because the editor closed.', 'AbortError'));
  }, []);

  const qualityIssues = (result: LayoutResult): ValidationIssue[] => result.findings.map(finding => ({
    code: finding.code,
    severity: finding.severity === 'blocking' ? 'warning' : 'info',
    path: ['layout', ...finding.entityIds],
    entityId: finding.entityIds[0],
    message: `${finding.code.replaceAll('_', ' ').toLowerCase()}${finding.entityIds.length ? `: ${finding.entityIds.join(', ')}` : ''}.`
  }));

  const handleAutoLayout = async () => {
    let ticket: OperationTicket | undefined;
    try {
      await settleActiveInteractions();
      ticket = onBeginOperation();
      const snapshot = engine.getDocument();
      const model: KoraArchitectureModel = {
        version: '1.0',
        scope: snapshot.semantic.scope,
        nodes: Object.values(snapshot.semantic.nodes),
        connections: Object.values(snapshot.semantic.connections),
        containers: Object.values(snapshot.semantic.containers)
      };
      const validation = validateDiagramDocument(snapshot);
      if (!validation.ok) {
        onSetIssues(validation.issues);
        onShowMessage('Auto Layout stopped because the current diagram is invalid.');
        onFinishOperation(ticket);
        return;
      }

      const metrics = await measureVisualsInBrowser(model);
      const stateAfterMeasure = onInspectOperation(ticket);
      if (stateAfterMeasure === 'superseded') return;
      if (stateAfterMeasure === 'stale') {
        onFinishOperation(ticket);
        onShowMessage('The diagram changed during visual measurement. Run Auto Layout again.');
        return;
      }
      const layoutResult = await computeBestCompoundLayoutInWorker(model, {
        direction: 'RIGHT',
        connectionPresentations: snapshot.presentation.connections,
        metrics
      });
      const state = onInspectOperation(ticket);
      if (state === 'superseded') return;
      if (state === 'stale') {
        onFinishOperation(ticket);
        onShowMessage('The diagram changed while layout was running. Run Auto Layout again.');
        return;
      }
      const nextNodePresentation = layoutResult.document.presentation.nodes;
      const nextContainerPresentation = layoutResult.document.presentation.containers;
      const nextConnectionPresentation = layoutResult.document.presentation.connections;
      const nextDoc: DiagramDocument = {
        ...snapshot,
        presentation: {
          ...snapshot.presentation,
          nodes: nextNodePresentation,
          containers: nextContainerPresentation,
          ...(nextConnectionPresentation ? { connections: nextConnectionPresentation } : {})
        }
      };
      const nextValidation = validateDiagramDocument(nextDoc);
      if (!nextValidation.ok) {
        onSetIssues(nextValidation.issues);
        onFinishOperation(ticket);
        onShowMessage('Auto Layout produced invalid geometry; the current diagram was kept.');
        return;
      }
      const changed = engine.dispatch(new ApplyLayoutCommand(
        snapshot.presentation.nodes,
        snapshot.presentation.containers,
        nextValidation.value.presentation.nodes,
        nextValidation.value.presentation.containers,
        nextValidation.value.presentation.connections
      ));
      const findings = qualityIssues(layoutResult);
      onSetIssues([...nextValidation.issues, ...findings]);
      onFinishOperation(ticket);
      const unresolved = layoutResult.findings.length;
      onShowMessage(changed
        ? `Layout complete (${layoutResult.profile}${unresolved ? `, ${unresolved} quality finding(s)` : ''}).`
        : 'The diagram is already laid out.');
    } catch (err: unknown) {
      const state = ticket ? onInspectOperation(ticket) : 'superseded';
      if (!ticket && err instanceof Error) onShowMessage(err.message);
      else if (state === 'current' && !(err instanceof DOMException && err.name === 'AbortError')) onShowMessage('Auto Layout failed. The current diagram was kept.');
      if (ticket) onFinishOperation(ticket);
    }
  };

  const handleSave = async () => {
    try {
      await settleActiveInteractions();
      onSaveDocument();
    } catch (error) {
      onShowMessage(error instanceof Error ? error.message : 'Could not finish the active label edit.');
    }
  };

  const handleLoad = () => {
    cancelActiveInteractions();
    onInvalidateOperations();
    const ticket = onBeginOperation();
    const loaded = loadDiagramFromStorage();
    if (loaded.status === 'loaded') {
      onAcceptDocument(loaded.document, loaded.issues, ticket, 'Load');
    } else if (loaded.status === 'invalid') {
      onPausePersistence('invalid-saved-data');
      onSetIssues(loaded.issues);
      onFinishOperation(ticket);
      onShowMessage('The saved diagram is invalid. The current diagram was kept.');
    } else if (loaded.status === 'unavailable') {
      onPausePersistence('storage-read-unavailable');
      onSetIssues(loaded.issues);
      onFinishOperation(ticket);
      onShowMessage('Browser storage is unavailable.');
    } else {
      onFinishOperation(ticket);
      onShowMessage('No saved architecture found in browser storage.');
    }
  };

  const handleExport = async () => {
    try {
      await settleActiveInteractions();
      const result = exportDiagramToFile(engine.getDocument());
      onShowMessage(result.ok ? 'Diagram download started.' : 'Could not start the diagram download.');
      if (!result.ok) onSetIssues(result.issues);
    } catch (error) {
      onShowMessage(error instanceof Error ? error.message : 'Could not finish the active label edit.');
    }
  };

  const startImageExport = async (format: 'svg' | 'png', scale: 1 | 2 = 2, transparent = false) => {
    exportJobRef.current?.abort(new DOMException('Export was superseded.', 'AbortError'));
    if (exportTimeoutRef.current) clearTimeout(exportTimeoutRef.current);
    const controller = new AbortController();
    exportJobRef.current = controller;
    setExporting(true);
    setExportMessage('Preparing export…');
    exportTimeoutRef.current = setTimeout(() => controller.abort(new DiagramExportError('TIMEOUT', 'Export timed out after 30 seconds.')), 30_000);
    try {
      await settleActiveInteractions(5_000, controller.signal);
      if (controller.signal.aborted || exportJobRef.current !== controller) return;
      const snapshot = engine.getDocument();
      const themeSnapshot = resolvedTheme;
      const svg = await renderDiagramSvg(snapshot, { theme: themeSnapshot, background: transparent ? 'transparent' : 'theme', signal: controller.signal });
      if (controller.signal.aborted || exportJobRef.current !== controller) return;
      if (format === 'svg') startDiagramDownload(svg.blob, snapshot.metadata.title, 'svg');
      else {
        const png = await rasterizeDiagramPng(svg, { scale, signal: controller.signal });
        if (controller.signal.aborted || exportJobRef.current !== controller) return;
        startDiagramDownload(png, snapshot.metadata.title, 'png');
      }
      setExportMessage('Download started.');
      onShowMessage('Diagram download started.');
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'AbortError') {
        setExportMessage('Export cancelled.');
      } else {
        const message = error instanceof Error ? error.message : 'Export failed. Try again.';
        setExportMessage(message);
        onShowMessage(message);
      }
    } finally {
      if (exportJobRef.current === controller) {
        exportJobRef.current = null;
        setExporting(false);
        if (exportTimeoutRef.current) clearTimeout(exportTimeoutRef.current);
        exportTimeoutRef.current = null;
      }
    }
  };

  const cancelImageExport = () => exportJobRef.current?.abort(new DOMException('Export cancelled.', 'AbortError'));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    cancelActiveInteractions();
    onInvalidateOperations();
    const ticket = onBeginOperation();
    const reader = new FileReader();
    reader.onload = (event) => {
      if (onInspectOperation(ticket) === 'superseded') return;
      try {
        const text = typeof event.target?.result === 'string' ? event.target.result : '';
        const imported = importDiagramFromJson(text);
        if (!imported.ok) {
          onSetIssues(imported.issues);
          onFinishOperation(ticket);
          onShowMessage('Could not import the diagram. The current diagram was kept.');
          return;
        }
        onAcceptDocument(imported.value, imported.issues, ticket, 'Import');
      } catch {
        onFinishOperation(ticket);
        onShowMessage('Could not read the diagram file. The current diagram was kept.');
      }
    };
    reader.onerror = () => {
      if (onInspectOperation(ticket) === 'current') onShowMessage('Could not read the diagram file.');
      onFinishOperation(ticket);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClear = () => {
    cancelActiveInteractions();
    onInvalidateOperations();
    if (Object.keys(doc.semantic.nodes).length === 0 && Object.keys(doc.semantic.containers).length === 0 && !doc.metadata.source) return;
    const empty = createEmptyDiagramDocument('Blank Canvas');
    engine.dispatch(new SetDiagramDocumentCommand(doc, empty));
    onSetIssues([]);
    onShowMessage('Canvas cleared');
  };

  return (
    <header className="kora-topbar">
      {/* 1. Left Section: Brand & Diagram Title & Edit Prompt */}
      <div className="topbar-left">
        <div className="topbar-brand">
          <div className="topbar-logo-badge">K</div>
          <span className="topbar-brand-name">Kora</span>
        </div>

        <div className="topbar-separator" />

        <div className="topbar-title-box">
          <span className="topbar-diagram-title">{doc.metadata.title || 'Untitled Diagram'}</span>
        </div>

        <button
          type="button"
          className="topbar-btn is-accent"
          onClick={onOpenPrompt}
          title="Open architecture prompt editor"
        >
          <Sparkles size={13} />
          <span>Edit Prompt</span>
        </button>
      </div>

      {/* 2. Center Section: Architecture Ops & Snap */}
      <div className="topbar-center">
        <button
          type="button"
          className="topbar-btn"
          onClick={() => { cancelActiveInteractions(); engine.undo(); }}
          onPointerDown={cancelActiveInteractions}
          disabled={!engine.canUndo}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={13} />
        </button>

        <button
          type="button"
          className="topbar-btn"
          onClick={() => { cancelActiveInteractions(); engine.redo(); }}
          onPointerDown={cancelActiveInteractions}
          disabled={!engine.canRedo}
          title="Redo (Ctrl+Y)"
        >
          <Redo2 size={13} />
        </button>

        <div className="topbar-separator" />

        <button
          type="button"
          className="topbar-btn"
          onClick={handleAutoLayout}
          disabled={Object.keys(doc.semantic.nodes).length === 0 && Object.keys(doc.semantic.containers).length === 0}
          title="Deterministic hierarchical layout (ELK.js)"
        >
          <LayoutGrid size={13} />
          <span>Auto Layout</span>
        </button>

        <div className="topbar-separator" />

        <button
          type="button"
          className={`topbar-btn ${isSnapEnabled ? 'is-active' : ''}`}
          onClick={onToggleSnap}
          title={isSnapEnabled ? 'Snap to 20px grid: Enabled' : 'Snap to grid: Disabled'}
        >
          <Magnet size={13} />
          <span>Snap 20px</span>
        </button>
      </div>

      {/* 3. Right Section: File IO, Zoom, Theme */}
      <div className="topbar-right">
        {/* Save & Load */}
        <button
          type="button"
          className="topbar-btn"
          onClick={handleSave}
          title="Save diagram to LocalStorage (Ctrl+S)"
        >
          <Save size={13} />
          <span>Save</span>
        </button>

        <button
          type="button"
          className="topbar-btn"
          onClick={handleLoad}
          onPointerDown={cancelActiveInteractions}
          title="Load diagram from LocalStorage"
        >
          <FolderOpen size={13} />
          <span>Load</span>
        </button>

        <div className="export-menu-wrap">
          <button
            type="button"
            className="topbar-btn"
            onClick={() => setExportMenuOpen(open => !open)}
            title="Export diagram"
            aria-label="Export diagram"
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
          >
            <Download size={13} />
            <span>Export</span>
          </button>
          {exportMenuOpen && (
            <div className="export-menu" role="menu" aria-label="Export formats">
              <button type="button" role="menuitem" onClick={() => { handleExport(); setExportMenuOpen(false); }}>JSON (editable backup)</button>
              <button type="button" role="menuitem" disabled={Object.keys(doc.semantic.nodes).length + Object.keys(doc.semantic.containers).length + Object.keys(doc.semantic.connections).length === 0} onClick={() => { void startImageExport('svg'); }}>SVG</button>
              <button type="button" role="menuitem" disabled={Object.keys(doc.semantic.nodes).length + Object.keys(doc.semantic.containers).length + Object.keys(doc.semantic.connections).length === 0} onClick={() => { void startImageExport('png', 2); }}>PNG 2×</button>
              <button type="button" role="menuitem" disabled={Object.keys(doc.semantic.nodes).length + Object.keys(doc.semantic.containers).length + Object.keys(doc.semantic.connections).length === 0} onClick={() => { void startImageExport('png', 1); }}>PNG 1×</button>
              <button type="button" role="menuitem" disabled={Object.keys(doc.semantic.nodes).length + Object.keys(doc.semantic.containers).length + Object.keys(doc.semantic.connections).length === 0} onClick={() => { void startImageExport('png', 2, true); }}>PNG 2× · transparent</button>
              {exporting && <button type="button" role="menuitem" onClick={cancelImageExport}>Cancel export</button>}
              {exportMessage && <div className="export-menu-status" role="status" aria-live="polite">{exportMessage}</div>}
              {Object.keys(doc.semantic.nodes).length + Object.keys(doc.semantic.containers).length + Object.keys(doc.semantic.connections).length === 0 && <div className="export-menu-status" role="status">Nothing to export</div>}
            </div>
          )}
        </div>

        <button
          type="button"
          className="topbar-btn"
          onClick={() => fileInputRef.current?.click()}
          onPointerDown={cancelActiveInteractions}
          title="Import diagram from JSON file"
        >
          <Upload size={13} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <button
          type="button"
          className="topbar-btn is-danger"
          onClick={handleClear}
          onPointerDown={cancelActiveInteractions}
          title="Clear diagram canvas"
        >
          <Trash2 size={13} />
        </button>

        <div className="topbar-separator" />

        {/* Minimal Zoom Controls */}
        <div className="topbar-zoom-controls">
          <button
            type="button"
            className="topbar-icon-btn"
            onClick={() => zoomOut({ duration: 150 })}
            title="Zoom Out"
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            className="topbar-zoom-label"
            onClick={() => zoomTo(1, { duration: 150 })}
            title="Reset Zoom to 100%"
          >
            {zoomLevel}%
          </button>
          <button
            type="button"
            className="topbar-icon-btn"
            onClick={() => zoomIn({ duration: 150 })}
            title="Zoom In"
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            className="topbar-icon-btn"
            onClick={() => fitView({ padding: 0.2, duration: 200 })}
            title="Fit View"
          >
            <Maximize2 size={12} />
          </button>
        </div>

        <div className="topbar-separator" />

        {/* Theme Segmented Switcher */}
        <div className="topbar-theme-group" title="Workspace Theme">
          <button
            type="button"
            className={`theme-segment-btn ${theme === 'system' ? 'is-selected' : ''}`}
            onClick={() => onThemeChange('system')}
            title="System theme"
          >
            <Monitor size={12} />
          </button>
          <button
            type="button"
            className={`theme-segment-btn ${theme === 'light' ? 'is-selected' : ''}`}
            onClick={() => onThemeChange('light')}
            title="Light theme"
          >
            <Sun size={12} />
          </button>
          <button
            type="button"
            className={`theme-segment-btn ${theme === 'dark' ? 'is-selected' : ''}`}
            onClick={() => onThemeChange('dark')}
            title="Dark theme"
          >
            <Moon size={12} />
          </button>
        </div>
      </div>
    </header>
  );
};
