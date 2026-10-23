import { z } from 'zod';
import { ConnectionRelationshipSchema } from '../../ir/schema';
import { ValidationIssue, zodIssues } from '../../validation/issues';
import { resolveSourceEvidence } from './sourceEvidence';

const text = z.string().min(1).max(600);
const id = z.string().min(1).max(100);
export const ArchitectureRequirementsSchema = z.object({
  entities: z.array(z.object({
    id, label: text, kind: z.enum(['node', 'container']),
    provider: z.enum(['aws', 'external', 'unspecified']),
    role: z.enum(['host', 'viewer', 'browser', 'frontend-hosting', 'backend', 'dns', 'media-relay', 'storage', 'identity', 'other']),
    evidence: text
  }).strict()).min(1).max(80),
  flows: z.array(z.object({
    from: id, to: id, via: z.array(id).max(12).optional(),
    stage: z.enum(['runtime', 'delivery', 'control', 'startup', 'deployment']).optional(),
    label: text, relationship: ConnectionRelationshipSchema, evidence: text
  }).strict()).max(160),
  contextRelations: z.array(z.object({
    from: id, to: id, label: text, relationship: z.literal('association'),
    stage: z.literal('deployment'), evidence: text
  }).strict()).max(80).optional(),
  forbiddenFlows: z.array(z.object({ from: id, to: id, labelIncludes: z.array(text).max(12).optional(), evidence: text }).strict()).max(80).optional(),
  placements: z.array(z.object({ entity: id, parent: id, evidence: text }).strict()).max(80),
  exclusions: z.array(z.object({ label: text, assetId: z.string().min(1).max(100).optional(), evidence: text }).strict()).max(40),
  notes: z.array(z.object({ text, evidence: text }).strict()).max(50)
}).strict();
export type ArchitectureRequirements = z.infer<typeof ArchitectureRequirementsSchema>;
export const SemanticGenerationReviewSchema = z.object({
  version: z.literal('1.0'),
  requirements: ArchitectureRequirementsSchema,
  generationAttempts: z.number().int().min(1).max(2),
  extractionAttempts: z.number().int().min(1).max(2).optional()
}).strict().refine(review => review.generationAttempts + (review.extractionAttempts ?? 1) <= 3, 'Extraction and graph generation share a three-request budget.');
export type SemanticGenerationReview = z.infer<typeof SemanticGenerationReviewSchema>;
export const normalizedText = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

export function validateRequirements(raw: unknown, prompt: string): { requirements?: ArchitectureRequirements; issues: ValidationIssue[] } {
  const parsed = ArchitectureRequirementsSchema.safeParse(resolveSourceEvidence(raw, prompt));
  if (!parsed.success) return { issues: zodIssues(parsed.error.issues, 'REQUIREMENTS_SCHEMA') };
  const requirements = parsed.data;
  const issues: ValidationIssue[] = [];
  const fail = (code: string, path: Array<string | number>, message: string) => issues.push({ code, severity: 'error', path, message });
  const source = normalizedText(prompt);
  // A deployment association to a boundary is an annotation, never a runtime wire.
  // Preserve the exact relation in review metadata and surface it as an annotation.
  const kinds = new Map(requirements.entities.map(entity => [entity.id, entity.kind]));
  requirements.flows = requirements.flows.filter((flow, index) => {
    const boundary = kinds.get(flow.from) === 'container' || kinds.get(flow.to) === 'container';
    if (!boundary || !kinds.has(flow.from) || !kinds.has(flow.to) || flow.relationship !== 'association' || flow.stage !== 'deployment' || flow.via?.length || !source.includes(normalizedText(flow.evidence)) || (requirements.contextRelations?.length ?? 0) >= 80) return true;
    const { via: _via, ...relation } = flow;
    (requirements.contextRelations ??= []).push({ ...relation, relationship: 'association', stage: 'deployment' });
    issues.push({ code: 'REQUIREMENT_CONTEXT_ANNOTATED', severity: 'info', path: ['flows', index], message: `Preserved ${flow.from} → ${flow.to} as a deployment annotation, not a runtime connection.` });
    return false;
  });
  for (const section of ['entities', 'flows', 'contextRelations', 'forbiddenFlows', 'placements', 'exclusions', 'notes'] as const) {
    requirements[section]?.forEach((row, index) => {
      const evidence = normalizedText(row.evidence);
      if (!evidence || !source.includes(evidence)) fail('REQUIREMENT_UNGROUNDED', [section, index, 'evidence'], 'Evidence must be copied from the original description, not inferred or translated.');
    });
  }
  const entities = new Map<string, ArchitectureRequirements['entities'][number]>();
  requirements.entities.forEach((entity, index) => {
    if (entities.has(entity.id) || ['__proto__', 'constructor', 'prototype'].includes(entity.id) || !entity.id.trim()) fail('REQUIREMENT_ID_INVALID', ['entities', index, 'id'], 'Requirement IDs must be unique, non-empty and safe.');
    if (!entity.label.trim()) fail('REQUIREMENT_LABEL_EMPTY', ['entities', index, 'label'], 'Role label must not be empty.');
    entities.set(entity.id, entity);
  });
  requirements.flows.forEach((flow, index) => {
    if (entities.get(flow.from)?.kind !== 'node' || entities.get(flow.to)?.kind !== 'node') fail('REQUIREMENT_FLOW_REFERENCE', ['flows', index], `Flow '${flow.from}' (${entities.get(flow.from)?.kind ?? 'undeclared'}) -> '${flow.to}' (${entities.get(flow.to)?.kind ?? 'undeclared'}) needs declared node endpoints, not boundary IDs. Use a declared execution-resource node for task startup/configuration. Broad infrastructure-management statements belong in grounded notes; do not connect to cloud/account/region/VPC boundaries or invent resource calls.`);
    if (flow.via?.some(endpoint => entities.get(endpoint)?.kind !== 'node') || (flow.via && new Set([flow.from, ...flow.via, flow.to]).size !== flow.via.length + 2)) fail('REQUIREMENT_VIA_REFERENCE', ['flows', index, 'via'], 'Via hops must name distinct declared nodes in order, excluding endpoints.');
    if (entities.get(flow.from)?.role === 'frontend-hosting' && entities.get(flow.to)?.role === 'backend' && ['request', 'data'].includes(flow.relationship)) fail('REQUIREMENT_HOSTING_PROXY', ['flows', index], 'Static frontend hosting is not the client executing browser API calls. Use the actual browser origin; model an explicitly described server proxy as a backend role.');
    // AWS presigning is application/SDK signing, not an S3 API response:
    // https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
    if (/\bs3\b/i.test(entities.get(flow.from)?.label ?? '') && entities.get(flow.to)?.role === 'backend' && /presigned|pre-signed/i.test(flow.label)) fail('REQUIREMENT_SIGNING_SOURCE', ['flows', index], 'S3 does not return a generated presigned URL to the backend; the application signs it and supplies it to the downloader.');
  });
  requirements.forbiddenFlows?.forEach((flow, index) => {
    if (entities.get(flow.from)?.kind !== 'node' || entities.get(flow.to)?.kind !== 'node') fail('REQUIREMENT_FORBIDDEN_REFERENCE', ['forbiddenFlows', index], 'Forbidden flow endpoints must be declared nodes.');
    if (flow.labelIncludes?.some(term => !term.trim())) fail('REQUIREMENT_FORBIDDEN_LABEL', ['forbiddenFlows', index], 'A forbidden label term cannot be empty.');
  });
  requirements.contextRelations?.forEach((relation, index) => {
    if (!entities.has(relation.from) || !entities.has(relation.to) || ![relation.from, relation.to].some(endpoint => entities.get(endpoint)?.kind === 'container')) fail('REQUIREMENT_CONTEXT_REFERENCE', ['contextRelations', index], 'A deployment annotation must reference declared entities, including a boundary.');
  });
  const parents = new Map<string, Set<string>>();
  requirements.placements.forEach((placement, index) => {
    if (!entities.has(placement.entity) || entities.get(placement.parent)?.kind !== 'container') fail('REQUIREMENT_PLACEMENT_REFERENCE', ['placements', index], `Placement '${placement.entity}' inside '${placement.parent}' needs both entities declared and the parent must be a container.`);
    const ancestors = parents.get(placement.entity) ?? new Set<string>();
    ancestors.add(placement.parent);
    parents.set(placement.entity, ancestors);
  });
  const active = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string) => {
    if (active.has(key)) { fail('REQUIREMENT_PLACEMENT_CYCLE', ['placements'], `Requirement placement contains a cycle at '${key}'.`); return; }
    if (visited.has(key)) return;
    active.add(key);
    for (const parent of parents.get(key) ?? []) visit(parent);
    active.delete(key); visited.add(key);
  };
  for (const key of parents.keys()) visit(key);
  return issues.some(issue => issue.severity === 'error') ? { issues } : { requirements, issues };
}
