import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { executeArchitecturePipeline } from '../src/core/pipeline/generationPipeline';
import { DiagramDocument } from '../src/core/diagram/types';
import { getAsset } from '../src/core/assets/registry';
import { getContainerVisualConfig } from '../src/core/containers/registry';
import { getNodeDimensions } from '../src/core/layout/nodeDimensions';
import { BASELINE_CASES, BaselineCase } from '../tests/fixtures/baseline/cases';

interface Check {
  id: string;
  pass: boolean;
  detail?: string;
}

interface CaseResult {
  caseId: string;
  checks: Check[];
  diagnostics?: unknown;
  documentPath?: string;
  error?: string;
}

function outputDirectory(): string {
  const index = process.argv.indexOf('--out');
  const requested = index >= 0 ? process.argv[index + 1] : undefined;
  if (!requested) throw new Error('Usage: test-baseline.ts --out <new-output-directory>');
  return resolve(requested);
}

function sameSet(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && [...actual].sort().every((item, i) => item === [...expected].sort()[i]);
}

function intersectionArea(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function auditDocument(doc: DiagramDocument, testCase: BaselineCase): Check[] {
  const checks: Check[] = [];
  const semanticNodes = Object.keys(doc.semantic.nodes);
  const semanticEdges = Object.keys(doc.semantic.connections);
  const semanticContainers = Object.keys(doc.semantic.containers);
  const presentationNodes = Object.keys(doc.presentation.nodes);
  const presentationContainers = Object.keys(doc.presentation.containers);

  checks.push({ id: `${testCase.id}-node-ids`, pass: sameSet(semanticNodes, testCase.expected.nodeIds), detail: `actual=${semanticNodes.sort().join(',')}` });
  checks.push({ id: `${testCase.id}-edge-ids`, pass: sameSet(semanticEdges, testCase.expected.connections.map(edge => edge.id)), detail: `actual=${semanticEdges.sort().join(',')}` });
  checks.push({ id: `${testCase.id}-container-ids`, pass: sameSet(semanticContainers, testCase.expected.containers.map(container => container.id)), detail: `actual=${semanticContainers.sort().join(',')}` });
  checks.push({ id: `${testCase.id}-node-presentation-parity`, pass: sameSet(presentationNodes, semanticNodes), detail: `semantic=${semanticNodes.length}, presentation=${presentationNodes.length}` });
  checks.push({ id: `${testCase.id}-container-presentation-parity`, pass: sameSet(presentationContainers, semanticContainers), detail: `semantic=${semanticContainers.length}, presentation=${presentationContainers.length}` });

  const actualEdges = Object.values(doc.semantic.connections).map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label }));
  const expectedEdges = testCase.expected.connections.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label }));
  checks.push({ id: `${testCase.id}-edge-values`, pass: JSON.stringify(actualEdges) === JSON.stringify(expectedEdges) });

  const actualContainers = Object.values(doc.semantic.containers)
    .map(container => ({ id: container.id, type: container.type, parentId: container.parentId }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const expectedContainers = testCase.expected.containers
    .map(container => ({ id: container.id, type: container.type, parentId: container.parentId }))
    .sort((a, b) => a.id.localeCompare(b.id));
  checks.push({ id: `${testCase.id}-container-hierarchy`, pass: JSON.stringify(actualContainers) === JSON.stringify(expectedContainers) });

  for (const [nodeId, expectedContainerId] of Object.entries(testCase.expected.memberships)) {
    const actual = doc.semantic.nodes[nodeId]?.containerId;
    checks.push({ id: `${testCase.id}-membership-${nodeId}`, pass: actual === expectedContainerId, detail: `expected=${expectedContainerId ?? 'root'}, actual=${actual ?? 'root'}` });
  }

  const badGeometry: string[] = [];
  for (const [id, box] of Object.entries(doc.presentation.nodes)) {
    const derived = getNodeDimensions({ ...doc.semantic.nodes[id], label: doc.semantic.nodes[id]?.label ?? id });
    const width = box.width ?? derived.width;
    const height = box.height ?? derived.height;
    if (![box.x, box.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      badGeometry.push(`node:${id}`);
    }
  }
  for (const [id, box] of Object.entries(doc.presentation.containers)) {
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) badGeometry.push(`container:${id}`);
  }
  checks.push({ id: `${testCase.id}-finite-positive-geometry`, pass: badGeometry.length === 0, detail: badGeometry.join(',') || undefined });

  const containmentFailures: string[] = [];
  for (const [containerId, container] of Object.entries(doc.semantic.containers)) {
    const outer = doc.presentation.containers[containerId];
    if (!outer) continue;
    const config = getContainerVisualConfig(container.type);
    const content = { x: outer.x + config.sidePadding, y: outer.y + config.topPadding, width: outer.width - config.sidePadding * 2, height: outer.height - config.topPadding - config.bottomPadding };
    for (const [nodeId, node] of Object.entries(doc.semantic.nodes)) {
      if (node.containerId !== containerId) continue;
      const box = doc.presentation.nodes[nodeId];
      if (!box) continue;
      const derived = getNodeDimensions({ ...node, label: node.label });
      const width = box.width ?? derived.width;
      const height = box.height ?? derived.height;
      if (box.x < content.x - 1 || box.y < content.y - 1 || box.x + width > content.x + content.width + 1 || box.y + height > content.y + content.height + 1) containmentFailures.push(`${nodeId} outside ${containerId} content`);
    }
    for (const [childId, child] of Object.entries(doc.semantic.containers)) {
      if (child.parentId !== containerId) continue;
      const box = doc.presentation.containers[childId];
      if (!box) continue;
      if (box.x < content.x - 1 || box.y < content.y - 1 || box.x + box.width > content.x + content.width + 1 || box.y + box.height > content.y + content.height + 1) containmentFailures.push(`${childId} outside ${containerId} content`);
    }
  }
  checks.push({ id: `${testCase.id}-full-bounds-containment`, pass: containmentFailures.length === 0, detail: containmentFailures.join('; ') || undefined });

  const siblings: Array<{ id: string; box: { x: number; y: number; width: number; height: number } }[]> = [];
  const parents = new Set<string>(['']);
  for (const node of Object.values(doc.semantic.nodes)) parents.add(node.containerId ?? '');
  for (const container of Object.values(doc.semantic.containers)) parents.add(container.parentId ?? '');
  for (const parent of parents) {
    const children = [
      ...Object.values(doc.semantic.nodes).filter(node => (node.containerId ?? '') === parent).flatMap(node => {
        const box = doc.presentation.nodes[node.id];
        if (!box) return [];
        const dims = box.width && box.height ? box : getNodeDimensions({ ...node, label: node.label });
        return [{ id: `node:${node.id}`, box: { x: box.x, y: box.y, width: dims.width ?? 96, height: dims.height ?? 79 } }];
      }),
      ...Object.values(doc.semantic.containers).filter(container => (container.parentId ?? '') === parent).flatMap(container => {
        const box = doc.presentation.containers[container.id];
        return box ? [{ id: `container:${container.id}`, box }] : [];
      })
    ];
    siblings.push(children);
  }
  const overlaps: string[] = [];
  for (const group of siblings) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    if (intersectionArea(group[i].box, group[j].box) > 1) overlaps.push(`${group[i].id} overlaps ${group[j].id}`);
  }
  checks.push({ id: `${testCase.id}-sibling-overlap`, pass: overlaps.length === 0, detail: overlaps.join('; ') || undefined });

  const missingAssets: string[] = [];
  for (const node of Object.values(doc.semantic.nodes)) {
    const asset = getAsset(node.assetId ?? 'generic.component');
    if (!asset || !existsSync(join(process.cwd(), 'public', asset.assetPath.replace(/^\//, '')))) missingAssets.push(`node:${node.id}:${node.assetId ?? 'generic.component'}`);
    if ((node.kind === 'aws-service' || node.kind === 'aws-resource') && asset?.id === 'generic.component') missingAssets.push(`aws-fallback:${node.id}`);
  }
  for (const container of Object.values(doc.semantic.containers)) {
    const badge = getContainerVisualConfig(container.type).badgePath;
    if (badge && !existsSync(join(process.cwd(), 'public', badge.replace(/^\//, '')))) missingAssets.push(`container:${container.id}:${badge}`);
  }
  checks.push({ id: `${testCase.id}-asset-files`, pass: missingAssets.length === 0, detail: missingAssets.join(',') || undefined });
  return checks;
}

function comparableDocument(doc: DiagramDocument): unknown {
  return { semantic: doc.semantic, presentation: doc.presentation };
}

async function main() {
  const out = outputDirectory();
  if (existsSync(out)) throw new Error(`Refusing to overwrite existing output directory: ${out}`);
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out, { recursive: false });
  mkdirSync(join(out, 'documents'));

  const results: CaseResult[] = [];
  for (const testCase of BASELINE_CASES) {
    const result: CaseResult = { caseId: testCase.id, checks: [] };
    try {
      const first = await executeArchitecturePipeline(structuredClone(testCase.model), {
        parserId: 'baseline-fixture', parserName: 'Offline baseline fixture', promptLength: testCase.prompt.length
      });
      const second = await executeArchitecturePipeline(structuredClone(testCase.model), {
        parserId: 'baseline-fixture', parserName: 'Offline baseline fixture', promptLength: testCase.prompt.length
      });
      result.checks = auditDocument(first.document, testCase);
      result.checks.push({ id: `${testCase.id}-deterministic-repeat`, pass: JSON.stringify(comparableDocument(first.document)) === JSON.stringify(comparableDocument(second.document)) });
      result.diagnostics = first.diagnostics;
      result.documentPath = `documents/${testCase.id}.json`;
      writeFileSync(join(out, result.documentPath), `${JSON.stringify(first.document, null, 2)}\n`, 'utf8');
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.checks.push({ id: `${testCase.id}-pipeline`, pass: false, detail: result.error });
    }
    results.push(result);
  }

  const validDoc = results.find(result => result.documentPath)?.documentPath;
  let mutationDetected = false;
  if (validDoc) {
    const source = JSON.parse(await (await import('node:fs/promises')).readFile(join(out, validDoc), 'utf8')) as DiagramDocument;
    const firstNodeId = Object.keys(source.semantic.nodes)[0];
    const testCase = BASELINE_CASES.find(item => item.id === results.find(result => result.documentPath === validDoc)?.caseId)!;
    delete source.semantic.nodes[firstNodeId];
    mutationDetected = auditDocument(source, testCase).some(check => !check.pass);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    sourceMode: 'NO_GIT',
    fixtureCount: BASELINE_CASES.length,
    mutationDetection: { missingNodeRejected: mutationDetected },
    results,
    pass: mutationDetected && results.every(result => result.checks.every(check => check.pass))
  };
  writeFileSync(join(out, 'results.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ out, pass: report.pass, results: results.map(result => ({ caseId: result.caseId, pass: result.checks.every(check => check.pass), failures: result.checks.filter(check => !check.pass) })) }, null, 2));
  if (!report.pass) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
