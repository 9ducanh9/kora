'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, ChevronUp, Key, Check } from 'lucide-react';
import './prompt.css';
import { DiagramDocument, DiagramSource } from '@/core/diagram/types';
import { cancelActiveInteractions } from '@/core/editor/interactionSettlement';
import { executeArchitecturePipeline, PipelineValidationError } from '@/core/pipeline/generationPipeline';
import { MockArchitectureParser } from '../../../tests/fixtures/mock.parser';
import { ValidationIssue } from '@/core/validation/issues';
import { ParserResponseError, readParseResponse } from '@/core/ai/parseResponse';
import type { SemanticGenerationReview } from '@/core/ai/semantics/requirements';
import { LIVECAP_CURRENT_PROMPT } from '@/core/ai/examples/livecap';
import { OperationState, OperationTicket } from '@/core/diagram/operationCoordinator';

interface PromptHeaderProps {
  onDiagramGenerated: (doc: DiagramDocument, issues: ValidationIssue[], ticket: OperationTicket) => boolean;
  onBeginOperation: () => OperationTicket;
  onInspectOperation: (ticket: OperationTicket) => OperationState;
  onFinishOperation: (ticket: OperationTicket) => boolean;
  onInvalidateOperations: () => void;
  onRegisterOperationAbort?: (ticket: OperationTicket, cancel: (reason: string) => void) => () => void;
  currentTitle?: string;
  source?: DiagramSource;
  documentEpoch?: number;
  isOpen?: boolean;
  onClose?: () => void;
}

const SAMPLE_PROMPTS = [
  {
    name: 'Acceptance Test (Sec 22)',
    text: `Draw this AWS architecture:
Users access CloudFront over HTTPS.
CloudFront routes /assets/* to a private S3 bucket.
CloudFront routes /api/* to an Application Load Balancer.
The ALB forwards traffic to ECS Fargate.
ECS runs inside a private subnet in a VPC.
ECS stores application state in DynamoDB.`
  },
  {
    name: 'LiveCap · current + feedback',
    text: LIVECAP_CURRENT_PROMPT
  },
  {
    name: 'Enterprise ServiceGremlin',
    text: `Draw this comprehensive AWS architecture:
Users access a Web UI component via CloudFront and S3.
Traffic routes through AWS WAF to Client API consisting of API Gateway and Lambda functions.
CloudWatch monitors the infrastructure with Systems Manager parameters.
VPC contains Private subnet housing Data component (Neptune graph database and OpenSearch cluster) and Discovery component (ECS microservices).
Storage management component handles AWS Cost and Usage Reports (CUR) with Athena analysis on S3 buckets.
Image deployment component orchestrates container builds with CodePipeline, CodeBuild, and ECR.`
  }
];

export const PromptHeader: React.FC<PromptHeaderProps> = ({
  onDiagramGenerated,
  onBeginOperation,
  onInspectOperation,
  onFinishOperation,
  onInvalidateOperations,
  onRegisterOperationAbort,
  currentTitle,
  source,
  documentEpoch = 0,
  isOpen = true,
  onClose
}) => {
  const [prompt, setPrompt] = useState(source?.prompt ?? '');
  const [apiKey, setApiKey] = useState('');
  const [mode, setMode] = useState<'deepseek' | 'mock'>('deepseek');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [errorDetails, setErrorDetails] = useState<{ code?: string; issues: ValidationIssue[] }>({ issues: [] });
  const [showKeyInput, setShowKeyInput] = useState(false);
  const requestSequence = useRef(0);
  const activeAttemptRef = useRef<{ requestId: number; ticket: OperationTicket; controller: AbortController; reason?: 'user' | 'timeout' | 'invalidated' | 'superseded' } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try { setApiKey(localStorage.getItem('kora_deepseek_api_key') ?? ''); } catch { setApiKey(''); }
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      onInvalidateOperations();
    }
  }, [isOpen, onInvalidateOperations]);

  useEffect(() => {
    setPrompt(source?.prompt ?? '');
    setErrorMessage('');
    setErrorDetails({ issues: [] });
  }, [documentEpoch]);

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    if (typeof window !== 'undefined') {
      try {
        if (val.trim()) localStorage.setItem('kora_deepseek_api_key', val.trim());
        else localStorage.removeItem('kora_deepseek_api_key');
      } catch { setErrorMessage('The API key could not be stored in this browser.'); }
    }
  };

  const reviewedRequirements = source?.semanticReview?.requirements;
  if (!isOpen) return null;

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setErrorDetails({ issues: [] });
    if (mode === 'mock' && prompt !== SAMPLE_PROMPTS[0].text) {
      setErrorMessage('Quick Test only runs the fixed acceptance example. Choose “Acceptance Test (Sec 22)” first.');
      return;
    }

    cancelActiveInteractions();
    const requestId = ++requestSequence.current;
    const ticket = onBeginOperation();
    const attemptPrompt = prompt;
    const attemptMode = mode;
    const attemptKey = apiKey.trim();
    const controller = new AbortController();
    const attempt = { requestId, ticket, controller, reason: undefined as 'user' | 'timeout' | 'invalidated' | 'superseded' | undefined };
    activeAttemptRef.current = attempt;
    const unregisterAbort = onRegisterOperationAbort?.(ticket, reason => {
      attempt.reason = reason === 'superseded' ? 'superseded' : 'invalidated';
      controller.abort(reason);
    });
    const attemptTimeout = window.setTimeout(() => {
      attempt.reason = 'timeout';
      controller.abort('generation-timeout');
    }, 120_000);
    setIsGenerating(true);
    setErrorMessage('');
    setStatusMessage(attemptMode === 'deepseek' ? 'Extracting requirements, drawing and checking flows…' : 'Running the fixed Quick Test fixture…');
    let accepted = false;

    try {
      let rawModel: unknown;
      let parserIssues: ValidationIssue[] = [];
      let semanticReview: SemanticGenerationReview | undefined;
      let parserMeta: { parserId: string; parserName: string; parserModel?: string };

      if (attemptMode === 'deepseek') {
        const res = await fetch('/api/parse-architecture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: attemptPrompt, apiKey: attemptKey || undefined }),
          signal: controller.signal
        });
        const rawResponse: unknown = await res.json().catch(() => undefined);
        let data;
        try {
          data = readParseResponse(rawResponse);
        } catch (error) {
          if (res.status === 401 || (error instanceof ParserResponseError && error.code === 'MISSING_PROVIDER_KEY')) setShowKeyInput(true);
          throw error;
        }
        rawModel = data.model;
        parserIssues = data.issues ?? [];
        semanticReview = data.review;
        parserMeta = {
          parserId: data.parser?.id || 'deepseek',
          parserName: data.parser?.name || 'DeepSeek (V3)',
          parserModel: data.parser?.model
        };
      } else {
        setStatusMessage('Running the fixed Quick Test fixture…');
        const mock = new MockArchitectureParser();
        const parsed = await mock.parse(attemptPrompt);
        rawModel = parsed.model;
        parserIssues = parsed.issues;
        parserMeta = {
          parserId: mock.id,
          parserName: mock.name,
          parserModel: 'offline-fixture'
        };
      }

      const stateAfterParse = onInspectOperation(ticket);
      if (stateAfterParse === 'superseded') return;
      if (stateAfterParse === 'stale') {
        setErrorMessage('The diagram changed while parsing. Run Generate again.');
        return;
      }

      setStatusMessage('2/3 Validating semantics and normalizing AWS Cloud boundary...');
      const result = await executeArchitecturePipeline(rawModel, {
        parserId: parserMeta.parserId,
        parserName: parserMeta.parserName,
        parserModel: parserMeta.parserModel,
        promptLength: attemptPrompt.length,
        parserIssues,
        requirements: semanticReview?.requirements,
        isCurrent: () => onInspectOperation(ticket) === 'current',
        signal: controller.signal,
        onProgress: stage => setStatusMessage(stage === 'measure' ? 'Measuring labels and preparing layout…' : stage === 'routing' ? 'Routing connections…' : stage === 'audit' ? 'Checking layout…' : 'Building the layout…')
      });

      const stateAfterPipeline = onInspectOperation(ticket);
      if (stateAfterPipeline === 'superseded') return;
      if (stateAfterPipeline === 'stale') {
        setErrorMessage('The diagram changed while generating. Run Generate again.');
        return;
      }

      setStatusMessage('3/3 Rendering architecture canvas...');
      const sourceMetadata: DiagramSource = {
        kind: attemptMode === 'mock' ? 'fixture' : 'prompt',
        prompt: attemptPrompt,
        parser: { id: parserMeta.parserId, ...(parserMeta.parserModel ? { model: parserMeta.parserModel } : {}) },
        generatedAt: new Date().toISOString(),
        ...(semanticReview ? { semanticReview } : {})
      };
      const documentWithSource: DiagramDocument = {
        ...result.document,
        metadata: { ...result.document.metadata, source: sourceMetadata }
      };
      accepted = onDiagramGenerated(documentWithSource, result.issues, ticket);
      if (accepted) {
        activeAttemptRef.current = null;
        onClose?.();
      }
    } catch (err: unknown) {
      if (onInspectOperation(ticket) === 'current') {
        if (attempt.reason === 'user') setErrorMessage('Generation cancelled. You can run it again when ready.');
        else if (attempt.reason === 'timeout') setErrorMessage('Generation timed out after 120 seconds. Check the prompt or connection, then retry.');
        else if (attempt.reason === 'invalidated' || attempt.reason === 'superseded') setErrorMessage('Generation stopped because the open diagram changed.');
        else {
          const msg = err instanceof Error ? err.message : 'Architecture generation failed.';
          setErrorMessage(msg.slice(0, 600));
          if (err instanceof ParserResponseError) setErrorDetails({ code: err.code, issues: err.issues });
          else if (err instanceof PipelineValidationError) setErrorDetails({ code: 'PIPELINE_VALIDATION_FAILED', issues: err.issues });
        }
      }
    } finally {
      window.clearTimeout(attemptTimeout);
      unregisterAbort?.();
      if (requestSequence.current === requestId) {
        if (!accepted) onFinishOperation(ticket);
        if (activeAttemptRef.current?.requestId === requestId) activeAttemptRef.current = null;
        setIsGenerating(false);
        setStatusMessage('');
      }
    }
  };

  const handleCancelGeneration = () => {
    const attempt = activeAttemptRef.current;
    if (!attempt) return;
    attempt.reason = 'user';
    attempt.controller.abort('user-cancelled');
  };

  return (
    <div className="kora-prompt-drawer">
      <div className="prompt-card">
        {/* Top bar */}
        <div className="prompt-header-top">
          <div className="brand-badge">
            <div className="brand-logo-icon">K</div>
            <span className="brand-name">Kora</span>
            <span className="brand-tagline">— Architecture Prompt</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="prompt-mode-toggle">
              <button
                type="button"
                className={`mode-btn ${mode === 'mock' ? 'is-active' : ''}`}
                onClick={() => setMode('mock')}
                disabled={isGenerating}
                title="Deterministic offline test fixture"
              >
                Quick Test
              </button>
              <button
                type="button"
                className={`mode-btn ${mode === 'deepseek' ? 'is-active' : ''}`}
                onClick={() => setMode('deepseek')}
                disabled={isGenerating}
                title="Real DeepSeek V3 Structured Output"
              >
                DeepSeek (V3)
              </button>
            </div>

            {mode === 'deepseek' && (
              <button
                type="button"
                className={`sample-btn ${apiKey ? 'is-active' : ''}`}
                onClick={() => setShowKeyInput(!showKeyInput)}
                disabled={isGenerating}
                title={apiKey ? 'DeepSeek API Key đã lưu (Click để đổi)' : 'Cài đặt DeepSeek API Key'}
                style={{ position: 'relative' }}
              >
                <Key size={12} />
                {apiKey && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '2px',
                      right: '2px',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: '#10b981'
                    }}
                  />
                )}
              </button>
            )}

            {onClose && (
              <button
                type="button"
                className="sample-btn"
                onClick={onClose}
                title="Close prompt overlay"
              >
                <ChevronUp size={14} />
              </button>
            )}
          </div>
        </div>

        {source && (
          <details className="prompt-source-details">
            <summary>Original prompt for {currentTitle || 'this diagram'}</summary>
            <pre>{source.prompt}</pre>
            <span>Generated by {source.parser.id}{source.parser.model ? ` · ${source.parser.model}` : ''} · {source.kind}</span>
            <button type="button" className="sample-btn" onClick={() => setPrompt(source.prompt)} disabled={isGenerating}>Restore original prompt</button>
          </details>
        )}

        {reviewedRequirements && (
          <details className="prompt-source-details">
            <summary>Yêu cầu đã đối chiếu lúc tạo · {reviewedRequirements.entities.length} thành phần · {reviewedRequirements.flows.length} luồng</summary>
            <p>Đối chiếu theo yêu cầu AI trích từ mô tả; chưa bảo đảm đã trích đầy đủ. Chỉnh sửa sơ đồ sau đó chưa được kiểm tra lại.</p>
            <details>
              <summary>Thành phần và vai trò</summary>
              <ul>{reviewedRequirements.entities.map(entity => <li key={entity.id}>{entity.label}<br /><small>Nguồn: {entity.evidence}</small></li>)}</ul>
            </details>
            <details>
              <summary>Luồng đã trích từ mô tả</summary>
              <ul>{reviewedRequirements.flows.map((flow, index) => <li key={index}>
                {[flow.from, ...(flow.via ?? []), flow.to].map(id => reviewedRequirements.entities.find(entity => entity.id === id)?.label ?? id).join(' → ')}: {flow.label}
                {flow.stage && <small> · {flow.stage}</small>}
                <br /><small>Nguồn: {flow.evidence}</small>
              </li>)}</ul>
            </details>
            {!!reviewedRequirements.contextRelations?.length && <details>
              <summary>Quan hệ triển khai</summary>
              <ul>{reviewedRequirements.contextRelations.map((relation, index) => <li key={index}>
                {[relation.from, relation.to].map(id => reviewedRequirements.entities.find(entity => entity.id === id)?.label ?? id).join(' → ')}: {relation.label}
                <br /><small>Nguồn: {relation.evidence}</small>
              </li>)}</ul>
            </details>}
            <details>
              <summary>Ghi chú, giới hạn và điểm chưa xác minh</summary>
              <ul>{reviewedRequirements.notes.map((note, index) => <li key={index}>{note.text}<br /><small>Nguồn: {note.evidence}</small></li>)}</ul>
            </details>
          </details>
        )}

        {/* API Key Drawer (Optional) */}
        {mode === 'deepseek' && showKeyInput && (
          <div
            className="api-key-input-row"
            style={{
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '6px',
              padding: '10px 12px',
              background: 'rgba(59, 130, 246, 0.06)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              borderRadius: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                🔑 DeepSeek API Key {apiKey ? '(Đã lưu)' : '(Chưa cài đặt)'}
              </span>
              <a
                href="https://platform.deepseek.com/api_keys"
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '11px', color: 'var(--accent-blue)', textDecoration: 'underline' }}
              >
                Lấy API key tại DeepSeek Platform ↗
              </a>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="password"
                placeholder="Paste DeepSeek API key"
                className="api-key-input"
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                disabled={isGenerating}
              />
              {apiKey && (
                <button
                  type="button"
                  className="sample-btn"
                  onClick={() => handleApiKeyChange('')}
                  disabled={isGenerating}
                  title="Xóa API Key đã lưu"
                  style={{ fontSize: '11px' }}
                >
                  Xóa
                </button>
              )}
            </div>
          </div>
        )}

        {/* Textarea Input */}
        {mode === 'deepseek' && <p className="prompt-generation-cost">Tự đối chiếu yêu cầu và sửa tối đa một lần · tối đa 3 lượt AI cho mỗi lần Generate.</p>}
        <div className="prompt-input-area">
          <textarea
            className="prompt-textarea"
            placeholder="Describe your AWS architecture in detail (e.g. 'Users access CloudFront over HTTPS. CloudFront routes /assets/* to S3 and /api/* to an ALB...')"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isGenerating}
          />
        </div>

        {/* Actions Bar */}
        <div className="prompt-actions-bar">
          <div className="sample-prompts-group">
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Examples:</span>
            {SAMPLE_PROMPTS.map((sample) => (
              <button
                key={sample.name}
                type="button"
                className="sample-btn"
                onClick={() => setPrompt(sample.text)}
                disabled={isGenerating}
              >
                {sample.name}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {isGenerating && <button type="button" className="sample-btn" onClick={handleCancelGeneration}>Cancel generation</button>}
            <button
              type="button"
              className="generate-btn"
              onClick={handleGenerate}
              onPointerDown={cancelActiveInteractions}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') cancelActiveInteractions(); }}
              disabled={isGenerating || !prompt.trim()}
            >
              <Sparkles size={14} />
              {isGenerating ? 'Generating...' : 'Generate Architecture'}
            </button>
          </div>
        </div>

        {/* Progress or Error Feedback */}
        {isGenerating && (
          <div className="generation-status-box">
            <div className="status-spinner" />
            <span className="status-text">{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="generation-error-box" role="alert">
            <div>
              <strong>Lỗi:</strong> {errorMessage}
            </div>
            {(errorDetails.code || errorDetails.issues.length > 0) && (
              <details className="generation-error-details">
                <summary>Chi tiết kỹ thuật{errorDetails.issues.length ? ` (${errorDetails.issues.length})` : ''}</summary>
                {errorDetails.code && <code>{errorDetails.code}</code>}
                <ul>
                  {errorDetails.issues.slice(0, 30).map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>
                      <code>{issue.code} · {issue.path.join('.') || '<root>'}</code>
                      <span>{issue.message.slice(0, 300)}</span>
                    </li>
                  ))}
                </ul>
                {errorDetails.issues.length > 30 && <span>Hiển thị 30/{errorDetails.issues.length} lỗi.</span>}
              </details>
            )}
            {!isGenerating && prompt.trim() && <button type="button" className="sample-btn" onClick={handleGenerate}>Retry generation</button>}
            {errorMessage.toLowerCase().includes('api key') && (
              <div style={{ marginTop: '8px', fontSize: '12px', lineHeight: 1.4, opacity: 0.95 }}>
                Open API key settings above, or choose Quick Test to run the fixed offline fixture.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
