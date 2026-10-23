'use client';

import React, { useState, useRef, useEffect } from 'react';
import { NodeProps } from '@xyflow/react';
import { ContainerType } from '@/core/ir/types';
import { getContainerVisualConfig } from '@/core/containers/registry';
import { TextLineRun } from '@/core/layout/textLayout';
import { awaitInteraction, registerActiveInteraction } from '@/core/editor/interactionSettlement';

export interface ContainerNodeData {
  id: string;
  label: string;
  type: ContainerType;
  parentId?: string;
  width: number;
  height: number;
  origin?: 'explicit' | 'system';
  titleRuns?: TextLineRun[];
  titleLineHeight?: number;
  onUpdateLabel?: (containerId: string, newLabel: string) => void;
  onInvalidLabel?: () => void;
}

export const ContainerNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const containerData = data as unknown as ContainerNodeData;
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(containerData.label || 'Container');
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedEditing = useRef(false);
  const composing = useRef(false);
  const pendingFinish = useRef<Promise<void> | null>(null);
  const pendingCommitController = useRef<AbortController | null>(null);
  const cancelRequested = useRef(false);
  const settleCurrent = useRef<(signal: AbortSignal) => Promise<void>>(async () => undefined);
  const cancelCurrent = useRef<() => void>(() => undefined);

  const config = getContainerVisualConfig(containerData.type);

  useEffect(() => {
    if (!isEditing) setLabel(containerData.label || config.defaultLabel);
  }, [containerData.label, config.defaultLabel, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const cancelEditing = () => {
    cancelRequested.current = true;
    pendingCommitController.current?.abort(new DOMException('Label edit cancelled by the workspace operation.', 'AbortError'));
    finishedEditing.current = true;
    setLabel(containerData.label || config.defaultLabel);
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
      if (label.trim()) {
        if (label !== containerData.label) {
          await awaitInteraction(document.fonts?.ready ?? Promise.resolve(), controller.signal);
          if (controller.signal.aborted || cancelRequested.current) return;
        }
        if (!controller.signal.aborted && !cancelRequested.current) {
          containerData.onUpdateLabel?.(id, label);
        }
      } else {
        containerData.onInvalidLabel?.();
        setLabel(containerData.label || config.defaultLabel);
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
    return registerActiveInteraction(`container:${id}`, signal => settleCurrent.current(signal), () => cancelCurrent.current());
  }, [id, isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing || composing.current) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing(true);
      inputRef.current?.blur();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      finishEditing(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div
      className={`kora-container-node ${config.cssClass} ${selected ? 'is-selected' : ''}`}
      style={{
        width: `${containerData.width}px`,
        height: `${containerData.height}px`
      }}
    >
      {/* Container Header (Authentic AWS Architecture Center layout) */}
        <div className="kora-group-header">
        {config.badgePath && (
          <img
            src={config.badgePath}
            alt={config.defaultLabel}
            className="kora-group-badge-icon"
            style={{
              width: `${config.badgeSize}px`,
              height: `${config.badgeSize}px`
            }}
            draggable={false}
          />
        )}

        <div className="kora-group-title-wrapper" onDoubleClick={() => { finishedEditing.current = false; cancelRequested.current = false; setLabel(containerData.label || config.defaultLabel); setIsEditing(true); }}>
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              className="kora-group-title-input nodrag nopan"
              style={{
                fontSize: `${config.fontSize}px`,
                fontWeight: config.fontWeight
              }}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => { void finishEditing(!composing.current).catch(() => undefined); }}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }}
            />
          ) : (
            <span
              className="kora-group-title"
              aria-label={label}
              style={{
                fontSize: `${config.fontSize}px`,
                fontWeight: config.fontWeight
              }}
            >
              {containerData.titleRuns
                ? containerData.titleRuns.map((run, index) => <span className="kora-text-line" style={{ lineHeight: `${containerData.titleLineHeight ?? config.fontSize * 1.2}px` }} key={`${index}:${run.text}`} aria-hidden="true">{run.text}</span>)
                : label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
