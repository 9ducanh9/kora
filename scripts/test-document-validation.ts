import assert from 'node:assert/strict';
import { createEmptyDiagramDocument, DiagramDocument } from '../src/core/diagram/types';
import { validateDiagramDocument, decodeDiagramDocument } from '../src/core/diagram/validator';
import { validateArchitectureModel } from '../src/core/ir/validator';
import { loadDiagramFromStorage, saveDiagramToStorage, StorageAdapter } from '../src/core/diagram/storage';

const now = new Date().toISOString();

function documentWithOneNode(): DiagramDocument {
  const doc = createEmptyDiagramDocument('Validation fixture');
  doc.semantic.nodes.nodeA = { id: 'nodeA', label: 'Backend A', kind: 'aws-service', assetId: 'aws.ecs' };
  doc.semantic.connections.nodeA = { id: 'nodeA', source: 'nodeA', target: 'nodeA', label: 'loop' };
  doc.presentation.nodes.nodeA = { x: -12.5, y: 20.25, width: 120, height: 80 };
  doc.presentation.viewport = { x: -100, y: 42.5, zoom: 2.4 };
  doc.metadata = { title: 'Validation fixture', createdAt: now, updatedAt: now };
  return doc;
}

function test(name: string, run: () => void) {
  run();
  console.log(`[PASS] ${name}`);
}

test('valid Document accepts negative and fractional coordinates and a node/edge ID collision', () => {
  const result = validateDiagramDocument(documentWithOneNode());
  assert.equal(result.ok, true);
});

test('strict Document schema rejects unsupported fields and does not mutate input', () => {
  const input = documentWithOneNode() as DiagramDocument & { extra: string };
  input.extra = 'keep';
  const before = structuredClone(input);
  const result = validateDiagramDocument(input);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code.startsWith('DOCUMENT_SCHEMA')));
  assert.deepEqual(input, before);
});

test('finite geometry, positive container sizes, and positive zoom are enforced', () => {
  const invalid = documentWithOneNode();
  invalid.presentation.nodes.nodeA.x = Number.NaN;
  invalid.presentation.viewport.zoom = 0;
  const result = validateDiagramDocument(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.path.join('.') === 'presentation.nodes.nodeA.x'));
  assert.ok(result.issues.some(issue => issue.path.join('.') === 'presentation.viewport.zoom'));
});

test('semantic and presentation record key parity is enforced', () => {
  const invalid = documentWithOneNode();
  delete invalid.presentation.nodes.nodeA;
  invalid.presentation.containers.orphan = { x: 0, y: 0, width: 100, height: 100 };
  const result = validateDiagramDocument(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === 'DOCUMENT_PRESENTATION_MISSING'));
  assert.ok(result.issues.some(issue => issue.code === 'DOCUMENT_PRESENTATION_ORPHAN'));
});

test('record keys must equal IDs and reserved IDs are rejected', () => {
  const invalid = documentWithOneNode();
  invalid.semantic.nodes.nodeA.id = 'different';
  const mismatch = validateDiagramDocument(invalid);
  assert.ok(!mismatch.ok && mismatch.issues.some(issue => issue.code === 'DOCUMENT_RECORD_KEY_MISMATCH'));

  const raw = {
    version: '1.0', scope: { type: 'custom' },
    nodes: [{ id: '__proto__', label: 'Bad key', kind: 'generic' }],
    connections: [], containers: []
  };
  const reserved = validateArchitectureModel(raw);
  assert.ok(!reserved.ok && reserved.issues.some(issue => issue.code === 'IR_RESERVED_ID'));
});

test('broken membership, duplicate connections and container cycles fail without repairing input', () => {
  const raw = {
    version: '1.0',
    nodes: [{ id: 'n', label: 'Node', kind: 'generic', containerId: 'missing' }],
    connections: [
      { id: 'edge', source: 'n', target: 'n' },
      { id: 'edge', source: 'n', target: 'n' }
    ],
    containers: [
      { id: 'a', label: 'A', type: 'generic-group', parentId: 'b' },
      { id: 'b', label: 'B', type: 'generic-group', parentId: 'a' }
    ]
  };
  const before = structuredClone(raw);
  const result = validateArchitectureModel(raw);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === 'IR_NODE_CONTAINER_MISSING'));
  assert.ok(result.issues.some(issue => issue.code === 'IR_DUPLICATE_CONNECTION_ID'));
  assert.ok(result.issues.some(issue => issue.code === 'IR_CONTAINER_CYCLE'));
  assert.deepEqual(raw, before);
});

test('asset alias is reported and canonicalized on the returned IR copy; unknown asset is preserved', () => {
  const raw = {
    version: '1.0',
    nodes: [
      { id: 'alb', label: 'ALB', kind: 'aws-resource', assetId: 'ALB' },
      { id: 'unknown', label: 'Mystery', kind: 'generic', assetId: 'vendor.unknown' }
    ],
    connections: [], containers: []
  };
  const result = validateArchitectureModel(raw);
  assert.ok(result.ok);
  assert.equal(result.value.nodes[0].assetId, 'aws.elb.alb');
  assert.equal(result.value.nodes[1].assetId, 'vendor.unknown');
  assert.ok(result.issues.some(issue => issue.code === 'ASSET_ALIAS_RESOLVED' && issue.severity === 'info'));
  assert.ok(result.issues.some(issue => issue.code === 'ASSET_FALLBACK' && issue.entityId === 'unknown'));
  assert.equal(raw.nodes[0].assetId, 'ALB');
});

test('legacy Documents without exactly one cloud are accepted with a warning and preserved', () => {
  const legacy = documentWithOneNode();
  const before = structuredClone(legacy);
  const result = validateDiagramDocument(legacy);
  assert.ok(result.ok);
  assert.ok(result.issues.some(issue => issue.code === 'AWS_CLOUD_NONCANONICAL' && issue.severity === 'warning'));
  assert.deepEqual(result.value, before);
});

test('JSON syntax errors return structured issues', () => {
  const result = decodeDiagramDocument('{');
  assert.ok(!result.ok && result.issues[0].code === 'DOCUMENT_JSON_SYNTAX');
});

test('storage distinguishes missing, loaded, invalid and unavailable without overwriting raw data', () => {
  let value: string | null = null;
  let writes = 0;
  const adapter: StorageAdapter = {
    getItem: () => value,
    setItem: (_key, next) => { writes++; value = next; }
  };
  assert.equal(loadDiagramFromStorage(adapter).status, 'missing');
  const doc = documentWithOneNode();
  assert.ok(saveDiagramToStorage(doc, adapter).ok);
  assert.equal(writes, 1);
  assert.equal(loadDiagramFromStorage(adapter).status, 'loaded');

  value = '{bad json';
  const invalid = loadDiagramFromStorage(adapter);
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.status === 'invalid' ? invalid.raw : '', '{bad json');
  const invalidSave = saveDiagramToStorage({ version: 'wrong' }, adapter);
  assert.ok(!invalidSave.ok && invalidSave.reason === 'validation');
  assert.equal(value, '{bad json');
  assert.equal(writes, 1);

  const unavailable: StorageAdapter = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); }
  };
  assert.equal(loadDiagramFromStorage(unavailable).status, 'unavailable');
  const failedSave = saveDiagramToStorage(doc, unavailable);
  assert.ok(!failedSave.ok && failedSave.reason === 'unavailable');
});

console.log('All document validation checks passed.');
