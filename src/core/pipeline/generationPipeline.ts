import { KoraArchitectureModel } from '../ir/types';
import { validateArchitectureModel } from '../ir/validator';
import { resolveAssetDetailed } from '../assets/registry';
import { prepareArchitectureModel } from '../architecture/prepareModel';
import { LayoutResult } from '../layout/elkCompoundLayout';
import { computeBestCompoundLayoutInWorker } from '../layout/layoutWorkerClient';
import { measureVisualsInBrowser } from '../layout/visualMetrics';
import { DiagramDocument } from '../diagram/types';
import { validateDiagramDocument } from '../diagram/validator';
import { ValidationIssue, deduplicateIssues, formatValidationIssues } from '../validation/issues';
import { ArchitectureRequirements } from '../ai/semantics/requirements';
import { checkSemanticRequirements } from '../ai/semantics/checkModel';

export interface PipelineDiagnostics {
  parser: { id: string; name: string; model?: string };
  promptLength: number;
  rawCounts: { nodes: number; edges: number; containers: number };
  validatedCounts: { nodes: number; edges: number; containers: number };
  normalizedCounts: { nodes: number; edges: number; containers: number };
  diagramDocumentCounts: { nodes: number; edges: number; containers: number };
  presentationObjectCounts: { nodes: number; containers: number; connections: number };
  assetResolution: { resolvedCount: number; fallbackCount: number; unresolvedNodeIds: string[] };
  layout: { profile: 'base' | 'spacious'; metricsSource: string; findings: Array<{ code: string; severity: string; entityIds: string[] }> };
}

export interface PipelineExecutionResult {
  document: DiagramDocument;
  model: KoraArchitectureModel;
  diagnostics: PipelineDiagnostics;
  issues: ValidationIssue[];
}

export interface PipelineExecutionOptions {
  parserId: string;
  parserName: string;
  parserModel?: string;
  promptLength: number;
  parserIssues?: ValidationIssue[];
  requirements?: ArchitectureRequirements;
  isCurrent?: () => boolean;
  signal?: AbortSignal;
  onProgress?: (stage: 'measure' | 'layout' | 'routing' | 'audit') => void;
}

export class PipelineValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(formatValidationIssues(issues));
    this.name = 'PipelineValidationError';
  }
}

export async function executeArchitecturePipeline(
  rawModel: unknown,
  options: PipelineExecutionOptions
): Promise<PipelineExecutionResult> {
  if (options.signal?.aborted) throw new DOMException('Generation was cancelled.', 'AbortError');
  const validation = validateArchitectureModel(rawModel);
  if (!validation.ok) throw new PipelineValidationError(validation.issues);

  const validatedModel = validation.value;
  const rawCounts = {
    nodes: validatedModel.nodes.length,
    edges: validatedModel.connections.length,
    containers: validatedModel.containers.length
  };
  const validatedCounts = { ...rawCounts };
  const assetResolution = { resolvedCount: 0, fallbackCount: 0, unresolvedNodeIds: [] as string[] };
  for (const node of validatedModel.nodes) {
    const resolution = resolveAssetDetailed({ assetId: node.assetId, label: node.label });
    if (resolution.source === 'fallback') {
      assetResolution.fallbackCount++;
      assetResolution.unresolvedNodeIds.push(node.id);
    } else {
      assetResolution.resolvedCount++;
    }
  }

  const preparedModel = prepareArchitectureModel(validatedModel);
  if (options.signal?.aborted) throw new DOMException('Generation was cancelled.', 'AbortError');
  const normalizedValidation = validateArchitectureModel(preparedModel);
  if (!normalizedValidation.ok) throw new PipelineValidationError(normalizedValidation.issues);
  if (options.requirements) {
    const semanticIssues = checkSemanticRequirements(normalizedValidation.value, options.requirements);
    if (semanticIssues.length) throw new PipelineValidationError(semanticIssues);
  }

  const normalizedCounts = {
    nodes: normalizedValidation.value.nodes.length,
    edges: normalizedValidation.value.connections.length,
    containers: normalizedValidation.value.containers.length
  };
  options.onProgress?.('measure');
  const metrics = await measureVisualsInBrowser(normalizedValidation.value, { signal: options.signal });
  if (options.isCurrent && !options.isCurrent()) throw new DOMException('Generation was superseded during visual measurement.', 'AbortError');
  if (options.signal?.aborted) throw new DOMException('Generation was cancelled.', 'AbortError');
  const layoutResult: LayoutResult = await computeBestCompoundLayoutInWorker(normalizedValidation.value, { metrics, timeoutMs: 10000, signal: options.signal, onProgress: options.onProgress });
  const document = layoutResult.document;
  const documentValidation = validateDiagramDocument(document);
  if (!documentValidation.ok) throw new PipelineValidationError(documentValidation.issues);

  const issues = deduplicateIssues([
    ...(options.parserIssues ?? []),
    ...validation.issues,
    ...normalizedValidation.issues,
    ...documentValidation.issues,
    ...layoutResult.findings.map(finding => ({
      code: finding.code,
      severity: finding.severity === 'blocking' ? 'warning' as const : 'info' as const,
      path: ['layout', ...finding.entityIds],
      message: `${finding.code.replaceAll('_', ' ').toLowerCase()}${finding.entityIds.length ? `: ${finding.entityIds.join(', ')}` : ''}.`,
      entityId: finding.entityIds[0]
    }))
  ]);
  const diagnostics: PipelineDiagnostics = {
    parser: { id: options.parserId, name: options.parserName, model: options.parserModel },
    promptLength: options.promptLength,
    rawCounts,
    validatedCounts,
    normalizedCounts,
    diagramDocumentCounts: {
      nodes: Object.keys(document.semantic.nodes).length,
      edges: Object.keys(document.semantic.connections).length,
      containers: Object.keys(document.semantic.containers).length
    },
    presentationObjectCounts: {
      nodes: Object.keys(document.presentation.nodes).length,
      containers: Object.keys(document.presentation.containers).length,
      connections: Object.keys(document.semantic.connections).length
    },
    assetResolution,
    layout: {
      profile: layoutResult.profile,
      metricsSource: metrics.profile.source,
      findings: layoutResult.findings.map(({ code, severity, entityIds }) => ({ code, severity, entityIds }))
    }
  };

  return { document, model: normalizedValidation.value, diagnostics, issues };
}
