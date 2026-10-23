'use client';

import React from 'react';
import './footer.css';
import { DiagramDocument } from '@/core/diagram/types';
import { ValidationIssue } from '@/core/validation/issues';
import { PersistenceStatus } from '@/core/workspace/persistenceCoordinator';

interface EditorFooterProps {
  document: DiagramDocument;
  statusMessage?: string;
  issues?: ValidationIssue[];
  onDismissIssues?: () => void;
  saveStatus?: PersistenceStatus;
}

function persistenceLabel(status?: PersistenceStatus): string | undefined {
  if (!status) return undefined;
  if (status.state === 'loading') return 'Loading local diagram…';
  if (status.state === 'new') return 'Not saved yet';
  if (status.state === 'dirty') return 'Unsaved changes';
  if (status.state === 'saving') return 'Saving…';
  if (status.state === 'error') return 'Could not save · retry with Save';
  if (status.state === 'paused') {
    const message = status.reason === 'invalid-saved-data' ? 'Saved data is invalid · choose Load or Save' : status.reason === 'external-storage-change' ? 'Storage changed elsewhere · choose Load or Save' : 'Autosave paused · choose Load or Save';
    return status.dirty ? `${message} · unsaved changes` : message;
  }
  return status.lastSavedAt ? `Saved locally · ${new Date(status.lastSavedAt).toLocaleTimeString()}` : 'Restored local copy';
}

export const EditorFooter: React.FC<EditorFooterProps> = ({ document: doc, statusMessage, issues = [], onDismissIssues, saveStatus }) => {
  const nodeCount = Object.keys(doc.semantic.nodes).length;
  const containerCount = Object.keys(doc.semantic.containers).length;
  const connectionCount = Object.keys(doc.semantic.connections).length;

  return (
    <div className="kora-footer">
      <div className="footer-pill">
        <div className="footer-metric">
          <span>Nodes:</span>
          <span className="metric-value">{nodeCount}</span>
        </div>
        <div className="footer-metric">
          <span>Containers:</span>
          <span className="metric-value">{containerCount}</span>
        </div>
        <div className="footer-metric">
          <span>Connections:</span>
          <span className="metric-value">{connectionCount}</span>
        </div>
        <div className="footer-metric" style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: '8px' }}>
          <span>Kora V1</span>
        </div>
        {persistenceLabel(saveStatus) && <div className="footer-metric" aria-live="polite"><span>{persistenceLabel(saveStatus)}</span></div>}
        {issues.length > 0 && (
          <details className="footer-issues">
            <summary>{issues.filter(issue => issue.severity === 'error').length} errors · {issues.filter(issue => issue.severity === 'warning').length} warnings</summary>
            <div className="footer-issue-details">
              <div className="footer-issue-heading">
                <strong>Diagram checks</strong>
                {onDismissIssues && <button type="button" onClick={onDismissIssues}>Dismiss</button>}
              </div>
              <ul>
                {issues.slice(0, 30).map((issue, index) => (
                  <li key={`${issue.code}-${issue.entityId ?? ''}-${index}`}>
                    <strong>{issue.entityId ?? issue.code}</strong>: {issue.message}
                  </li>
                ))}
              </ul>
              {issues.length > 30 && <span className="footer-issue-more">Showing 30 of {issues.length} issues.</span>}
            </div>
          </details>
        )}
      </div>

      {statusMessage && (
        <div className="footer-toast">
          {statusMessage}
        </div>
      )}
    </div>
  );
};
