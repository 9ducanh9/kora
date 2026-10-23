import { BASELINE_CASES } from '../tests/fixtures/baseline/cases';
import { KoraArchitectureModel } from '../src/core/ir/types';
import { prepareArchitectureModel } from '../src/core/architecture/prepareModel';
import { computeCompoundLayoutDetailed, ElkLayoutEngine } from '../src/core/layout/elkCompoundLayout';
import { ElkNode } from 'elkjs/lib/elk.bundled.js';
import { auditLayout } from '../src/core/layout/qualityAudit';
import { measureVisuals } from '../src/core/layout/visualMetrics';
import { validateDiagramDocument } from '../src/core/diagram/validator';
import { compareStable } from '../src/core/layout/visualMetrics';
import { createStressLayoutModel, STRESS_LAYOUT_SEED } from '../tests/fixtures/layout/models';
import { computeBestCompoundLayoutInWorker } from '../src/core/layout/layoutWorkerClient';
import { SERVICEGREMLIN_GOLDEN_MODEL } from '../tests/fixtures/servicegremlin.golden';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[FAIL] ${message}`);
  console.log(`[PASS] ${message}`);
}

async function assertRejects(promise: Promise<unknown>, expected: RegExp, message: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    assert(expected.test(text), `${message} (${text})`);
    return;
  }
  assert(false, `${message} (operation unexpectedly succeeded)`);
}

function geometryDigest(document: Awaited<ReturnType<typeof computeCompoundLayoutDetailed>>['document']): string {
  return JSON.stringify({
    nodes: Object.fromEntries(Object.entries(document.presentation.nodes).sort(([a], [b]) => compareStable(a, b))),
    containers: Object.fromEntries(Object.entries(document.presentation.containers).sort(([a], [b]) => compareStable(a, b))),
    connections: Object.fromEntries(Object.entries(document.presentation.connections ?? {}).sort(([a], [b]) => compareStable(a, b)))
  });
}

async function run() {
  console.log('=== LAYOUT GEOMETRY REGRESSION ===');
  for (const testCase of BASELINE_CASES) {
    const model = prepareArchitectureModel(testCase.model);
    for (const direction of ['RIGHT', 'DOWN'] as const) {
      const result = await computeCompoundLayoutDetailed(model, { metrics: measureVisuals(model), candidate: 'base', direction });
      const validation = validateDiagramDocument(result.document);
      assert(validation.ok, `${testCase.id} ${direction} produces a structurally valid Document`);
      assert(Object.keys(result.document.semantic.nodes).length === model.nodes.length, `${testCase.id} ${direction} retains every semantic node`);
      assert(Object.keys(result.document.semantic.connections).length === model.connections.length, `${testCase.id} ${direction} retains every semantic connection`);
      assert(Object.keys(result.document.semantic.containers).length === model.containers.length, `${testCase.id} ${direction} retains every container including empty ones`);
      assert(Object.keys(result.document.presentation.nodes).length === model.nodes.length, `${testCase.id} ${direction} maps every node to node presentation`);
      assert(Object.keys(result.document.presentation.containers).length === model.containers.length, `${testCase.id} ${direction} maps every container to container presentation`);
      assert(result.findings.every(finding => finding.severity !== 'blocking'), `${testCase.id} ${direction} has no blocking findings (${result.findings.length} total findings)`);
    }
  }

  const empty: KoraArchitectureModel = { version: '1.0', nodes: [], connections: [], containers: [] };
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    const emptyResult = await computeCompoundLayoutDetailed(empty, { metrics: measureVisuals(empty), direction });
    assert(Object.keys(emptyResult.document.presentation.nodes).length === 0 && Object.keys(emptyResult.document.presentation.containers).length === 0 && emptyResult.findings.length === 0, `empty graph stays empty without findings (${direction})`);
  }

  const onlyContainers: KoraArchitectureModel = {
    version: '1.0', nodes: [], connections: [],
    containers: [
      { id: 'root-only', label: 'Root', type: 'cloud' },
      { id: 'nested-empty', label: 'Nested Empty', type: 'vpc', parentId: 'root-only' },
      { id: 'leaf-empty', label: 'Leaf Empty', type: 'subnet-private', parentId: 'nested-empty' }
    ]
  };
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    const containerResult = await computeCompoundLayoutDetailed(onlyContainers, { metrics: measureVisuals(onlyContainers), direction });
    assert(Object.keys(containerResult.document.presentation.containers).length === 3 && Object.keys(containerResult.document.presentation.nodes).length === 0, `nested empty containers keep their kind without dummy nodes (${direction})`);
    assert(!containerResult.findings.some(finding => finding.severity === 'blocking'), `nested empty containers have no blocking findings (${direction})`);
    for (const box of Object.values(containerResult.document.presentation.containers)) assert(box.width >= 180 && box.height >= 100, `empty container respects minimum dimensions (${direction})`);
  }

  const network: KoraArchitectureModel = {
    version: '1.0',
    nodes: [
      { id: 'network-users', label: 'External users', kind: 'external', assetId: 'external.user' },
      { id: 'network-cdn', label: 'CloudFront', kind: 'aws-service', assetId: 'aws.cloudfront', containerId: 'network-cloud' },
      { id: 'network-alb', label: 'Public ALB', kind: 'aws-resource', assetId: 'aws.elb.alb', containerId: 'network-public' },
      { id: 'network-api', label: 'Private application API', kind: 'aws-service', assetId: 'aws.ecs.fargate', containerId: 'network-private-a' },
      { id: 'network-db', label: 'State database', kind: 'aws-service', assetId: 'aws.rds', containerId: 'network-private-b' },
      { id: 'network-assets', label: 'Static assets', kind: 'aws-service', assetId: 'aws.s3', containerId: 'network-cloud' }
    ],
    connections: [
      { id: 'network-u-cdn', source: 'network-users', target: 'network-cdn', relationship: 'request', label: 'HTTPS' },
      { id: 'network-cdn-alb', source: 'network-cdn', target: 'network-alb', relationship: 'request', label: 'Origin' },
      { id: 'network-alb-api', source: 'network-alb', target: 'network-api', relationship: 'request', label: 'Forward' },
      { id: 'network-api-db', source: 'network-api', target: 'network-db', relationship: 'data', label: 'State' },
      { id: 'network-cdn-assets', source: 'network-cdn', target: 'network-assets', relationship: 'request', label: 'Static' }
    ],
    containers: [
      { id: 'network-cloud', label: 'AWS Cloud', type: 'cloud' },
      { id: 'network-region', label: 'US West 2', type: 'region', parentId: 'network-cloud' },
      { id: 'network-vpc', label: 'Production VPC', type: 'vpc', parentId: 'network-region' },
      { id: 'network-az-a', label: 'Availability Zone A', type: 'availability-zone', parentId: 'network-vpc' },
      { id: 'network-az-b', label: 'Availability Zone B', type: 'availability-zone', parentId: 'network-vpc' },
      { id: 'network-public', label: 'Public Subnet', type: 'subnet-public', parentId: 'network-az-a' },
      { id: 'network-private-a', label: 'Private Subnet A', type: 'subnet-private', parentId: 'network-az-a' },
      { id: 'network-private-b', label: 'Private Subnet B', type: 'subnet-private', parentId: 'network-az-b' }
    ]
  };
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    const networkResult = await computeCompoundLayoutDetailed(network, { metrics: measureVisuals(network), direction });
    assert(validateDiagramDocument(networkResult.document).ok, `F3 ${direction} cloud-to-subnet hierarchy with an external user remains structurally valid`);
    assert(networkResult.findings.every(finding => finding.severity !== 'blocking'), `F3 ${direction} hierarchy and cross-boundary routes have no blocking findings (${networkResult.findings.map(finding => finding.code).join(', ')})`);
  }

  const dag: KoraArchitectureModel = {
    version: '1.0', nodes: ['ingress', 'router', 'worker-a', 'worker-b', 'merge', 'storage', 'isolated-a', 'isolated-b'].map(id => ({ id, label: `Node ${id}`, kind: 'generic' })),
    containers: [],
    connections: [
      { id: 'dag-1', source: 'ingress', target: 'router', relationship: 'request' },
      { id: 'dag-2', source: 'router', target: 'worker-a', relationship: 'request' },
      { id: 'dag-3', source: 'router', target: 'worker-b', relationship: 'request' },
      { id: 'dag-4', source: 'worker-a', target: 'merge', relationship: 'data' },
      { id: 'dag-5', source: 'worker-b', target: 'merge', relationship: 'data' },
      { id: 'dag-6', source: 'merge', target: 'storage', relationship: 'data' },
      { id: 'dag-cycle', source: 'storage', target: 'router', relationship: 'event' },
      { id: 'dag-isolated', source: 'isolated-a', target: 'isolated-b', relationship: 'request' }
    ]
  };
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    const dagResult = await computeCompoundLayoutDetailed(dag, { metrics: measureVisuals(dag), direction });
    assert(validateDiagramDocument(dagResult.document).ok && Boolean(dagResult.document.presentation.connections?.['dag-cycle']?.route), `F4 ${direction} layout retains cycles and disconnected components`);
    assert(!dagResult.findings.some(finding => finding.severity === 'blocking'), `F4 ${direction} has no blocking findings`);
  }

  let longText = 'Tiếng Việt e\u0301 WWW iii 🧭 '.repeat(4);
  while (longText.length < 120) longText += 'x';
  longText = longText.slice(0, 120);
  const longModel: KoraArchitectureModel = {
    version: '1.0',
    nodes: [
      { id: 'long', label: longText, subtitle: `Tiếng Việt e\u0301 WWW iii 🧭 ${longText}`, kind: 'generic' },
      { id: 'long-peer', label: 'Peer', kind: 'generic' },
      { id: 'wide-glyphs', label: 'W'.repeat(25), kind: 'generic' },
      { id: 'narrow-glyphs', label: 'i'.repeat(25), kind: 'generic' },
      { id: 'accented', label: 'Kiến trúc tiếng Việt e\u0301 🧭', subtitle: 'WWW iii WWW iii', kind: 'generic' }
    ],
    containers: [{ id: 'long-group', label: `Kiến trúc AWS tiếng Việt e\u0301 — WWW iii ${longText}`, type: 'generic-group' }],
    connections: [{ id: 'long-edge', source: 'long', target: 'long-peer', relationship: 'data', label: longText }]
  };
  const longMetrics = measureVisuals(longModel);
  assert(longMetrics.nodes.long.primary === longText && longMetrics.nodes.long.width === 192 && longMetrics.nodes.long.height > 100, 'F6 keeps 120-character Unicode labels and grows node geometry without truncation');
  assert(longMetrics.containers['long-group'].lines > 1 && longMetrics.connections['long-edge'].lines > 1, 'F6 wraps long headers and edge labels using the same metrics profile');
  assert(longMetrics.nodes['wide-glyphs'].width > longMetrics.nodes['narrow-glyphs'].width, `F6 visual metrics distinguish WWW from equally long narrow glyph text (${longMetrics.nodes['wide-glyphs'].width}/${longMetrics.nodes['narrow-glyphs'].width})`);
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    const longResult = await computeCompoundLayoutDetailed(longModel, { metrics: longMetrics, direction });
    assert(longResult.document.semantic.nodes.long.label === longText && Boolean(longResult.document.presentation.connections?.['long-edge']?.route?.label), `F6 ${direction} persists full semantic text and a label rectangle`);
    assert(!longResult.findings.some(finding => finding.severity === 'blocking'), `F6 ${direction} has no blocking geometry or label findings`);
  }

  const collisionModel: KoraArchitectureModel = {
    version: '1.0',
    nodes: [
      { id: 'root', label: 'Root node', kind: 'generic', assetId: 'generic.component' },
      { id: 'cloud-aws', label: 'User-owned ID', kind: 'generic', assetId: 'generic.component' },
      { id: 'e0', label: 'Node sharing edge ID', kind: 'aws-service', assetId: 'aws.lambda' },
      { id: 'nested-a', label: 'Group member', kind: 'aws-service', assetId: 'aws.ecs', containerId: 'user-group' },
      { id: 'nested-b', label: 'Nested worker A', kind: 'aws-service', assetId: 'aws.lambda', containerId: 'nested-container' },
      { id: 'nested-c', label: 'Nested worker B', kind: 'aws-service', assetId: 'aws.rds', containerId: 'nested-container' }
    ],
    connections: [
      { id: 'e0', source: 'root', target: 'e0', relationship: 'request', label: 'same namespace allowed' },
      { id: 'group-owner-edge', source: 'nested-a', target: 'nested-b', relationship: 'request', label: 'group owner section' },
      { id: 'deep-owner-edge', source: 'nested-b', target: 'nested-c', relationship: 'data', label: 'deep owner section' },
      { id: 'cross-owner-edge', source: 'nested-c', target: 'root', relationship: 'event', label: 'cross owner offsets' }
    ],
    containers: [
      { id: 'user-group', label: 'User-owned nested group', type: 'generic-group' },
      { id: 'nested-container', label: 'Nested owner', type: 'generic-group', parentId: 'user-group' }
    ]
  };
  const normalizedCollision = prepareArchitectureModel(collisionModel);
  assert(normalizedCollision.containers.find(container => container.type === 'cloud')?.id === 'cloud-aws-2', 'generated Cloud uses first-free ID when cloud-aws is already owned');
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    const collisionResult = await computeCompoundLayoutDetailed(normalizedCollision, { metrics: measureVisuals(normalizedCollision), direction });
    assert(validateDiagramDocument(collisionResult.document).ok, `F7 ${direction} private-ID output remains structurally valid`);
    assert(Boolean(collisionResult.document.presentation.nodes.root && collisionResult.document.presentation.nodes.e0 && collisionResult.document.presentation.nodes['cloud-aws']), `F7 ${direction} retains root/cloud-aws/e0 IDs across node/container namespaces`);
    assert(Object.keys(collisionResult.document.presentation.connections ?? {}).length === normalizedCollision.connections.length, `F7 ${direction} maps every nested edge section back to its semantic owner`);
    assert(!collisionResult.findings.some(finding => finding.severity === 'blocking'), `F7 ${direction} has no blocking route/label or geometry findings`);
  }

  const invalidOutputModel: KoraArchitectureModel = {
    version: '1.0', nodes: [{ id: 'fake-output-node', label: 'Fake output', kind: 'generic', assetId: 'generic.component' }],
    containers: [], connections: []
  };
  const corruptEngine = (corrupt: 'missing' | 'nan'): ElkLayoutEngine => ({
    layout: async graph => {
      let changed = false;
      const visit = (node: ElkNode): ElkNode => {
        if (!changed && node.id.includes('_node_')) {
          changed = true;
          return { ...node, x: corrupt === 'missing' ? undefined : Number.NaN, y: corrupt === 'missing' ? undefined : 0 };
        }
        return { ...node, ...(node.children ? { children: node.children.map(visit) } : {}) };
      };
      return visit(graph);
    }
  });
  await assertRejects(computeCompoundLayoutDetailed(invalidOutputModel, { metrics: measureVisuals(invalidOutputModel) }, corruptEngine('missing')), /LAYOUT_OUTPUT_INVALID: missing node geometry/, 'L08 fake ELK missing node output is rejected');
  await assertRejects(computeCompoundLayoutDetailed(invalidOutputModel, { metrics: measureVisuals(invalidOutputModel) }, corruptEngine('nan')), /LAYOUT_OUTPUT_INVALID: invalid geometry/, 'L08 fake ELK NaN node output is rejected');

  const shuffled = { ...normalizedCollision, nodes: [...normalizedCollision.nodes].reverse(), connections: [...normalizedCollision.connections].reverse(), containers: [...normalizedCollision.containers].reverse() };
  const repeatA = await computeCompoundLayoutDetailed(normalizedCollision, { metrics: measureVisuals(normalizedCollision) });
  const repeatB = await computeCompoundLayoutDetailed(shuffled, { metrics: measureVisuals(shuffled) });
  assert(geometryDigest(repeatA.document) === geometryDigest(repeatB.document), 'layout output is deterministic under repeated and reordered inputs');

  const goldenModel = prepareArchitectureModel(SERVICEGREMLIN_GOLDEN_MODEL);
  const goldenExpected = { nodes: goldenModel.nodes.length, containers: goldenModel.containers.length, connections: goldenModel.connections.length };
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    const goldenLayout = await computeCompoundLayoutDetailed(goldenModel, { metrics: measureVisuals(goldenModel), direction });
    assert(validateDiagramDocument(goldenLayout.document).ok, `F8 ServiceGremlin ${direction} output is structurally valid`);
    assert(Object.keys(goldenLayout.document.semantic.nodes).length === goldenExpected.nodes && Object.keys(goldenLayout.document.semantic.containers).length === goldenExpected.containers && Object.keys(goldenLayout.document.semantic.connections).length === goldenExpected.connections, `F8 ${direction} retains fixture-derived ServiceGremlin counts (${goldenExpected.nodes}/${goldenExpected.containers}/${goldenExpected.connections})`);
    assert(!goldenLayout.findings.some(finding => finding.severity === 'blocking'), `F8 ServiceGremlin ${direction} has zero blocking geometry and routing findings (${goldenLayout.findings.filter(finding => finding.severity === 'blocking').length})`);
  }

  const overlap = auditLayout({
    nodes: [{ id: 'a', label: 'A', kind: 'generic' }, { id: 'b', label: 'B', kind: 'generic' }], containers: [], connections: [],
    nodeBoxes: { a: { x: 0, y: 0, width: 100, height: 80 }, b: { x: 40, y: 30, width: 100, height: 80 } },
    containerBoxes: {}, connectionPresentations: {}
  });
  assert(overlap.some(finding => finding.code === 'LAYOUT_SIBLING_OVERLAP'), 'negative geometry fixture detects an actual sibling overlap');

  const stress = createStressLayoutModel();
  const stressStarted = Date.now();
  const stressResult = await computeBestCompoundLayoutInWorker(stress, { metrics: measureVisuals(stress), timeoutMs: 10000 });
  const stressElapsedMs = Date.now() - stressStarted;
  const stressValidation = validateDiagramDocument(stressResult.document);
  assert(stressValidation.ok, `seeded F9 output remains structurally valid (seed ${STRESS_LAYOUT_SEED})`);
  assert(Object.keys(stressResult.document.presentation.nodes).length === 100 && Object.keys(stressResult.document.presentation.containers).length === 20, 'F9 retains all 100 nodes and 20 nested containers');
  assert(Object.values(stressResult.document.presentation.connections ?? {}).filter(entry => entry.route).length === 150, 'F9 retains all 150 individually routed connections');
  assert(stressElapsedMs < 10000, `F9 layout completes within the 10-second budget (${stressElapsedMs}ms)`);
  assert(!stressResult.findings.some(finding => finding.severity === 'blocking'), `F9 has zero blocking geometry, route or label findings (${stressResult.findings.filter(finding => finding.severity === 'blocking').length})`);
  const findingCounts = Object.fromEntries([...new Set(stressResult.findings.map(finding => finding.code))].sort().map(code => [code, stressResult.findings.filter(finding => finding.code === code).length]));
  console.log(`F9 seed=${STRESS_LAYOUT_SEED}, profile=${stressResult.profile}, elapsed=${stressElapsedMs}ms, blocking=${stressResult.findings.filter(finding => finding.severity === 'blocking').length}, warnings=${stressResult.findings.filter(finding => finding.severity === 'warning').length}, findings=${JSON.stringify(findingCounts)}`);
  console.log('All layout geometry checks passed.');
}

run().catch(error => { console.error(error); process.exit(1); });
