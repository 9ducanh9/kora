import { DiagramDocument } from './types';
import { DiagramDocumentSchema } from './schema';
import { checkDocumentResources, DOCUMENT_LIMITS } from './resourceLimits';
import { validateArchitectureModel } from '../ir/validator';
import { ValidationIssue, ValidationResult, validationFailure, validationSuccess, zodIssues } from '../validation/issues';

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function issue(code: string, path: Array<string | number>, message: string, severity: 'error' | 'warning' = 'error', entityId?: string): ValidationIssue {
  return { code, path, message, severity, entityId };
}

function semanticIssuePath(issuePath: Array<string | number>, doc: DiagramDocument): Array<string | number> {
  const [collection, index, ...rest] = issuePath;
  if (typeof index !== 'number') return ['semantic', ...issuePath];
  const ids = collection === 'nodes'
    ? Object.keys(doc.semantic.nodes)
    : collection === 'connections'
      ? Object.keys(doc.semantic.connections)
      : Object.keys(doc.semantic.containers);
  return ['semantic', collection, ids[index] ?? index, ...rest];
}

export function validateDiagramDocument(raw: unknown): ValidationResult<DiagramDocument> {
  const resourceIssues = checkDocumentResources(raw);
  if (resourceIssues.length) return validationFailure(resourceIssues);
  const parsed = DiagramDocumentSchema.safeParse(raw);
  if (!parsed.success) return validationFailure(zodIssues(parsed.error.issues, 'DOCUMENT_SCHEMA'));

  const document = parsed.data as DiagramDocument;
  const issues: ValidationIssue[] = [];
  const records: Array<[string, Record<string, { id: string }>]> = [
    ['semantic.nodes', document.semantic.nodes],
    ['semantic.connections', document.semantic.connections],
    ['semantic.containers', document.semantic.containers]
  ];

  for (const [recordPath, record] of records) {
    for (const key of Object.keys(record)) {
      if (RESERVED_KEYS.has(key)) issues.push(issue('DOCUMENT_RESERVED_KEY', [recordPath.split('.')[0], recordPath.split('.')[1], key], 'This key is reserved for safe dictionary use.', 'error', key));
      if (record[key].id !== key) issues.push(issue('DOCUMENT_RECORD_KEY_MISMATCH', [recordPath.split('.')[0], recordPath.split('.')[1], key, 'id'], `Record key '${key}' must equal its entity ID '${record[key].id}'.`, 'error', key));
    }
  }

  for (const [kind, semantic] of [['nodes', document.semantic.nodes], ['containers', document.semantic.containers]] as const) {
    const semanticKeys = Object.keys(semantic).sort();
    const presentationKeys = Object.keys(document.presentation[kind]).sort();
    const missing = semanticKeys.filter(key => !presentationKeys.includes(key));
    const extra = presentationKeys.filter(key => !semanticKeys.includes(key));
    for (const id of missing) issues.push(issue('DOCUMENT_PRESENTATION_MISSING', ['presentation', kind, id], `Presentation is missing for ${kind.slice(0, -1)} '${id}'.`, 'error', id));
    for (const id of extra) issues.push(issue('DOCUMENT_PRESENTATION_ORPHAN', ['presentation', kind, id], `Presentation has no matching semantic ${kind.slice(0, -1)} '${id}'.`, 'error', id));
  }

  if (document.presentation.connections) {
    const connectionIds = new Set(Object.keys(document.semantic.connections));
    for (const key of Object.keys(document.presentation.connections)) {
      if (RESERVED_KEYS.has(key)) issues.push(issue('DOCUMENT_RESERVED_KEY', ['presentation', 'connections', key], 'This key is reserved for safe dictionary use.', 'error', key));
      if (!connectionIds.has(key)) issues.push(issue('DOCUMENT_CONNECTION_PRESENTATION_ORPHAN', ['presentation', 'connections', key], `Connection presentation '${key}' has no semantic connection.`, 'error', key));
    }
  }

  if (!document.metadata.title.trim()) issues.push(issue('DOCUMENT_TITLE_EMPTY', ['metadata', 'title'], 'Document title cannot contain only whitespace.'));

  const irValidation = validateArchitectureModel({
    version: '1.0',
    scope: document.semantic.scope,
    nodes: Object.values(document.semantic.nodes),
    connections: Object.values(document.semantic.connections),
    containers: Object.values(document.semantic.containers)
  });
  for (const semanticIssue of irValidation.issues) {
    issues.push({ ...semanticIssue, path: semanticIssuePath(semanticIssue.path, document) });
  }

  const cloudCount = Object.values(document.semantic.containers).filter(container => container.type === 'cloud').length;
  if (cloudCount !== 1) {
    issues.push(issue('AWS_CLOUD_NONCANONICAL', ['semantic', 'containers'], `Document contains ${cloudCount} AWS Cloud boundaries; saved geometry and identities were preserved.`, 'warning'));
  }

  const errors = issues.filter(item => item.severity === 'error');
  if (errors.length > 0 || !irValidation.ok) return validationFailure(issues);
  return validationSuccess(document, issues);
}

export function decodeDiagramDocument(json: string): ValidationResult<DiagramDocument> {
  if (json.length > DOCUMENT_LIMITS.maxBytes || new TextEncoder().encode(json).byteLength > DOCUMENT_LIMITS.maxBytes) {
    return validationFailure([issue('DOCUMENT_RESOURCE_LIMIT', [], 'Diagram JSON exceeds the 10 MiB limit.')]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON.';
    return validationFailure([issue('DOCUMENT_JSON_SYNTAX', [], `Could not parse diagram JSON: ${message}`)]);
  }
  return validateDiagramDocument(raw);
}
