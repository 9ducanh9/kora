'use client';

import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  Node,
  Edge,
  MarkerType,
  Connection,
  OnConnect,
  OnNodeDrag,
  SelectionMode,
  useStoreApi,
  useReactFlow,
  NodeChange,
  EdgeChange
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './canvas.css';

import { DiagramDocument, ConnectionSide } from '@/core/diagram/types';
import { CommandEngine } from '@/core/commands/commandEngine';
import {
  DeleteSelectionCommand,
  MoveDiagramObjectsCommand,
  UpdateNodeLabelCommand,
  UpdateContainerLabelCommand,
  UpdateConnectionLabelCommand,
  ReconnectConnectionCommand,
  CreateConnectionCommand
} from '@/core/commands/commands';
import { AwsServiceNode } from './AwsServiceNode';
import { ContainerNode } from './ContainerNode';
import { AwsConnectionEdge } from './AwsConnectionEdge';
import { IRConnection, KoraArchitectureModel } from '@/core/ir/types';
import { buildMovementClosure, previewMovement } from '@/core/commands/movement';
import { cancelActiveLayoutJobs } from '@/core/layout/layoutWorkerClient';
import { measureVisualsFromCurrentBrowser, measureVisualsInBrowser, VisualMetricsSnapshot } from '@/core/layout/visualMetrics';
import { createTextMeasureContext, resolveTextLayout, TextLineRun } from '@/core/layout/textLayout';
import { getContainerVisualConfig } from '@/core/containers/registry';
import { resolveNodeDisplay } from '@/core/assets/registry';
import { cachedRouteForRender, createRouteInputSignature, routeCacheStatus, routeGeometryUsable } from '@/core/layout/routeCache';
import { resolveEffectiveNodeBox } from '@/core/layout/nodeDimensions';
import { cancelActiveInteractions, registerCancellablePreview } from '@/core/editor/interactionSettlement';
import { retainFlowMeasurements } from '@/core/editor/flowNodeGeometry';

interface KoraCanvasProps {
  document: DiagramDocument;
  engine: CommandEngine;
  resolvedTheme?: 'light' | 'dark';
  snapToGrid?: boolean;
  onShowMessage?: (message: string) => void;
  onInvalidateOperations?: () => void;
  getDocumentEpoch?: () => number;
}

const nodeTypes = { 'aws-service': AwsServiceNode, container: ContainerNode };
const edgeTypes = { 'aws-connection': AwsConnectionEdge };
const gridSize = 20;
type Position = { x: number; y: number };
type MoveEntry = { kind: 'node' | 'container'; from: Position; to: Position };
interface DragSession {
  revision: number;
  anchorId: string;
  pointerId: string;
  moves: Record<string, MoveEntry>;
  cancelled: boolean;
}

function modelFromDocument(doc: DiagramDocument): KoraArchitectureModel {
  return {
    version: '1.0',
    scope: doc.semantic.scope,
    nodes: Object.values(doc.semantic.nodes),
    connections: Object.values(doc.semantic.connections),
    containers: Object.values(doc.semantic.containers)
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

function sideFromHandle(handle: string | null | undefined, fallback: ConnectionSide): ConnectionSide {
  if (!handle) return fallback;
  const side = handle.replace(/-(source|target)$/, '');
  return side === 'top' || side === 'right' || side === 'bottom' || side === 'left' ? side : fallback;
}

function connectionId(doc: DiagramDocument): string {
  let suffix = 1;
  while (doc.semantic.connections[`connection-${suffix}`]) suffix++;
  return `connection-${suffix}`;
}

export const KoraCanvas: React.FC<KoraCanvasProps> = ({
  document: doc,
  engine,
  resolvedTheme = 'dark',
  snapToGrid = true,
  onShowMessage,
  onInvalidateOperations,
  getDocumentEpoch
}) => {
  const documentEpochAtRender = getDocumentEpoch?.() ?? 0;
  const flowStore = useStoreApi<Node, Edge>();
  const { getViewport, setViewport } = useReactFlow();
  const panSession = useRef<{ x: number; y: number; viewport: { x: number; y: number; zoom: number } } | null>(null);
  const dragSession = useRef<DragSession | null>(null);
  const keyboardSession = useRef<{ key: string; moves: Record<string, MoveEntry>; delta: Position } | null>(null);
  const [previewPositions, setPreviewPositions] = useState<Record<string, Position>>({});
  const [selection, setSelection] = useState<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] });
  const [routeSignature, setRouteSignature] = useState<string | null>(null);
  const [routeMetrics, setRouteMetrics] = useState<VisualMetricsSnapshot | null>(null);
  const textContext = useMemo(() => routeMetrics ? createTextMeasureContext(routeMetrics.profile.fontFamily) : undefined, [routeMetrics?.profile.fontFamily]);
  const lastRouteWarning = useRef<string>('');

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const session = panSession.current;
      if (!session) return;
      void setViewport({ ...session.viewport, x: session.viewport.x + event.clientX - session.x, y: session.viewport.y + event.clientY - session.y });
    };
    const stop = () => { panSession.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
    };
  }, [setViewport]);

  useEffect(() => registerCancellablePreview('kora-canvas', () => {
    if (dragSession.current) dragSession.current.cancelled = true;
    dragSession.current = null;
    keyboardSession.current = null;
    setPreviewPositions({});
    flowStore.getState().cancelConnection();
  }), [flowStore]);

  useEffect(() => {
    let active = true;
    setRouteSignature(null);
    setRouteMetrics(null);
    const model = modelFromDocument(doc);
    measureVisualsInBrowser(model).then(async metrics => {
      const nodeBoxes = Object.fromEntries(Object.entries(doc.presentation.nodes).map(([id, box]) => [id,
        {
          x: box.x,
          y: box.y,
          width: Math.max(box.width ?? 0, metrics.nodes[id]?.width ?? 96),
          height: Math.max(box.height ?? 0, metrics.nodes[id]?.height ?? 79)
        }
      ]));
      const signature = await createRouteInputSignature(model, nodeBoxes, doc.presentation.containers, doc.presentation.connections ?? {}, metrics);
      if (!active) return;
      setRouteSignature(signature);
      setRouteMetrics(metrics);
      const cacheEntries = Object.entries(doc.presentation.connections ?? {});
      const hasConnections = Object.keys(doc.semantic.connections).length > 0;
      const unusable = cacheEntries.some(([id, presentation]) => presentation.route && (routeCacheStatus(presentation.route, signature, doc.semantic.connections[id]?.label) !== 'usable' || !routeGeometryUsable(doc, id, presentation.route, metrics)));
      const missing = hasConnections && Object.values(doc.semantic.connections).some(connection => !doc.presentation.connections?.[connection.id]?.route);
      if ((unusable || missing) && lastRouteWarning.current !== signature) {
        lastRouteWarning.current = signature;
        onShowMessage?.('Some connections are using fallback paths. Run Auto Layout to refresh route geometry.');
      }
    }).catch(() => {
      if (active) setRouteSignature(null);
    });
    return () => { active = false; };
  }, [doc.semantic, doc.presentation.nodes, doc.presentation.containers, doc.presentation.connections, onShowMessage]);

  const nodes = useMemo<Node[]>(() => {
    const result: Node[] = [];
    const containerDepth = (id: string, seen = new Set<string>()): number => {
      if (seen.has(id)) return 0;
      seen.add(id);
      const parentId = doc.semantic.containers[id]?.parentId;
      return parentId ? 1 + containerDepth(parentId, seen) : 0;
    };

    for (const [id, container] of Object.entries(doc.semantic.containers)) {
      const presentation = doc.presentation.containers[id];
      if (!presentation) continue;
      result.push({
        id,
        type: 'container',
        width: presentation.width,
        height: presentation.height,
        position: previewPositions[id] ?? { x: presentation.x, y: presentation.y },
        selected: selection.nodes.includes(id),
        dragHandle: '.kora-group-header',
        data: {
          id,
          label: container.label,
          type: container.type,
          parentId: container.parentId,
          origin: container.origin,
          width: presentation.width,
          height: presentation.height,
          titleRuns: routeMetrics ? resolveTextLayout(container.label || getContainerVisualConfig(container.type).defaultLabel, {
            maxWidth: Math.max(1, Math.min(routeMetrics.profile.headerMaxWidth, presentation.width - 10 - (getContainerVisualConfig(container.type).badgeSize ? getContainerVisualConfig(container.type).badgeSize + 6 : 0) - 14)),
            fontFamily: routeMetrics.profile.fontFamily,
            fontSize: getContainerVisualConfig(container.type).fontSize,
            fontWeight: getContainerVisualConfig(container.type).fontWeight,
            lineHeight: getContainerVisualConfig(container.type).fontSize * 1.2,
            letterSpacing: container.type === 'cloud' ? routeMetrics.profile.containerLetterSpacing : 0,
            align: 'start'
          }, textContext).runs : undefined,
          titleLineHeight: getContainerVisualConfig(container.type).fontSize * 1.2,
          onUpdateLabel: (containerId: string, newLabel: string) => {
            const originalModel = modelFromDocument(doc);
            const originalMetrics = measureVisualsFromCurrentBrowser(originalModel).containers[containerId];
            const updatedModel: KoraArchitectureModel = {
              ...originalModel,
              containers: originalModel.containers.map(item => item.id === containerId ? { ...item, label: newLabel } : item)
            };
            const updatedMetrics = measureVisualsFromCurrentBrowser(updatedModel).containers[containerId];
            if (getDocumentEpoch && getDocumentEpoch() !== documentEpochAtRender) return;
            engine.dispatch(new UpdateContainerLabelCommand(containerId, newLabel, updatedMetrics && originalMetrics ? {
              minimumWidth: updatedMetrics.width,
              oldContentTop: originalMetrics.contentTop,
              newContentTop: updatedMetrics.contentTop
            } : undefined));
          },
          onInvalidLabel: () => onShowMessage?.('Container labels cannot be blank.')
        },
        zIndex: -10 + containerDepth(id) * 2,
        selectable: true,
        draggable: true
      });
    }

    for (const [id, node] of Object.entries(doc.semantic.nodes)) {
      const presentation = doc.presentation.nodes[id];
      if (!presentation) continue;
      const measured = routeMetrics?.nodes[id];
      const effectiveBox = {
        x: presentation.x,
        y: presentation.y,
        width: Math.max(presentation.width ?? 0, measured?.width ?? resolveEffectiveNodeBox(presentation, node).width),
        height: Math.max(presentation.height ?? 0, measured?.height ?? resolveEffectiveNodeBox(presentation, node).height)
      };
      result.push({
        id,
        type: 'aws-service',
        width: effectiveBox.width,
        height: effectiveBox.height,
        position: previewPositions[id] ?? { x: presentation.x, y: presentation.y },
        selected: selection.nodes.includes(id),
        style: { width: effectiveBox.width, height: effectiveBox.height },
        data: {
          id,
          label: node.label,
          assetId: node.assetId,
          subtitle: node.subtitle,
          containerId: node.containerId,
          kind: node.kind,
          layoutWidth: effectiveBox.width,
          layoutHeight: effectiveBox.height,
          primaryRuns: routeMetrics ? resolveTextLayout(resolveNodeDisplay(node.label, node.subtitle, node.assetId).primaryLabel, {
            maxWidth: effectiveBox.width - routeMetrics.profile.nodePadding * 2,
            fontFamily: routeMetrics.profile.fontFamily,
            fontSize: 11,
            fontWeight: 600,
            lineHeight: routeMetrics.profile.nodeLineHeight,
            letterSpacing: routeMetrics.profile.nodeLetterSpacing
          }, textContext).runs : undefined,
          subtitleRuns: routeMetrics && node.subtitle ? resolveTextLayout(resolveNodeDisplay(node.label, node.subtitle, node.assetId).subtitle ?? '', {
            maxWidth: effectiveBox.width - routeMetrics.profile.nodePadding * 2,
            fontFamily: routeMetrics.profile.fontFamily,
            fontSize: 9.5,
            fontWeight: 500,
            lineHeight: routeMetrics.profile.subtitleLineHeight,
            letterSpacing: routeMetrics.profile.subtitleLetterSpacing
          }, textContext).runs : undefined,
          primaryLineHeight: routeMetrics?.profile.nodeLineHeight ?? 13.75,
          subtitleLineHeight: routeMetrics?.profile.subtitleLineHeight ?? 11.4,
          onUpdateLabel: (nodeId: string, newLabel: string, dimensions?: { width: number; height: number }) => {
            if (getDocumentEpoch && getDocumentEpoch() !== documentEpochAtRender) return;
            engine.dispatch(new UpdateNodeLabelCommand(nodeId, newLabel, dimensions));
          },
          onInvalidLabel: () => onShowMessage?.('Node labels cannot be blank.')
        },
        zIndex: 10,
        selectable: true,
        draggable: true
      });
    }
    const previousNodes = flowStore.getState().nodeLookup;
    return result.map(node => retainFlowMeasurements(node, previousNodes.get(node.id)));
  }, [doc.semantic, doc.presentation.nodes, doc.presentation.containers, engine, onShowMessage, previewPositions, selection.nodes, getDocumentEpoch, documentEpochAtRender, routeMetrics, textContext]);

  const edges = useMemo<Edge[]>(() => {
    const arrowColor = resolvedTheme === 'light' ? '#545b64' : '#8b949e';
    const geometryPreviewActive = Object.keys(previewPositions).length > 0;
    return Object.values(doc.semantic.connections).map(connection => {
      const presentation = doc.presentation.connections?.[connection.id];
      const sourceSide = presentation?.sourceSide ?? 'right';
      const targetSide = presentation?.targetSide ?? 'left';
      const route = routeSignature && routeMetrics
        ? cachedRouteForRender(doc, connection.id, presentation?.route, routeSignature, connection.label, routeMetrics, geometryPreviewActive)
        : undefined;
      const labelMaxWidth = routeMetrics
        ? Math.max(1, Math.min(routeMetrics.profile.labelMaxWidth, route?.label ? route.label.width - 14 : (routeMetrics.connections[connection.id]?.width ?? routeMetrics.profile.labelMaxWidth + 14) - 14))
        : 200;
      const labelRuns: TextLineRun[] | undefined = routeMetrics && connection.label?.trim()
        ? resolveTextLayout(connection.label, {
          maxWidth: labelMaxWidth,
          fontFamily: routeMetrics.profile.fontFamily,
          fontSize: 11,
          fontWeight: 500,
          lineHeight: routeMetrics.profile.labelLineHeight,
          letterSpacing: routeMetrics.profile.labelLetterSpacing
        }, textContext).runs
        : undefined;
      return {
        id: connection.id,
        source: connection.source,
        target: connection.target,
        sourceHandle: `${sourceSide}-source`,
        targetHandle: `${targetSide}-target`,
        type: 'aws-connection',
        selected: selection.edges.includes(connection.id),
        reconnectable: true,
        data: {
          id: connection.id,
          label: connection.label,
          relationship: connection.relationship,
          source: connection.source,
          target: connection.target,
          route,
          labelRuns,
          labelLineHeight: routeMetrics?.profile.labelLineHeight ?? 13,
          onUpdateLabel: (connectionId: string, newLabel: string) => {
            if (getDocumentEpoch && getDocumentEpoch() !== documentEpochAtRender) return;
            engine.dispatch(new UpdateConnectionLabelCommand(connectionId, newLabel));
          }
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: arrowColor, width: 16, height: 16 }
      };
    });
  }, [doc, engine, resolvedTheme, routeSignature, routeMetrics, selection.edges, previewPositions, getDocumentEpoch, documentEpochAtRender, textContext]);

  const updateDragPreview = useCallback((_nodeId: string, position: Position) => {
    const session = dragSession.current;
    if (!session || session.cancelled || engine.revision !== session.revision) return;
    setPreviewPositions(previewMovement(session.moves, session.anchorId, session.pointerId, position, snapToGrid, gridSize).positions);
  }, [engine, snapToGrid]);

  const onNodeDragStart: OnNodeDrag = useCallback((_, node, draggedNodes) => {
    onInvalidateOperations?.();
    cancelActiveLayoutJobs();
    const explicitIds = (draggedNodes?.length ? draggedNodes : [node]).map(item => item.id);
    const moves = buildMovementClosure(doc, explicitIds);
    if (!moves[node.id]) return;
    const anchorId = explicitIds.filter(id => moves[id]).sort()[0] ?? node.id;
    dragSession.current = { revision: engine.revision, anchorId, pointerId: node.id, moves, cancelled: false };
  }, [doc, engine, onInvalidateOperations]);

  const onNodeDrag: OnNodeDrag = useCallback((_, node) => {
    updateDragPreview(node.id, node.position);
  }, [updateDragPreview]);

  const onNodeDragStop: OnNodeDrag = useCallback((_, node) => {
    const session = dragSession.current;
    if (!session) return;
    if (!session.cancelled && engine.revision === session.revision) {
      const result = previewMovement(session.moves, session.anchorId, session.pointerId, node.position, snapToGrid, gridSize);
      const moves: Record<string, MoveEntry> = {};
      for (const [id, move] of Object.entries(session.moves)) {
        moves[id] = { ...move, to: result.positions[id] ?? move.from };
      }
      engine.dispatch(new MoveDiagramObjectsCommand(moves));
    }
    dragSession.current = null;
    setPreviewPositions({});
  }, [engine, snapToGrid]);

  const onReconnect = useCallback((edge: Edge, connection: Connection) => {
    if (!connection.source || !connection.target) return;
    engine.dispatch(new ReconnectConnectionCommand(edge.id, connection.source, connection.target, connection.sourceHandle, connection.targetHandle));
  }, [engine]);

  const onConnect: OnConnect = useCallback(connection => {
    if (!connection.source || !connection.target) return;
    const newConnection: IRConnection = {
      id: connectionId(doc),
      source: connection.source,
      target: connection.target,
      relationship: 'request',
      label: ''
    };
    const sourceSide = connection.sourceHandle ? sideFromHandle(connection.sourceHandle, 'right') : undefined;
    const targetSide = connection.targetHandle ? sideFromHandle(connection.targetHandle, 'left') : undefined;
    engine.dispatch(new CreateConnectionCommand(newConnection, { sourceSide, targetSide }));
  }, [doc, engine]);

  const onConnectStart = useCallback(() => {
    onInvalidateOperations?.();
    cancelActiveLayoutJobs();
  }, [onInvalidateOperations]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const selected = changes.filter(change => change.type === 'select');
    if (!selected.length) return;
    setSelection(current => {
      const ids = new Set(current.nodes);
      for (const change of selected) {
        if (change.selected) ids.add(change.id);
        else ids.delete(change.id);
      }
      return { ...current, nodes: [...ids] };
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const selected = changes.filter(change => change.type === 'select');
    if (!selected.length) return;
    setSelection(current => {
      const ids = new Set(current.edges);
      for (const change of selected) {
        if (change.selected) ids.add(change.id);
        else ids.delete(change.id);
      }
      return { ...current, edges: [...ids] };
    });
  }, []);

  const commitNudge = useCallback((key: string) => {
    const session = keyboardSession.current;
    if (!session || session.key !== key) return;
    const moves: Record<string, MoveEntry> = {};
    for (const [id, move] of Object.entries(session.moves)) {
      moves[id] = { ...move, to: { x: move.from.x + session.delta.x, y: move.from.y + session.delta.y } };
    }
    engine.dispatch(new MoveDiagramObjectsCommand(moves, 'Nudge Selection'));
    keyboardSession.current = null;
    setPreviewPositions({});
  }, [engine]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Escape' && (dragSession.current || keyboardSession.current)) {
        if (dragSession.current) dragSession.current.cancelled = true;
        dragSession.current = null;
        keyboardSession.current = null;
        setPreviewPositions({});
        event.preventDefault();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selectedConnections = selection.edges;
        const selectedNodes = selection.nodes.filter(id => Boolean(doc.semantic.nodes[id]));
        const selectedContainers = selection.nodes.filter(id => Boolean(doc.semantic.containers[id]));
        if (selectedConnections.length || selectedNodes.length || selectedContainers.length) {
          cancelActiveInteractions();
          onInvalidateOperations?.();
          cancelActiveLayoutJobs();
          event.preventDefault();
          engine.dispatch(new DeleteSelectionCommand(selectedNodes, selectedContainers, selectedConnections));
          setSelection({ nodes: [], edges: [] });
        }
        return;
      }
      const arrows: Record<string, Position> = {
        ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }
      };
      const direction = arrows[event.key];
      if (!direction || !selection.nodes.length) return;
      event.preventDefault();
      onInvalidateOperations?.();
      cancelActiveLayoutJobs();
      if (keyboardSession.current && keyboardSession.current.key !== event.key) commitNudge(keyboardSession.current.key);
      const current = engine.getDocument();
      const moves = buildMovementClosure(current, selection.nodes);
      if (!keyboardSession.current || keyboardSession.current.key !== event.key) {
        keyboardSession.current = { key: event.key, moves, delta: { x: 0, y: 0 } };
      }
      const session = keyboardSession.current;
      const unit = snapToGrid ? gridSize : 1;
      session.delta.x += direction.x * unit;
      session.delta.y += direction.y * unit;
      const preview: Record<string, Position> = {};
      for (const [id, move] of Object.entries(session.moves)) preview[id] = { x: move.from.x + session.delta.x, y: move.from.y + session.delta.y };
      setPreviewPositions(preview);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (keyboardSession.current?.key === event.key) commitNudge(event.key);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        dragSession.current = null;
        keyboardSession.current = null;
        setPreviewPositions({});
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [commitNudge, doc, engine, onInvalidateOperations, selection, snapToGrid]);

  useEffect(() => {
    const session = dragSession.current;
    if (session && session.revision !== engine.revision) {
      dragSession.current = null;
      keyboardSession.current = null;
      setPreviewPositions({});
    }
  }, [doc, engine]);

  return (
    <div
      className="kora-canvas-container"
      onMouseDownCapture={event => {
        if (event.button !== 2) return;
        const target = event.target;
        if (!(target instanceof Element) || target.closest('input, textarea, select, [contenteditable="true"], .react-flow__minimap')) return;
        // React Flow's draggable nodes carry nopan. Own the right-button pan
        // here so it also works across node/container bodies; left drag stays native.
        event.preventDefault();
        event.stopPropagation();
        panSession.current = { x: event.clientX, y: event.clientY, viewport: getViewport() };
      }}
      onContextMenu={event => {
        const target = event.target;
        if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return;
        event.preventDefault();
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onReconnect={onReconnect}
        onReconnectStart={onConnectStart}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={3.0}
        snapToGrid={false}
        colorMode={resolvedTheme}
        panOnDrag={[2]}
        selectionOnDrag
        selectionKeyCode="Shift"
        selectionMode={SelectionMode.Full}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        multiSelectionKeyCode={['Meta', 'Control']}
      >
        <Background id="kora-grid-minor" variant={BackgroundVariant.Lines} gap={20} lineWidth={1} color="var(--grid-minor)" />
        <Background id="kora-grid-major" variant={BackgroundVariant.Lines} gap={100} lineWidth={1.5} color="var(--grid-major)" />
        <MiniMap
          pannable
          ariaLabel="Diagram overview — drag with the left mouse button to pan"
          nodeColor={node => node.type === 'container' ? 'rgba(140, 75, 255, 0.2)' : '#ff9900'}
          maskColor={resolvedTheme === 'light' ? 'rgba(240, 243, 246, 0.6)' : 'rgba(9, 13, 18, 0.7)'}
          style={{ background: 'var(--surface-bg)', border: '1px solid var(--surface-border)', borderRadius: '6px' }}
        />
      </ReactFlow>
    </div>
  );
};
