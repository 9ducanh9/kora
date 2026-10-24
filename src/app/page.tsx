'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { CommandEngine } from '@/core/commands/commandEngine';
import { DiagramDocument } from '@/core/diagram/types';
import { SetDiagramDocumentCommand } from '@/core/commands/commands';
import { OperationCoordinator, OperationTicket } from '@/core/diagram/operationCoordinator';
import { DIAGRAM_STORAGE_KEY } from '@/core/diagram/storage';
import { PersistenceCoordinator, PersistenceStatus } from '@/core/workspace/persistenceCoordinator';
import { useTheme } from '@/core/theme/useTheme';
import { KoraCanvas } from '@/components/canvas/KoraCanvas';
import { PromptHeader } from '@/components/prompt/PromptHeader';
import { CanvasToolbar } from '@/components/toolbar/CanvasToolbar';
import { EditorFooter } from '@/components/footer/EditorFooter';
import { ValidationIssue, deduplicateIssues } from '@/core/validation/issues';
import { validateDiagramDocument } from '@/core/diagram/validator';
import { cancelActiveLayoutJobs } from '@/core/layout/layoutWorkerClient';
import { cancelActiveInteractions, settleActiveInteractions } from '@/core/editor/interactionSettlement';

function KoraStudioWorkspace() {
  const engine = useMemo(() => new CommandEngine(), []);
  const operations = useMemo(() => new OperationCoordinator(), []);
  const [saveStatus, setSaveStatus] = useState<PersistenceStatus>({ state: 'loading', dirty: false });
  const persistence = useMemo(() => new PersistenceCoordinator({ onStatus: setSaveStatus }), []);
  const epochRef = useRef(0);
  const getDocumentEpoch = useCallback(() => epochRef.current, []);
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const [document, setDocument] = useState<DiagramDocument>(() => engine.getDocument());
  const [toastMessage, setToastMessage] = useState<string>('');
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [isSnapEnabled, setIsSnapEnabled] = useState<boolean>(true);
  const [isPromptOpen, setIsPromptOpen] = useState<boolean>(false);
  const { theme, resolvedTheme, setTheme } = useTheme();

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(current => current === msg ? '' : current), 3500);
  }, []);

  useEffect(() => engine.subscribe((newDoc, change) => {
    setDocument(newDoc);
    if (change.kind === 'replacement') {
      epochRef.current++;
      setDocumentEpoch(epochRef.current);
    }
    if (change.kind === 'edit' || change.operation === 'undo' || change.operation === 'redo' || change.operation === 'reset') {
      cancelActiveLayoutJobs('The document changed while an operation was running.');
      operations.invalidate();
    }
    persistence.observe(newDoc, change.revision, epochRef.current, true);
  }), [engine, operations, persistence]);

  useEffect(() => {
    const saved = persistence.hydrate(engine.getDocument());
    if (saved.status === 'loaded') {
      persistence.acceptLoadedDocument(saved.document);
      engine.reset(saved.document);
      setIssues(saved.issues);
      if (Object.keys(saved.document.semantic.nodes).length || Object.keys(saved.document.semantic.containers).length) {
        showToast('Loaded saved architecture from previous session');
      }
      return;
    }
    setIsPromptOpen(true);
    if (saved.status === 'invalid') {
      setIssues(saved.issues);
      showToast('The saved diagram is invalid; the original browser data was kept.');
    } else if (saved.status === 'unavailable') {
      setIssues(saved.issues);
      showToast('Browser storage is unavailable.');
    }
  }, [engine, persistence, showToast]);

  const beginOperation = useCallback(() => {
    cancelActiveLayoutJobs();
    return operations.begin(engine.revision, epochRef.current);
  }, [engine, operations]);
  const inspectOperation = useCallback((ticket: OperationTicket) => operations.inspect(ticket, engine.revision, epochRef.current), [engine, operations]);
  const finishOperation = useCallback((ticket: OperationTicket) => operations.finish(ticket), [operations]);
  const invalidateOperations = useCallback(() => {
    cancelActiveLayoutJobs();
    operations.invalidate();
  }, [operations]);
  const registerOperationAbort = useCallback((ticket: OperationTicket, cancel: (reason: string) => void) => operations.registerCancellation(ticket, cancel), [operations]);
  const saveCurrentDocument = useCallback(() => {
    const result = persistence.saveExplicit(engine.getDocument());
    if (!result?.ok) {
      if (result?.issues.length) setIssues(result.issues);
      showToast('Could not save the diagram. Your current edits are still open.');
    } else showToast('Saved architecture to browser storage.');
  }, [engine, persistence, showToast]);
  const pausePersistence = useCallback((reason: string) => persistence.pause(reason), [persistence]);

  const acceptDocument = useCallback((
    candidate: DiagramDocument,
    candidateIssues: ValidationIssue[],
    ticket: OperationTicket,
    description: string,
    persist = false
  ): boolean => {
    const state = operations.inspect(ticket, engine.revision, epochRef.current);
    if (state === 'superseded') return false;
    if (state === 'stale') {
      operations.finish(ticket);
      showToast('The diagram changed while this operation was running. Run it again.');
      return false;
    }

    const validation = validateDiagramDocument(candidate);
    if (!validation.ok) {
      setIssues(validation.issues);
      operations.finish(ticket);
      showToast('The replacement diagram failed validation. The current diagram was kept.');
      return false;
    }

    if (description === 'Load') persistence.acceptLoadedDocument(validation.value);
    engine.dispatch(new SetDiagramDocumentCommand(engine.getDocument(), validation.value, description));
    setIssues(deduplicateIssues([...candidateIssues, ...validation.issues]));
    operations.finish(ticket);
    showToast(persist ? `Generated "${validation.value.metadata.title}"; saving locally…` : `${description} successfully`);
    return true;
  }, [engine, operations, persistence, showToast]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modKey = isMac ? event.metaKey : event.ctrlKey;
      if (modKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void settleActiveInteractions().then(saveCurrentDocument).catch(error => showToast(error instanceof Error ? error.message : 'Could not finish the active label edit.'));
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      if (modKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        cancelActiveInteractions();
        const changed = event.shiftKey ? engine.redo() : engine.undo();
        if (changed) showToast(event.shiftKey ? 'Redo' : 'Undo');
      } else if (modKey && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        cancelActiveInteractions();
        if (engine.redo()) showToast('Redo');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [engine, saveCurrentDocument, showToast]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DIAGRAM_STORAGE_KEY) return;
      if (persistence.handleExternalStorageChange(event.newValue)) showToast('Browser storage changed in another tab. Choose Load or Save before continuing to save automatically.');
    };
    const onHidden = () => { if (window.document.visibilityState === 'hidden') persistence.onVisibilityHidden(); };
    const onPageHide = () => persistence.onVisibilityHidden();
    window.addEventListener('storage', onStorage);
    window.document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      persistence.dispose();
    };
  }, [persistence, showToast]);

  const closePrompt = useCallback(() => {
    invalidateOperations();
    setIsPromptOpen(false);
  }, [invalidateOperations]);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <CanvasToolbar
        engine={engine}
        document={document}
        onShowMessage={showToast}
        theme={theme}
        resolvedTheme={resolvedTheme}
        onThemeChange={setTheme}
        isSnapEnabled={isSnapEnabled}
        onToggleSnap={() => setIsSnapEnabled(previous => !previous)}
        onOpenPrompt={() => setIsPromptOpen(true)}
        onBeginOperation={beginOperation}
        onInspectOperation={inspectOperation}
        onFinishOperation={finishOperation}
        onInvalidateOperations={invalidateOperations}
        onAcceptDocument={acceptDocument}
        onSetIssues={setIssues}
        onSaveDocument={saveCurrentDocument}
        onPausePersistence={pausePersistence}
      />

      <div style={{ flex: 1, width: '100%', height: 'calc(100vh - 44px)', position: 'relative', overflow: 'hidden' }}>
        <KoraCanvas document={document} engine={engine} resolvedTheme={resolvedTheme} snapToGrid={isSnapEnabled} onShowMessage={showToast} onInvalidateOperations={invalidateOperations} getDocumentEpoch={getDocumentEpoch} />
        <PromptHeader
          isOpen={isPromptOpen}
          onClose={closePrompt}
          onDiagramGenerated={(candidate, candidateIssues, ticket) => acceptDocument(candidate, candidateIssues, ticket, 'Generate', true)}
          onBeginOperation={beginOperation}
          onInspectOperation={inspectOperation}
          onFinishOperation={finishOperation}
          onInvalidateOperations={invalidateOperations}
          onRegisterOperationAbort={registerOperationAbort}
          currentTitle={document.metadata.title}
          source={document.metadata.source}
          documentEpoch={documentEpoch}
        />
        <EditorFooter document={document} statusMessage={toastMessage} issues={issues} onDismissIssues={() => setIssues([])} saveStatus={saveStatus} />
      </div>
    </div>
  );
}

export default function KoraStudioPage() {
  return <ReactFlowProvider><KoraStudioWorkspace /></ReactFlowProvider>;
}
