import type { ValidationIssue } from '../validation/issues';

export const DOCUMENT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxEntities: 5_000,
  maxTextField: 10_000,
  maxVisibleText: 200_000,
  maxRoutePoints: 100_000,
  maxPointsPerConnection: 10_000,
  maxContainerDepth: 64
} as const;

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const failure = (message: string): ValidationIssue[] => [{ code: 'DOCUMENT_RESOURCE_LIMIT', severity: 'error', path: [], message }];

/** Run before schema parsing, text measurement, or React Flow sees the input. */
export function checkDocumentResources(raw: unknown): ValidationIssue[] {
  const document = record(raw), semantic = record(document.semantic), presentation = record(document.presentation);
  const nodes = record(semantic.nodes), containers = record(semantic.containers), connections = record(semantic.connections);
  if (Object.keys(nodes).length + Object.keys(containers).length + Object.keys(connections).length > DOCUMENT_LIMITS.maxEntities) {
    return failure(`Documents support up to ${DOCUMENT_LIMITS.maxEntities} total entities.`);
  }
  let totalText = 0;
  const text = (value: unknown) => {
    if (typeof value !== 'string') return false;
    totalText += value.length;
    return value.length > DOCUMENT_LIMITS.maxTextField || totalText > DOCUMENT_LIMITS.maxVisibleText;
  };
  if (text(record(document.metadata).title)) return failure('Document text exceeds the supported limit.');
  for (const collection of [nodes, containers, connections]) {
    for (const item of Object.values(collection)) {
      const entity = record(item);
      if (text(entity.label) || text(entity.subtitle)) return failure('Document text exceeds the supported limit.');
    }
  }
  let routePoints = 0;
  for (const item of Object.values(record(presentation.connections))) {
    const points = record(record(item).route).points;
    if (!Array.isArray(points)) continue;
    routePoints += points.length;
    if (points.length > DOCUMENT_LIMITS.maxPointsPerConnection || routePoints > DOCUMENT_LIMITS.maxRoutePoints) return failure('Document routes exceed the supported point limit.');
  }
  for (const id of Object.keys(containers)) {
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current && containers[current] && !seen.has(current)) {
      seen.add(current);
      if (seen.size > DOCUMENT_LIMITS.maxContainerDepth) return failure(`Container nesting supports at most ${DOCUMENT_LIMITS.maxContainerDepth} levels.`);
      const parentId: unknown = record(containers[current]).parentId;
      current = typeof parentId === 'string' ? parentId : undefined;
    }
  }
  return [];
}
