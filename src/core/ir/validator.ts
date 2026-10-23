import { KoraArchitectureModel } from './types';
import { KoraArchitectureModelSchema } from './schema';
import { resolveAssetDetailed } from '../assets/registry';
import { ValidationIssue, ValidationResult, validationFailure, validationSuccess, zodIssues } from '../validation/issues';

const RESERVED_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function issue(code: string, path: Array<string | number>, message: string, entityId?: string): ValidationIssue {
  return { code, severity: 'error', path, message, entityId };
}

/** Validates an untrusted model without mutating the caller's object or repairing invalid references. */
export function validateArchitectureModel(raw: unknown): ValidationResult<KoraArchitectureModel> {
  const parsed = KoraArchitectureModelSchema.safeParse(raw);
  if (!parsed.success) return validationFailure(zodIssues(parsed.error.issues, 'IR_SCHEMA'));

  const model = parsed.data;
  const issues: ValidationIssue[] = [];
  const nodeIds = new Map<string, number>();
  const containerIds = new Map<string, number>();
  const connectionIds = new Map<string, number>();

  for (const [index, node] of model.nodes.entries()) {
    if (!node.id.trim()) issues.push(issue('IR_ID_EMPTY', ['nodes', index, 'id'], 'Node ID cannot contain only whitespace.', node.id));
    if (!node.label.trim()) issues.push(issue('IR_LABEL_EMPTY', ['nodes', index, 'label'], 'Node label cannot contain only whitespace.', node.id));
    if (RESERVED_RECORD_KEYS.has(node.id)) issues.push(issue('IR_RESERVED_ID', ['nodes', index, 'id'], 'This ID is reserved for safe dictionary use.', node.id));
    const prior = nodeIds.get(node.id);
    if (prior !== undefined) issues.push(issue('IR_DUPLICATE_NODE_ID', ['nodes', index, 'id'], `Node ID '${node.id}' is already used at index ${prior}.`, node.id));
    else nodeIds.set(node.id, index);
  }

  for (const [index, container] of model.containers.entries()) {
    if (!container.id.trim()) issues.push(issue('IR_ID_EMPTY', ['containers', index, 'id'], 'Container ID cannot contain only whitespace.', container.id));
    if (!container.label.trim()) issues.push(issue('IR_LABEL_EMPTY', ['containers', index, 'label'], 'Container label cannot contain only whitespace.', container.id));
    if (RESERVED_RECORD_KEYS.has(container.id)) issues.push(issue('IR_RESERVED_ID', ['containers', index, 'id'], 'This ID is reserved for safe dictionary use.', container.id));
    const prior = containerIds.get(container.id);
    if (prior !== undefined) issues.push(issue('IR_DUPLICATE_CONTAINER_ID', ['containers', index, 'id'], `Container ID '${container.id}' is already used at index ${prior}.`, container.id));
    else containerIds.set(container.id, index);
    if (nodeIds.has(container.id)) issues.push(issue('IR_NODE_CONTAINER_ID_COLLISION', ['containers', index, 'id'], `Node and container IDs share a namespace; '${container.id}' is already a node.`, container.id));
  }

  for (const [index, connection] of model.connections.entries()) {
    if (!connection.id.trim()) issues.push(issue('IR_ID_EMPTY', ['connections', index, 'id'], 'Connection ID cannot contain only whitespace.', connection.id));
    if (RESERVED_RECORD_KEYS.has(connection.id)) issues.push(issue('IR_RESERVED_ID', ['connections', index, 'id'], 'This ID is reserved for safe dictionary use.', connection.id));
    const prior = connectionIds.get(connection.id);
    if (prior !== undefined) issues.push(issue('IR_DUPLICATE_CONNECTION_ID', ['connections', index, 'id'], `Connection ID '${connection.id}' is already used at index ${prior}.`, connection.id));
    else connectionIds.set(connection.id, index);
    if (!nodeIds.has(connection.source)) issues.push(issue('IR_CONNECTION_SOURCE_MISSING', ['connections', index, 'source'], `Source node '${connection.source}' does not exist.`, connection.id));
    if (!nodeIds.has(connection.target)) issues.push(issue('IR_CONNECTION_TARGET_MISSING', ['connections', index, 'target'], `Target node '${connection.target}' does not exist.`, connection.id));
  }

  for (const [index, container] of model.containers.entries()) {
    if (container.parentId === undefined) continue;
    if (!containerIds.has(container.parentId)) {
      issues.push(issue('IR_CONTAINER_PARENT_MISSING', ['containers', index, 'parentId'], `Parent container '${container.parentId}' does not exist.`, container.id));
    } else if (container.parentId === container.id) {
      issues.push(issue('IR_CONTAINER_SELF_PARENT', ['containers', index, 'parentId'], 'A container cannot be its own parent.', container.id));
    }
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  const cycleKeys = new Set<string>();
  const containerById = new Map(model.containers.map(container => [container.id, container]));
  const visit = (id: string) => {
    if (active.has(id)) {
      const cycle = [...active, id].join(' -> ');
      if (!cycleKeys.has(cycle)) {
        cycleKeys.add(cycle);
        issues.push(issue('IR_CONTAINER_CYCLE', ['containers', id, 'parentId'], `Container hierarchy contains a cycle: ${cycle}.`, id));
      }
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    active.add(id);
    const parent = containerById.get(id)?.parentId;
    if (parent && containerById.has(parent)) visit(parent);
    active.delete(id);
  };
  for (const id of containerById.keys()) visit(id);

  for (const [index, node] of model.nodes.entries()) {
    if (node.containerId !== undefined && !containerIds.has(node.containerId)) {
      issues.push(issue('IR_NODE_CONTAINER_MISSING', ['nodes', index, 'containerId'], `Container '${node.containerId}' does not exist.`, node.id));
    }
  }

  for (const [index, node] of model.nodes.entries()) {
    const resolution = resolveAssetDetailed({ assetId: node.assetId, label: node.label });
    if (resolution.source === 'alias') {
      node.assetId = resolution.asset.id;
      issues.push({ code: 'ASSET_ALIAS_RESOLVED', severity: 'info', path: ['nodes', index, 'assetId'], message: `Asset alias '${resolution.requestedValue}' resolved to '${resolution.asset.id}'.`, entityId: node.id });
    } else if (resolution.source === 'label-derived') {
      issues.push({ code: 'ASSET_FROM_LABEL', severity: 'info', path: ['nodes', index, 'label'], message: `Display asset '${resolution.asset.id}' was matched from the node label.`, entityId: node.id });
    } else if (resolution.source === 'fallback') {
      issues.push({ code: 'ASSET_FALLBACK', severity: 'warning', path: ['nodes', index, node.assetId === undefined ? 'label' : 'assetId'], message: `Could not resolve '${resolution.requestedValue ?? ''}'; the renderer will use a generic icon.`, entityId: node.id });
    }
  }

  if (issues.some(item => item.severity === 'error')) return validationFailure(issues);
  return validationSuccess(model, issues);
}
