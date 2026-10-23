import { IRConnection, IRContainer, IRNode, KoraArchitectureModel } from '../../ir/types';
import { EvaluationCase, FieldRule, TextRule } from './corpus';

export interface EvaluationDiff {
  code: string;
  path: string;
  expected?: unknown;
  actual?: unknown;
  entityId?: string;
}

export interface RateCounts {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
}

export interface FieldAccuracy { correct: number; total: number; accuracy: number | null; }

export interface SemanticEvaluation {
  verdict: 'PASS' | 'SEMANTIC_FAIL' | 'HARNESS_ERROR';
  diffs: EvaluationDiff[];
  nodes: RateCounts;
  containers: RateCounts;
  topology: RateCounts;
  connections: RateCounts;
  fields: Record<string, FieldAccuracy>;
  nodeMatches: Record<string, string>;
  containerMatches: Record<string, string>;
}

export const PARSER_MATCHER_VERSION = '1.3.1';

const normalize = (value: string | undefined) => (value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
const fold = (value: string) => value.toLowerCase();
const rate = (tp: number, fp: number, fn: number): RateCounts => ({
  tp, fp, fn,
  precision: tp + fp === 0 ? null : tp / (tp + fp),
  recall: tp + fn === 0 ? null : tp / (tp + fn)
});
const fieldAccuracy = (total: number, failures: number): FieldAccuracy => ({
  correct: Math.max(0, total - failures), total,
  accuracy: total === 0 ? null : Math.max(0, total - failures) / total
});

function assignRoles<T extends { id: string }, A extends { id: string }>(
  expected: T[], actual: A[], score: (role: T, entity: A) => number
): { mapping: Map<string, A>; ambiguous: string[]; ambiguousCandidates: Record<string, string[]>; capped: boolean } {
  const rows = expected.map(role => ({ role, candidates: actual.map(entity => ({ entity, score: score(role, entity) })).filter(item => item.score > 0).sort((a, b) => a.entity.id.localeCompare(b.entity.id)) }));
  rows.sort((a, b) => a.role.id.localeCompare(b.role.id));
  const entities = actual.slice().sort((a, b) => a.id.localeCompare(b.id));
  const weights = rows.map(row => entities.map(entity => score(row.role, entity)));
  const limit = 10_000;
  let probes = 0;

  const solve = (forbidden?: { row: number; column: number }) => {
    const n = rows.length;
    const m = entities.length + n;
    if (n === 0) return { score: 0, assignment: [] as number[] };
    const cost = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => {
      if (i === 0 || j === 0) return 0;
      if (forbidden?.row === i - 1 && forbidden.column === j - 1) return 1_000_000;
      return -(weights[i - 1][j - 1] ?? 0);
    }));
    const u = new Array<number>(n + 1).fill(0);
    const v = new Array<number>(m + 1).fill(0);
    const p = new Array<number>(m + 1).fill(0);
    const way = new Array<number>(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Array<number>(m + 1).fill(Number.POSITIVE_INFINITY);
      const used = new Array<boolean>(m + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0];
        let delta = Number.POSITIVE_INFINITY;
        let j1 = 0;
        for (let j = 1; j <= m; j++) {
          if (used[j]) continue;
          const current = cost[i0][j] - u[i0] - v[j];
          if (current < minv[j]) { minv[j] = current; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
          else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do {
        const j1 = way[j0]; p[j0] = p[j1]; j0 = j1;
      } while (j0 !== 0);
    }
    const assignment = new Array<number>(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j] > 0) assignment[p[j] - 1] = j - 1;
    const total = assignment.reduce((sum, column, row) => sum + (column >= 0 && column < entities.length ? weights[row][column] : 0), 0);
    return { score: total, assignment };
  };

  const best = solve();
  const mapping = new Map<string, A>();
  for (let row = 0; row < rows.length; row++) {
    const column = best.assignment[row];
    if (column >= 0 && column < entities.length && weights[row][column] > 0) mapping.set(rows[row].role.id, entities[column]);
  }
  const ambiguous: string[] = [];
  const ambiguousCandidates: Record<string, string[]> = {};
  const identityAt = (row: number, column: number) => column >= 0 && column < entities.length && weights[row][column] > 0 ? entities[column].id : 'ABSENT';
  const candidateChoices = new Map<string, Set<string>>();
  for (let row = 0; row < rows.length; row++) {
    const selectedColumn = best.assignment[row];
    if (identityAt(row, selectedColumn) === 'ABSENT') continue;
    if (++probes > limit) return { mapping, ambiguous, ambiguousCandidates, capped: true };
    const alternative = solve({ row, column: selectedColumn });
    if (alternative.score !== best.score) continue;
    for (let changedRow = 0; changedRow < rows.length; changedRow++) {
      const originalIdentity = identityAt(changedRow, best.assignment[changedRow]);
      const alternativeIdentity = identityAt(changedRow, alternative.assignment[changedRow]);
      if (originalIdentity === alternativeIdentity) continue;
      const roleId = rows[changedRow].role.id;
      if (!candidateChoices.has(roleId)) candidateChoices.set(roleId, new Set());
      candidateChoices.get(roleId)!.add(originalIdentity);
      candidateChoices.get(roleId)!.add(alternativeIdentity);
    }
  }
  for (const [roleId, choices] of candidateChoices) {
    if (choices.size > 1) {
      ambiguous.push(roleId);
      ambiguousCandidates[roleId] = [...choices].sort();
    }
  }
  return { mapping, ambiguous, ambiguousCandidates, capped: false };
}

function nodeScore(testCase: EvaluationCase, expected: IRNode, actual: IRNode): number {
  let value = 0;
  if (expected.assetId && actual.assetId === expected.assetId) value += 4;
  if (expected.kind === actual.kind) value += 2;
  const aliases = new Set([expected.label, testCase.strictNodeLabels?.[expected.id], ...(testCase.nodeAliases?.[expected.id] ?? [])].filter((item): item is string => item !== undefined).map(normalize));
  if (normalize(expected.label) === normalize(actual.label) || normalize(testCase.strictNodeLabels?.[expected.id]) === normalize(actual.label)) value += 12;
  else if (aliases.has(normalize(actual.label))) value += 6;
  return value;
}

function containerScore(expected: IRContainer, actual: IRContainer, expectedModel: KoraArchitectureModel, actualModel: KoraArchitectureModel): number {
  let value = 0;
  if (expected.type === actual.type) value += 2;
  if (normalize(expected.label) === normalize(actual.label)) value += 10;
  if (identityPath(expectedModel, expected.parentId) === identityPath(actualModel, actual.parentId)) value += 8;
  return value;
}

function fieldMatches<T>(rule: FieldRule<T> | undefined, expectedValue: T | undefined, actualValue: T | undefined): boolean {
  const effective = rule ?? (expectedValue === undefined ? { mode: 'absent' as const } : { mode: 'value' as const, value: expectedValue });
  if (effective.mode === 'any') return true;
  if (effective.mode === 'absent') return actualValue === undefined;
  return actualValue === effective.value;
}

function textMatches(rule: TextRule | undefined, expectedValue: string | undefined, actualValue: string | undefined): boolean {
  const effective = rule ?? (expectedValue === undefined ? { mode: 'any' as const } : { mode: 'text' as const, anyOf: [expectedValue] });
  if (effective.mode === 'any') return true;
  if (effective.mode === 'absent') return actualValue === undefined;
  if (actualValue === undefined) return false;
  if (effective.mode === 'token') return actualValue === effective.value;
  const actual = normalize(actualValue);
  return effective.anyOf.some(candidate => effective.caseSensitive === false ? fold(normalize(candidate)) === fold(actual) : normalize(candidate) === actual);
}

function defaultNodeRules(testCase: EvaluationCase, role: IRNode) {
  const expected = testCase.expected.nodes.find(node => node.id === role.id);
  const label = testCase.strictNodeLabels?.[role.id];
  return {
    label: label === undefined ? { mode: 'any' as const } : { mode: 'text' as const, anyOf: [label] },
    assetId: expected?.assetId === undefined ? { mode: 'absent' as const } : { mode: 'value' as const, value: expected.assetId },
    kind: { mode: 'value' as const, value: role.kind },
    containerId: role.containerId === undefined ? { mode: 'absent' as const } : { mode: 'value' as const, value: role.containerId }
  };
}

function defaultContainerRules(role: IRContainer) {
  return {
    label: { mode: 'text' as const, anyOf: [role.label] },
    type: { mode: 'value' as const, value: role.type },
    parentId: role.parentId === undefined ? { mode: 'absent' as const } : { mode: 'value' as const, value: role.parentId }
  };
}

function defaultEdgeRules(edge: IRConnection) {
  return {
    label: edge.label === undefined ? { mode: 'any' as const } : edge.label.includes('/') || edge.label.includes('*') ? { mode: 'token' as const, value: edge.label } : { mode: 'text' as const, anyOf: [edge.label] },
    relationship: edge.relationship === undefined ? { mode: 'any' as const } : { mode: 'value' as const, value: edge.relationship }
  };
}

function identityPath(model: KoraArchitectureModel, containerId?: string): string {
  const path: string[] = [];
  const byId = new Map(model.containers.map(container => [container.id, container]));
  let current = containerId;
  while (current) {
    const container = byId.get(current);
    if (!container) break;
    path.unshift(normalize(container.label));
    current = container.parentId;
  }
  return path.join('/');
}

function oracleIdentityAmbiguities(testCase: EvaluationCase): string[] {
  const roles = testCase.expected.nodes;
  const aliases = roles.map(role => new Set([role.label, testCase.strictNodeLabels?.[role.id], ...(testCase.nodeAliases?.[role.id] ?? [])].filter((item): item is string => item !== undefined).map(normalize)));
  const interchangeable = (left: string, right: string) => testCase.interchangeableNodeRoles?.some(group => group.includes(left) && group.includes(right)) ?? false;
  const ambiguous = new Set<string>();
  for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
    if (interchangeable(roles[i].id, roles[j].id)) continue;
    const sharedName = [...aliases[i]].some(alias => aliases[j].has(alias));
    if (!sharedName || identityPath(testCase.expected, roles[i].containerId) !== identityPath(testCase.expected, roles[j].containerId) || roles[i].assetId !== roles[j].assetId) continue;
    const hasUniqueLeft = [...aliases[i]].some(alias => !roles.some((_, index) => index !== i && aliases[index].has(alias)));
    const hasUniqueRight = [...aliases[j]].some(alias => !roles.some((_, index) => index !== j && aliases[index].has(alias)));
    if (!hasUniqueLeft && !hasUniqueRight) { ambiguous.add(`nodes.${roles[i].id}`); ambiguous.add(`nodes.${roles[j].id}`); }
  }
  const containers = testCase.expected.containers;
  for (let i = 0; i < containers.length; i++) for (let j = i + 1; j < containers.length; j++) {
    if (normalize(containers[i].label) === normalize(containers[j].label) && identityPath(testCase.expected, containers[i].parentId) === identityPath(testCase.expected, containers[j].parentId)) {
      ambiguous.add(`containers.${containers[i].id}`); ambiguous.add(`containers.${containers[j].id}`);
    }
  }
  return [...ambiguous].sort();
}

function interchangeableOutputAmbiguities(testCase: EvaluationCase, ambiguous: string[], candidates: Record<string, string[]>): Set<string> {
  const suppressed = new Set<string>();
  for (const group of testCase.interchangeableNodeRoles ?? []) {
    if (group.length < 2 || !group.every(role => ambiguous.includes(role))) continue;
    const choices = group.map(role => candidates[role] ?? []);
    if (choices.some(items => items.includes('ABSENT'))) continue;
    const first = [...(choices[0] ?? [])].sort();
    if (first.length !== group.length || choices.some(items => JSON.stringify([...items].sort()) !== JSON.stringify(first))) continue;
    for (const role of group) suppressed.add(role);
  }
  return suppressed;
}

function maximumMatches<E, A>(expected: E[], actual: A[], matches: (expected: E, actual: A) => boolean, id: (actual: A) => string): Map<number, number> {
  const candidates = expected.map((role, index) => ({ index, choices: actual.map((item, actualIndex) => ({ item, actualIndex })).filter(({ item }) => matches(role, item)).sort((a, b) => id(a.item).localeCompare(id(b.item))) }));
  candidates.sort((a, b) => a.choices.length - b.choices.length || a.index - b.index);
  const actualToExpected = new Map<number, number>();
  const expectedToActual = new Map<number, number>();
  const visit = (expectedIndex: number, seen: Set<number>): boolean => {
    for (const candidate of candidates.find(row => row.index === expectedIndex)!.choices) {
      if (seen.has(candidate.actualIndex)) continue;
      seen.add(candidate.actualIndex);
      const prior = actualToExpected.get(candidate.actualIndex);
      if (prior === undefined || visit(prior, seen)) {
        actualToExpected.set(candidate.actualIndex, expectedIndex);
        expectedToActual.set(expectedIndex, candidate.actualIndex);
        return true;
      }
    }
    return false;
  };
  for (const row of candidates) visit(row.index, new Set());
  return expectedToActual;
}

function describeRule<T>(rule: FieldRule<T> | TextRule | undefined): unknown {
  if (!rule) return 'UNSPECIFIED';
  if (rule.mode === 'any') return 'ANY';
  if (rule.mode === 'absent') return 'ABSENT';
  if (rule.mode === 'value') return rule.value;
  if (rule.mode === 'token') return rule.value;
  return rule.anyOf;
}

const applies = (rule: FieldRule<unknown> | TextRule | undefined) => rule?.mode !== undefined && rule.mode !== 'any';

/** Compares a validated parser IR before prepare/layout normalization. Provider IDs and array order are ignored. */
export function evaluateParserOutput(testCase: EvaluationCase, actual: KoraArchitectureModel): SemanticEvaluation {
  const diffs: EvaluationDiff[] = [];
  const expected = testCase.expected;
  const expectedContainers = expected.containers;
  const actualContainers = actual.containers;
  const oracleAmbiguities = oracleIdentityAmbiguities(testCase);
  if (oracleAmbiguities.length) {
    return {
      verdict: 'HARNESS_ERROR',
      diffs: oracleAmbiguities.map(path => ({ code: 'ORACLE_AMBIGUOUS', path, expected: 'a uniquely identifiable oracle role or declared interchangeable role', actual: 'role identity overlaps another expected role' })),
      nodes: rate(0, actual.nodes.length, expected.nodes.length), containers: rate(0, actualContainers.length, expectedContainers.length),
      topology: rate(0, actual.connections.length, expected.connections.length), connections: rate(0, actual.connections.length, expected.connections.length),
      fields: {}, nodeMatches: {}, containerMatches: {}
    };
  }
  const containerAssignment = assignRoles(expectedContainers, actualContainers, (role, container) => containerScore(role, container, expected, actual));
  if (containerAssignment.capped) {
    return { verdict: 'HARNESS_ERROR', diffs: [{ code: 'ASSIGNMENT_LIMIT', path: 'containers', expected: 'at most 10,000 candidate assignments', actual: 'search limit exceeded' }], nodes: rate(0, actual.nodes.length, expected.nodes.length), containers: rate(0, actualContainers.length, expectedContainers.length), topology: rate(0, actual.connections.length, expected.connections.length), connections: rate(0, actual.connections.length, expected.connections.length), fields: {}, nodeMatches: {}, containerMatches: {} };
  }
  for (const role of containerAssignment.ambiguous) diffs.push({ code: 'UNRESOLVED_IDENTITY', path: `containers.${role}`, expected: 'one-to-one role assignment', actual: { candidates: containerAssignment.ambiguousCandidates[role] } });
  const containerMatches = Object.fromEntries([...containerAssignment.mapping].map(([role, entity]) => [role, entity.id]));
  const reverseContainers = new Map([...containerAssignment.mapping].map(([role, entity]) => [entity.id, role]));
  for (const role of expectedContainers) {
    const found = containerAssignment.mapping.get(role.id);
    if (!found) { diffs.push({ code: 'CONTAINER_MISSING', path: `containers.${role.id}`, expected: role, actual: undefined }); continue; }
    const rules = testCase.assertions?.containers?.[role.id] ?? defaultContainerRules(role);
    if (!fieldMatches(rules.type, role.type, found.type)) diffs.push({ code: 'WRONG_CONTAINER_TYPE', path: `containers.${role.id}.type`, expected: describeRule(rules.type), actual: found.type, entityId: found.id });
    if (!textMatches(rules.label, role.label, found.label)) diffs.push({ code: 'WRONG_CONTAINER_LABEL', path: `containers.${role.id}.label`, expected: describeRule(rules.label), actual: found.label, entityId: found.id });
    const actualParentRole = found.parentId ? reverseContainers.get(found.parentId) : undefined;
    const parentMatches = rules.parentId?.mode === 'absent' ? found.parentId === undefined : fieldMatches(rules.parentId, role.parentId, actualParentRole);
    if (!parentMatches) diffs.push({ code: 'CONTAINER_PARENT_MISMATCH', path: `containers.${role.id}.parentId`, expected: describeRule(rules.parentId), actual: actualParentRole ?? (found.parentId ? 'UNMATCHED_CONTAINER' : 'ABSENT'), entityId: found.id });
  }
  const extraContainers = actualContainers.filter(container => !reverseContainers.has(container.id));
  for (const container of extraContainers) diffs.push({ code: 'CONTAINER_EXTRA', path: `containers.${container.id}`, expected: undefined, actual: container, entityId: container.id });

  const nodeAssignment = assignRoles(expected.nodes, actual.nodes, (role, node) => nodeScore(testCase, role, node) + (role.containerId && containerMatches[role.containerId] === node.containerId ? 15 : 0));
  if (nodeAssignment.capped) {
    return { verdict: 'HARNESS_ERROR', diffs: [...diffs, { code: 'ASSIGNMENT_LIMIT', path: 'nodes', expected: 'at most 10,000 candidate assignments', actual: 'search limit exceeded' }], nodes: rate(nodeAssignment.mapping.size, actual.nodes.length - nodeAssignment.mapping.size, expected.nodes.length - nodeAssignment.mapping.size), containers: rate(containerAssignment.mapping.size, extraContainers.length, expectedContainers.length - containerAssignment.mapping.size), topology: rate(0, actual.connections.length, expected.connections.length), connections: rate(0, actual.connections.length, expected.connections.length), fields: {}, nodeMatches: Object.fromEntries([...nodeAssignment.mapping].map(([role, entity]) => [role, entity.id])), containerMatches };
  }
  const interchangeableAmbiguities = interchangeableOutputAmbiguities(testCase, nodeAssignment.ambiguous, nodeAssignment.ambiguousCandidates);
  for (const role of nodeAssignment.ambiguous) if (!interchangeableAmbiguities.has(role)) diffs.push({ code: 'UNRESOLVED_IDENTITY', path: `nodes.${role}`, expected: 'one-to-one role assignment', actual: { candidates: nodeAssignment.ambiguousCandidates[role] } });
  const nodeMatches = Object.fromEntries([...nodeAssignment.mapping].map(([role, entity]) => [role, entity.id]));
  const reverseNodes = new Map([...nodeAssignment.mapping].map(([role, entity]) => [entity.id, role]));
  for (const role of expected.nodes) {
    const found = nodeAssignment.mapping.get(role.id);
    if (!found) { diffs.push({ code: 'NODE_MISSING', path: `nodes.${role.id}`, expected: role, actual: undefined }); continue; }
    const rules = testCase.assertions?.nodes?.[role.id] ?? defaultNodeRules(testCase, role);
    if (!fieldMatches(rules.assetId, role.assetId, found.assetId)) diffs.push({ code: 'WRONG_ASSET', path: `nodes.${role.id}.assetId`, expected: describeRule(rules.assetId), actual: found.assetId ?? 'ABSENT', entityId: found.id });
    if (!fieldMatches(rules.kind, role.kind, found.kind)) diffs.push({ code: 'WRONG_KIND', path: `nodes.${role.id}.kind`, expected: describeRule(rules.kind), actual: found.kind, entityId: found.id });
    if (!textMatches(rules.label, role.label, found.label)) diffs.push({ code: 'NODE_LABEL_MISMATCH', path: `nodes.${role.id}.label`, expected: describeRule(rules.label), actual: found.label, entityId: found.id });
    const actualContainerRole = found.containerId ? reverseContainers.get(found.containerId) : undefined;
    const membershipMatches = rules.containerId?.mode === 'absent' ? found.containerId === undefined : fieldMatches(rules.containerId, role.containerId, actualContainerRole);
    if (!membershipMatches) diffs.push({ code: 'NODE_MEMBERSHIP_MISMATCH', path: `nodes.${role.id}.containerId`, expected: describeRule(rules.containerId), actual: actualContainerRole ?? (found.containerId ? 'UNMATCHED_CONTAINER' : 'ABSENT'), entityId: found.id });
  }
  for (const node of actual.nodes) {
    if (!reverseNodes.has(node.id)) diffs.push({ code: 'NODE_EXTRA', path: `nodes.${node.id}`, expected: undefined, actual: node, entityId: node.id });
    if (testCase.forbiddenAssets?.includes(node.assetId ?? '')) diffs.push({ code: 'FORBIDDEN_ASSET', path: `nodes.${node.id}.assetId`, expected: 'not forbidden', actual: node.assetId, entityId: node.id });
    if (testCase.forbiddenNodeLabels?.some(label => normalize(label) === normalize(node.label))) diffs.push({ code: 'FORBIDDEN_LABEL', path: `nodes.${node.id}.label`, expected: 'not a forbidden role label', actual: node.label, entityId: node.id });
  }

  const scopeRule = testCase.assertions?.scope ?? { mode: 'any' as const };
  if (!fieldMatches(scopeRule, expected.scope?.type, actual.scope?.type)) diffs.push({ code: 'SCOPE_MISMATCH', path: 'scope.type', expected: describeRule(scopeRule), actual: actual.scope?.type ?? 'ABSENT' });

  const expectedEdges = expected.connections;
  const sameEndpoints = (edge: IRConnection, candidate: IRConnection) => reverseNodes.get(candidate.source) === edge.source && reverseNodes.get(candidate.target) === edge.target;
  const rulesForEdge = (edge: IRConnection) => testCase.assertions?.connections?.[edge.id] ?? defaultEdgeRules(edge);
  const exactEdgeMatches = maximumMatches(expectedEdges, actual.connections, (edge, candidate) => {
    const rules = rulesForEdge(edge);
    return sameEndpoints(edge, candidate) && textMatches(rules.label, edge.label, candidate.label) && fieldMatches(rules.relationship, edge.relationship, candidate.relationship);
  }, edge => edge.id);
  const topologyMatches = new Map(exactEdgeMatches);
  const topologyUsed = new Set([...topologyMatches.values()]);
  for (let index = 0; index < expectedEdges.length; index++) {
    if (topologyMatches.has(index)) continue;
    const candidateIndex = actual.connections.map((edge, actualIndex) => ({ edge, actualIndex }))
      .filter(({ edge, actualIndex }) => !topologyUsed.has(actualIndex) && sameEndpoints(expectedEdges[index], edge))
      .sort((a, b) => a.edge.id.localeCompare(b.edge.id))[0]?.actualIndex;
    if (candidateIndex !== undefined) { topologyMatches.set(index, candidateIndex); topologyUsed.add(candidateIndex); }
  }
  const matchedTopology = topologyMatches.size;
  for (let index = 0; index < expectedEdges.length; index++) {
    const edge = expectedEdges[index];
    if (exactEdgeMatches.has(index)) continue;
    const candidateIndex = topologyMatches.get(index);
    if (candidateIndex === undefined) { diffs.push({ code: 'EDGE_MISSING', path: `connections.${edge.id}`, expected: edge, actual: undefined }); continue; }
    const candidate = actual.connections[candidateIndex];
    const rules = rulesForEdge(edge);
    if (!textMatches(rules.label, edge.label, candidate.label)) diffs.push({ code: 'EDGE_LABEL_MISMATCH', path: `connections.${edge.id}.label`, expected: describeRule(rules.label), actual: candidate.label ?? 'ABSENT', entityId: candidate.id });
    if (!fieldMatches(rules.relationship, edge.relationship, candidate.relationship)) diffs.push({ code: 'EDGE_RELATIONSHIP_MISMATCH', path: `connections.${edge.id}.relationship`, expected: describeRule(rules.relationship), actual: candidate.relationship ?? 'ABSENT', entityId: candidate.id });
  }
  const usedTopologyEdges = new Set([...topologyMatches.values()].map(index => actual.connections[index].id));
  for (const edge of actual.connections) {
    if (!usedTopologyEdges.has(edge.id)) diffs.push({ code: 'EDGE_EXTRA', path: `connections.${edge.id}`, expected: undefined, actual: { ...edge, sourceRole: reverseNodes.get(edge.source), targetRole: reverseNodes.get(edge.target) }, entityId: edge.id });
  }

  const matchedNodes = nodeAssignment.mapping.size;
  const matchedContainers = containerAssignment.mapping.size;
  const nodeRates = rate(matchedNodes, actual.nodes.length - matchedNodes, expected.nodes.length - matchedNodes);
  const containerRates = rate(matchedContainers, actualContainers.length - matchedContainers, expectedContainers.length - matchedContainers);
  const matchedEdges = exactEdgeMatches.size;
  const connectionRates = rate(matchedEdges, actual.connections.length - matchedEdges, expected.connections.length - matchedEdges);
  const topologyRates = rate(matchedTopology, actual.connections.length - matchedTopology, expected.connections.length - matchedTopology);
  const count = (code: string) => diffs.filter(diff => diff.code === code).length;
  const applicableNodeFields = (field: 'assetId' | 'kind' | 'label' | 'containerId') => expected.nodes.filter(role => nodeAssignment.mapping.has(role.id) && applies((testCase.assertions?.nodes?.[role.id] ?? defaultNodeRules(testCase, role))[field])).length;
  const applicableContainerFields = (field: 'type' | 'label' | 'parentId') => expectedContainers.filter(role => containerAssignment.mapping.has(role.id) && applies((testCase.assertions?.containers?.[role.id] ?? defaultContainerRules(role))[field])).length;
  const expectedEdgeLabels = expectedEdges.filter(edge => applies(rulesForEdge(edge).label)).length;
  const expectedRelationships = expectedEdges.filter(edge => applies(rulesForEdge(edge).relationship)).length;
  const scopeTotal = applies(scopeRule) ? 1 : 0;
  const fields: Record<string, FieldAccuracy> = {
    asset: fieldAccuracy(applicableNodeFields('assetId'), count('WRONG_ASSET')),
    kind: fieldAccuracy(applicableNodeFields('kind'), count('WRONG_KIND')),
    customLabel: fieldAccuracy(applicableNodeFields('label'), count('NODE_LABEL_MISMATCH')),
    membership: fieldAccuracy(applicableNodeFields('containerId'), count('NODE_MEMBERSHIP_MISMATCH')),
    containerType: fieldAccuracy(applicableContainerFields('type'), count('WRONG_CONTAINER_TYPE')),
    containerLabel: fieldAccuracy(applicableContainerFields('label'), count('WRONG_CONTAINER_LABEL')),
    parent: fieldAccuracy(applicableContainerFields('parentId'), count('CONTAINER_PARENT_MISMATCH')),
    edgeLabel: fieldAccuracy(expectedEdgeLabels, count('EDGE_LABEL_MISMATCH')),
    relationship: fieldAccuracy(expectedRelationships, count('EDGE_RELATIONSHIP_MISMATCH')),
    scope: fieldAccuracy(scopeTotal, count('SCOPE_MISMATCH'))
  };
  return { verdict: diffs.length === 0 ? 'PASS' : 'SEMANTIC_FAIL', diffs, nodes: nodeRates, containers: containerRates, topology: topologyRates, connections: connectionRates, fields, nodeMatches, containerMatches };
}
