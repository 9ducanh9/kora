'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { resolveAsset } from '@/core/assets/registry';
import { getNodeDimensions } from '@/core/layout/nodeDimensions';
import { measureVisualsFromCurrentBrowser } from '@/core/layout/visualMetrics';
import { TextLineRun } from '@/core/layout/textLayout';
import { awaitInteraction, registerActiveInteraction } from '@/core/editor/interactionSettlement';

export interface AwsServiceNodeData {
  id: string;
  label: string;
  assetId?: string;
  subtitle?: string;
  containerId?: string;
  kind?: string;
  layoutWidth?: number;
  layoutHeight?: number;
  primaryRuns?: TextLineRun[];
  subtitleRuns?: TextLineRun[];
  primaryLineHeight?: number;
  subtitleLineHeight?: number;
  onUpdateLabel?: (nodeId: string, newLabel: string, dimensions?: { width: number; height: number }) => void;
  onInvalidLabel?: () => void;
}

export const AwsServiceNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const nodeData = data as unknown as AwsServiceNodeData;
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedEditing = useRef(false);
  const composing = useRef(false);
  const pendingFinish = useRef<Promise<void> | null>(null);
  const pendingCommitController = useRef<AbortController | null>(null);
  const cancelRequested = useRef(false);
  const settleCurrent = useRef<(signal: AbortSignal) => Promise<void>>(async () => undefined);
  const cancelCurrent = useRef<() => void>(() => undefined);

  // Compute deterministic dimensions and presentation labels using shared resolver
  const dims = useMemo(() => {
    const measured = getNodeDimensions({
      label: nodeData.label || 'Service',
      subtitle: nodeData.subtitle,
      assetId: nodeData.assetId
    });
    return {
      ...measured,
      width: Math.max(nodeData.layoutWidth ?? 0, measured.width),
      height: Math.max(nodeData.layoutHeight ?? 0, measured.height)
    };
  }, [nodeData.label, nodeData.subtitle, nodeData.assetId, nodeData.layoutWidth, nodeData.layoutHeight]);

  const [editValue, setEditValue] = useState(dims.resolvedPrimaryLabel);

  useEffect(() => {
    if (!isEditing) setEditValue(nodeData.label);
  }, [isEditing, nodeData.label]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const asset = resolveAsset(nodeData.assetId || nodeData.label);
  const isExternal = asset.category === 'external' || asset.category === 'generic' || nodeData.kind === 'external' || nodeData.kind === 'actor';

  const cancelEditing = () => {
    cancelRequested.current = true;
    pendingCommitController.current?.abort(new DOMException('Label edit cancelled by the workspace operation.', 'AbortError'));
    finishedEditing.current = true;
    setEditValue(nodeData.label);
    setIsEditing(false);
  };

  const finishEditing = (commit: boolean, signal?: AbortSignal): Promise<void> => {
    if (!commit) { cancelEditing(); return Promise.resolve(); }
    if (finishedEditing.current) return pendingFinish.current ?? Promise.resolve();
    finishedEditing.current = true;
    cancelRequested.current = false;
    const controller = new AbortController();
    pendingCommitController.current = controller;
    const onAbort = () => controller.abort(signal?.reason ?? new DOMException('Label settlement cancelled.', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const task = (async () => {
      if (commit && editValue.trim()) {
        if (editValue !== nodeData.label) {
          await awaitInteraction(document.fonts?.ready ?? Promise.resolve(), controller.signal);
          if (controller.signal.aborted || cancelRequested.current) return;
          const measured = measureVisualsFromCurrentBrowser({
            version: '1.0',
            nodes: [{ id, label: editValue, kind: nodeData.kind === 'aws-service' || nodeData.kind === 'aws-resource' || nodeData.kind === 'external' || nodeData.kind === 'actor' ? nodeData.kind : 'generic', assetId: nodeData.assetId, subtitle: nodeData.subtitle }],
            connections: [],
            containers: []
          }).nodes[id];
          if (controller.signal.aborted || cancelRequested.current) return;
          nodeData.onUpdateLabel?.(id, editValue, { width: measured.width, height: measured.height });
        }
      } else {
        nodeData.onInvalidLabel?.();
        setEditValue(nodeData.label);
      }
      if (!cancelRequested.current) setIsEditing(false);
    })().catch(error => {
      if (cancelRequested.current) return;
      finishedEditing.current = false;
      setIsEditing(true);
      inputRef.current?.focus();
      throw error;
    }).finally(() => {
      signal?.removeEventListener('abort', onAbort);
      if (pendingCommitController.current === controller) pendingCommitController.current = null;
      pendingFinish.current = null;
    });
    pendingFinish.current = task;
    return task;
  };
  settleCurrent.current = signal => finishEditing(true, signal);
  cancelCurrent.current = cancelEditing;

  useEffect(() => {
    if (!isEditing) return;
    return registerActiveInteraction(`node:${id}`, signal => settleCurrent.current(signal), () => cancelCurrent.current());
  }, [id, isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing || composing.current) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing(true);
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishEditing(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div
      className={`aws-service-node ${selected ? 'is-selected' : ''} ${isExternal ? 'is-external' : ''}`}
      style={{
        width: `${nodeData.layoutWidth ?? dims.width}px`,
        height: `${nodeData.layoutHeight ?? dims.height}px`
      }}
      title={`${dims.resolvedPrimaryLabel}${dims.hasSubtitle ? ` (${dims.resolvedSubtitle})` : ''}`}
    >
      {/* 4 Magnetic Handles (Hidden by default, revealed on hover/select/connection) */}
      <Handle type="target" position={Position.Top} id="top-target" className="kora-handle kora-handle-target" />
      <Handle type="source" position={Position.Top} id="top-source" className="kora-handle kora-handle-source" />

      <Handle type="target" position={Position.Right} id="right-target" className="kora-handle kora-handle-target" />
      <Handle type="source" position={Position.Right} id="right-source" className="kora-handle kora-handle-source" />

      <Handle type="target" position={Position.Bottom} id="bottom-target" className="kora-handle kora-handle-target" />
      <Handle type="source" position={Position.Bottom} id="bottom-source" className="kora-handle kora-handle-source" />

      <Handle type="target" position={Position.Left} id="left-target" className="kora-handle kora-handle-target" />
      <Handle type="source" position={Position.Left} id="left-source" className="kora-handle kora-handle-source" />

      {/* Node Icon Box */}
      <div className="aws-icon-wrapper">
        <img
          src={asset.assetPath}
          alt={asset.displayName}
          className="aws-service-icon"
          draggable={false}
        />
      </div>

      {/* Node Label & Presentation Subtitle */}
      <div className="aws-node-label-container nodrag nopan" onDoubleClick={() => { finishedEditing.current = false; cancelRequested.current = false; setEditValue(nodeData.label); setIsEditing(true); }}>
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            className="aws-node-label-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => { void finishEditing(!composing.current).catch(() => undefined); }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
          />
        ) : (
          <span className={`aws-node-label ${nodeData.primaryRuns ? 'aws-node-label-lines' : ''}`} aria-label={dims.resolvedPrimaryLabel}>
            {nodeData.primaryRuns
              ? nodeData.primaryRuns.map((run, index) => <span className="kora-text-line" style={{ lineHeight: `${nodeData.primaryLineHeight ?? 13.75}px` }} key={`${index}:${run.text}`} aria-hidden="true">{run.text}</span>)
              : dims.resolvedPrimaryLabel}
          </span>
        )}

        {/* Presentation-Only Subtitle (Never mutates IR) */}
        {dims.hasSubtitle && (
          <span className={`aws-node-subtitle ${nodeData.subtitleRuns ? 'aws-node-subtitle-lines' : ''}`} aria-label={dims.resolvedSubtitle}>
            {nodeData.subtitleRuns
              ? nodeData.subtitleRuns.map((run, index) => <span className="kora-text-line" style={{ lineHeight: `${nodeData.subtitleLineHeight ?? 11.4}px` }} key={`${index}:${run.text}`} aria-hidden="true">{run.text}</span>)
              : dims.resolvedSubtitle}
          </span>
        )}
      </div>
    </div>
  );
};

