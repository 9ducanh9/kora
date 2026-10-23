'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  EdgeProps,
  EdgeLabelRenderer,
  BaseEdge
} from '@xyflow/react';
import { ConnectionRoute } from '@/core/diagram/types';
import { resolveConnectionGeometry } from '@/core/layout/connectionGeometry';
import { registerActiveInteraction } from '@/core/editor/interactionSettlement';
import { TextLineRun } from '@/core/layout/textLayout';

export interface AwsConnectionEdgeData {
  id: string;
  source?: string;
  target?: string;
  label?: string;
  relationship?: string;
  route?: ConnectionRoute;
  labelRuns?: TextLineRun[];
  labelLineHeight?: number;
  onUpdateLabel?: (connectionId: string, newLabel: string) => void;
  onInvalidLabel?: () => void;
}

export const AwsConnectionEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected
}) => {
  const edgeData = data as unknown as AwsConnectionEdgeData;
  const route = edgeData?.route;
  const geometry = resolveConnectionGeometry({
    source: { x: sourceX, y: sourceY }, target: { x: targetX, y: targetY },
    sourceSide: sourcePosition, targetSide: targetPosition,
    sourceId: edgeData?.source, targetId: edgeData?.target, route
  });

  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(edgeData?.label || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedEditing = useRef(false);
  const composing = useRef(false);
  const settleCurrent = useRef<(signal: AbortSignal) => Promise<void>>(async () => undefined);
  const cancelCurrent = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!isEditing) setLabel(edgeData?.label ?? '');
  }, [edgeData?.label, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const cancelEditing = () => {
    finishedEditing.current = true;
    setLabel(edgeData?.label ?? '');
    setIsEditing(false);
  };

  const finishEditing = (commit: boolean) => {
    if (!commit) { cancelEditing(); return; }
    if (finishedEditing.current) return;
    finishedEditing.current = true;
    setIsEditing(false);
    if (label !== (edgeData?.label ?? '')) edgeData?.onUpdateLabel?.(id, label);
  };

  settleCurrent.current = async signal => {
    if (signal.aborted) throw signal.reason ?? new DOMException('Label settlement cancelled.', 'AbortError');
    finishEditing(true);
  };
  cancelCurrent.current = cancelEditing;

  useEffect(() => {
    if (!isEditing) return;
    return registerActiveInteraction(`connection:${id}`, signal => settleCurrent.current(signal), () => cancelCurrent.current());
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
    <>
      <BaseEdge
        id={id}
        path={geometry.path}
        markerEnd={markerEnd}
        className={`kora-connection-edge ${selected ? 'is-selected' : ''}`}
      />
      {(label || isEditing || selected) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${geometry.labelX}px,${geometry.labelY}px)`,
              pointerEvents: 'all',
              ...(route?.label ? { width: `${route.label.width}px`, height: `${route.label.height}px` } : {})
            }}
            className="kora-edge-label-container"
            onDoubleClick={() => { finishedEditing.current = false; setLabel(edgeData?.label ?? ''); setIsEditing(true); }}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                className="kora-edge-label-input nodrag nopan"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={() => finishEditing(!composing.current)}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; }}
                placeholder="Label"
              />
            ) : (
              <span className={`kora-edge-label ${edgeData?.labelRuns ? 'kora-edge-label-lines' : ''}`} aria-label={label || (selected ? '+ Label' : '')}>
                {edgeData?.labelRuns
                  ? edgeData.labelRuns.map((run, index) => <span className="kora-text-line" style={{ lineHeight: `${edgeData.labelLineHeight ?? 13}px` }} key={`${index}:${run.text}`} aria-hidden="true">{run.text}</span>)
                  : label || (selected ? '+ Label' : '')}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
