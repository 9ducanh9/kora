import { KoraArchitectureModel } from '../../ir/types';
import { ValidationIssue } from '../../validation/issues';
import { ArchitectureRequirements, normalizedText } from './requirements';
import { resolveAssetDetailed } from '../../assets/registry';

/** Deterministic checks against grounded, separately extracted requirements, not an LLM score. */
export function checkSemanticRequirements(model: KoraArchitectureModel, requirements: ArchitectureRequirements): ValidationIssue[] {
  const nodes = new Map(model.nodes.map(node => [node.id, node]));
  const containers = new Map(model.containers.map(container => [container.id, container]));
  const issues: ValidationIssue[] = [];
  const fail = (code: string, entityId: string, message: string) => issues.push({ code, severity: 'error', path: ['semantics', entityId], entityId, message });
  const ancestry = (id: string): string[] => {
    let parent = nodes.get(id)?.containerId ?? containers.get(id)?.parentId;
    const chain: string[] = [];
    while (parent && !chain.includes(parent)) { chain.push(parent); parent = containers.get(parent)?.parentId; }
    return chain;
  };
  for (const entity of requirements.entities) {
    const item = entity.kind === 'node' ? nodes.get(entity.id) : containers.get(entity.id);
    if (!item) { fail('SEMANTIC_ENTITY_MISSING', entity.id, `Missing distinct role: ${entity.label}.`); continue; }
    if (normalizedText(item.label) !== normalizedText(entity.label)) fail('SEMANTIC_ROLE_LABEL', entity.id, `Keep the extracted role label '${entity.label}' distinct.`);
    const isAws = entity.kind === 'node' ? nodes.get(entity.id)?.assetId?.startsWith('aws.') || nodes.get(entity.id)?.kind?.startsWith('aws-') : containers.get(entity.id)?.type !== 'generic-group' && containers.get(entity.id)?.type !== 'corporate-data-center';
    if (entity.provider === 'external' && (isAws || ancestry(entity.id).some(id => containers.get(id)?.type === 'cloud' || containers.get(id)?.type === 'vpc' || containers.get(id)?.type?.startsWith('subnet-')))) {
      fail('SEMANTIC_EXTERNAL_IN_AWS', entity.id, `${entity.label} must remain outside AWS boundaries and use an external/generic asset.`);
    }
  }
  for (const placement of requirements.placements) {
    if (!ancestry(placement.entity).includes(placement.parent)) fail('SEMANTIC_PLACEMENT', placement.entity, `Expected '${placement.entity}' inside '${placement.parent}'.`);
  }
  for (const [index, flow] of requirements.flows.entries()) {
    const path = [flow.from, ...(flow.via ?? []), flow.to];
    for (let hop = 0; hop < path.length - 1; hop++) {
      const edge = model.connections.find(edge => edge.source === path[hop] && edge.target === path[hop + 1] && edge.relationship === flow.relationship && normalizedText(edge.label ?? '') === normalizedText(flow.label));
      if (!edge) fail('SEMANTIC_FLOW_MISSING', `flow-${index + 1}-hop-${hop + 1}`, `Required directed hop: ${path[hop]} -> ${path[hop + 1]} [${flow.label}; ${flow.relationship}].`);
      else if (flow.stage && !edge.description?.includes(`stage=${flow.stage}`)) fail('SEMANTIC_FLOW_STAGE', edge.id, `Flow stage must be recorded as stage=${flow.stage} in description.`);
    }
  }
  for (const flow of requirements.forbiddenFlows ?? []) {
    for (const edge of model.connections) {
      const label = `${edge.label ?? ''} ${edge.description ?? ''}`.toLowerCase();
      if (edge.source === flow.from && edge.target === flow.to && (!flow.labelIncludes?.length || flow.labelIncludes.some(term => label.includes(term.toLowerCase())))) fail('SEMANTIC_FORBIDDEN_FLOW', edge.id, `Forbidden shortcut/action: ${flow.from} -> ${flow.to}.`);
    }
  }
  const excludedLabel = (label: string, exclusion: string) => {
    const identity = (text: string) => normalizedText(text).replace(/\([^)]*\)/g, '').toLowerCase().replace(/^(amazon|aws)\s+/i, '');
    const words = identity(label).split(/[^\p{L}\p{N}]+/u);
    const excludedWords = identity(exclusion).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return excludedWords.length > 0 && excludedWords.every(word => words.includes(word));
  };
  for (const exclusion of requirements.exclusions) {
    let resolution = exclusion.assetId ? resolveAssetDetailed({ assetId: exclusion.assetId }) : undefined;
    if (resolution?.source === 'fallback') resolution = resolveAssetDetailed({ label: exclusion.label.replace(/\([^)]*\)/g, '').trim() });
    const excludedAssetId = resolution && resolution.source !== 'fallback' ? resolution.asset.id : exclusion.assetId;
    for (const node of model.nodes) {
      if ((excludedAssetId && node.assetId === excludedAssetId) || excludedLabel(`${node.label} ${node.subtitle ?? ''}`, exclusion.label)) fail('SEMANTIC_FORBIDDEN_COMPONENT', node.id, `Excluded component appears in diagram: ${exclusion.label}.`);
    }
  }
  const role = (id: string) => requirements.entities.find(entity => entity.id === id)?.role;
  for (const edge of model.connections) {
    // Hosting and DNS relationships must not invent a runtime proxy/redirect.
    if (['frontend-hosting', 'dns'].includes(role(edge.source) ?? '') && ['request', 'data'].includes(edge.relationship ?? '') && !requirements.flows.some(flow => flow.from === edge.source && flow.to === edge.target && flow.label === edge.label)) {
      fail('SEMANTIC_UNSUPPORTED_HOSTING_FLOW', edge.id, 'Hosting/DNS is not a runtime proxy or HTTP redirect unless that flow is explicitly extracted from the source.');
    }
  }
  return issues;
}
