import assert from 'node:assert/strict';
import { createEmptyDiagramDocument, DiagramDocument } from '../src/core/diagram/types';
import {
  exportDiagramToFile,
  importDiagramFromJson,
  loadDiagramFromStorage,
  saveDiagramToStorage,
  StorageAdapter
} from '../src/core/diagram/storage';

function fixture(): DiagramDocument {
  const doc = createEmptyDiagramDocument('Ingestion fixture');
  doc.semantic.containers.cloud = { id: 'cloud', label: 'Cloud', type: 'cloud', origin: 'explicit' };
  doc.semantic.nodes.api = { id: 'api', label: 'API', kind: 'aws-service', assetId: 'aws.ecs', containerId: 'cloud' };
  doc.semantic.nodes.db = { id: 'db', label: 'Database', kind: 'aws-service', assetId: 'aws.rds', containerId: 'cloud' };
  doc.semantic.connections.query = { id: 'query', source: 'api', target: 'db', label: 'query' };
  doc.presentation.containers.cloud = { x: -45.5, y: 20, width: 640, height: 420 };
  doc.presentation.nodes.api = { x: 80.25, y: 130, width: 145, height: 92 };
  doc.presentation.nodes.db = { x: 390, y: 130, width: 152, height: 92 };
  doc.presentation.connections = {
    query: {
      sourceSide: 'right',
      targetSide: 'left',
      route: { version: '1.0', inputSignature: 'a'.repeat(64), points: [{ x: 225.25, y: 166 }, { x: 390, y: 166 }], label: { x: 287, y: 150, width: 42, height: 24 } }
    }
  };
  doc.presentation.viewport = { x: -122, y: 48.5, zoom: 1.7 };
  return doc;
}

function memoryAdapter(initial: string | null = null): StorageAdapter & { peek(): string | null; writes(): number } {
  let value = initial;
  let writeCount = 0;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; writeCount++; },
    peek: () => value,
    writes: () => writeCount
  };
}

function test(name: string, run: () => void) {
  run();
  console.log(`[PASS] ${name}`);
}

test('JSON import preserves semantics, route cache, geometry and viewport', () => {
  const original = fixture();
  const imported = importDiagramFromJson(JSON.stringify(original));
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.deepEqual(imported.value, original);
  assert.deepEqual(imported.value.presentation.connections?.query?.route, original.presentation.connections?.query?.route);
});

test('storage round trip preserves saved layout and never substitutes fresh coordinates', () => {
  const adapter = memoryAdapter();
  const original = fixture();
  const saved = saveDiagramToStorage(original, adapter);
  assert.equal(saved.ok, true);
  assert.equal(adapter.writes(), 1);
  const loaded = loadDiagramFromStorage(adapter);
  assert.equal(loaded.status, 'loaded');
  if (loaded.status === 'loaded') assert.deepEqual(loaded.document, original);
});

test('malformed import and invalid save return issues without replacing stored raw input', () => {
  const adapter = memoryAdapter('{not-json');
  const before = adapter.peek();
  const imported = importDiagramFromJson('{not-json');
  assert.ok(!imported.ok && imported.issues.some(issue => issue.code === 'DOCUMENT_JSON_SYNTAX'));
  const loaded = loadDiagramFromStorage(adapter);
  assert.equal(loaded.status, 'invalid');
  if (loaded.status === 'invalid') assert.equal(loaded.raw, before);
  const saved = saveDiagramToStorage({ version: 'unsupported' }, adapter);
  assert.ok(!saved.ok && saved.reason === 'validation');
  assert.equal(adapter.peek(), before);
  assert.equal(adapter.writes(), 0);
});

test('storage read and write failures are surfaced as structured results', () => {
  const denied: StorageAdapter = {
    getItem: () => { throw new Error('storage denied'); },
    setItem: () => { throw new Error('quota exceeded'); }
  };
  const load = loadDiagramFromStorage(denied);
  assert.equal(load.status, 'unavailable');
  if (load.status === 'unavailable') assert.equal(load.issues[0].code, 'STORAGE_READ_FAILED');
  const save = saveDiagramToStorage(fixture(), denied);
  assert.ok(!save.ok && save.reason === 'unavailable');
  if (!save.ok) assert.equal(save.issues[0].code, 'STORAGE_WRITE_FAILED');
});

test('server-side import and export remain safe when browser download and local storage are unavailable', () => {
  const noStorage = loadDiagramFromStorage();
  assert.equal(noStorage.status, 'unavailable');
  const noDownload = exportDiagramToFile(fixture());
  assert.ok(!noDownload.ok && noDownload.reason === 'unavailable');
});

console.log('All document ingestion checks passed.');
