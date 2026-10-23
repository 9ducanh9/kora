import { validateArchitectureModel } from '../ir/validator';
import { ValidationIssue } from '../validation/issues';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Provider-only adaptation. Never drops fields, entities or broken references. */
export function validateProviderArchitectureModel(raw: unknown) {
  const adaptations: ValidationIssue[] = [];
  let candidate = raw;
  if (isRecord(raw) && Array.isArray(raw.connections)) {
    candidate = {
      ...raw,
      connections: raw.connections.map((connection: unknown, index: number) => {
        if (!isRecord(connection)) return connection;
        const relationship = connection.relationship;
        const text = typeof connection.label === 'string' ? connection.label : '';
        // Media is a data stream. Deployment is a data flow only when the label
        // explicitly describes image/artifact transfer, not a generic control action.
        const imageTransfer = /\b(?:image|artifact)\b.*\b(?:pull|push|download|upload|transfer)\b|\bpull\b.*\bimage\b/i.test(text);
        if (relationship !== 'media' && !(relationship === 'deploy' && imageTransfer)) return connection;
        adaptations.push({
          code: 'PROVIDER_RELATIONSHIP_NORMALIZED',
          severity: 'info',
          path: ['connections', index, 'relationship'],
          entityId: typeof connection.id === 'string' ? connection.id : undefined,
          message: `Relationship '${relationship}' normalized to 'data'; endpoints and label preserved.`
        });
        return { ...connection, relationship: 'data' };
      })
    };
  }
  const validation = validateArchitectureModel(candidate);
  return { ...validation, issues: [...adaptations, ...validation.issues] };
}
