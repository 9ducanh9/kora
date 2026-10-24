import assert from 'node:assert/strict';
import { createEmptyDiagramDocument, DiagramDocument } from '../src/core/diagram/types';
import {
  ApplyLayoutCommand,
  CreateConnectionCommand,
  DeleteSelectionCommand,
  MoveDiagramObjectsCommand,
  ReconnectConnectionCommand,
  SetDiagramDocumentCommand,
  UpdateContainerLabelCommand,
  UpdateNodeLabelCommand
} from '../src/core/commands/commands';
import { buildMovementClosure, previewMovement } from '../src/core/commands/movement';
import { CommandEngine } from '../src/core/commands/commandEngine';
import { OperationCoordinator } from '../src/core/diagram/operationCoordinator';

function fixture(): DiagramDocument {
  const doc = createEmptyDiagramDocument('Editor fixture');
  doc.semantic.containers = {
    cloud: { id: 'cloud', label: 'Cloud', type: 'cloud', origin: 'explicit' },
    vpc: { id: 'vpc', label: 'VPC', type: 'vpc', parentId: 'cloud' },
    subnetA: { id: 'subnetA', label: 'Subnet A', type: 'subnet-private', parentId: 'vpc' },
    subnetB: { id: 'subnetB', label: 'Subnet B', type: 'subnet-private', parentId: 'vpc' },
    empty: { id: 'empty', label: 'Empty subnet', type: 'subnet-private', parentId: 'vpc' }
  };
  doc.presentation.containers = {
    cloud: { x: 0, y: 0, width: 1000, height: 700 },
    vpc: { x: 100, y: 100, width: 800, height: 500 },
    subnetA: { x: 150, y: 180, width: 250, height: 300 },
    subnetB: { x: 500, y: 180, width: 250, height: 300 },
    empty: { x: 500, y: 500, width: 200, height: 100 }
  };
  doc.semantic.nodes = {
    user: { id: 'user', label: 'Users', kind: 'external', assetId: 'external.user' },
    a: { id: 'a', label: 'Backend A', kind: 'aws-service', assetId: 'aws.ecs', containerId: 'subnetA' },
    b: { id: 'b', label: 'Backend B', kind: 'aws-service', assetId: 'aws.ecs', containerId: 'subnetB' },
    cache: { id: 'cache', label: 'Cache', kind: 'aws-service', assetId: 'aws.elasticache', containerId: 'cloud' }
  };
  doc.presentation.nodes = {
    user: { x: -80, y: 10, width: 96, height: 80 },
    a: { x: 190, y: 260, width: 96, height: 80 },
    b: { x: 540, y: 260, width: 96, height: 80 },
    cache: { x: 800, y: 200, width: 96, height: 80 }
  };
  doc.semantic.connections = {
    ab: { id: 'ab', source: 'a', target: 'b', label: 'sync' },
    loop: { id: 'loop', source: 'a', target: 'a', label: 'loop' },
    silent: { id: 'silent', source: 'user', target: 'cache' }
  };
  const route = { version: '1.0' as const, inputSignature: 'a'.repeat(64), points: [{ x: 286, y: 300 }, { x: 540, y: 300 }], label: { x: 380, y: 285, width: 50, height: 20 } };
  doc.presentation.connections = {
    ab: { sourceSide: 'right', targetSide: 'left', route },
    loop: { targetSide: 'top', route: { ...route, points: [{ x: 190, y: 260 }, { x: 190, y: 200 }] } },
    silent: {}
  };
  return doc;
}

function test(name: string, run: () => void) {
  run();
  console.log(`[PASS] ${name}`);
}

test('movement closure includes all semantic descendants and deduplicates selections', () => {
  const doc = fixture();
  const moves = buildMovementClosure(doc, ['vpc', 'subnetA', 'a']);
  assert.deepEqual(Object.keys(moves).sort(), ['a', 'b', 'empty', 'subnetA', 'subnetB', 'vpc'].sort());
  assert.equal(moves.cache, undefined);
  assert.equal(moves.user, undefined);
});

test('drag preview preserves group offsets without mutating the document before commit', () => {
  const doc = fixture();
  const original = structuredClone(doc);
  const engine = new CommandEngine(doc);
  const moves = buildMovementClosure(doc, ['a', 'b']);
  const revision = engine.revision;
  const preview = previewMovement(moves, 'a', 'b', { x: 557, y: 251 }, false);
  assert.deepEqual(preview.delta, { x: 17, y: -9 });
  assert.deepEqual(preview.positions, { a: { x: 207, y: 251 }, b: { x: 557, y: 251 } });
  assert.deepEqual(doc, original);
  assert.equal(engine.revision, revision);
  assert.equal(engine.getDocument(), doc);
});

test('drag preview snaps the group relative to the stable selection anchor', () => {
  const moves = buildMovementClosure(fixture(), ['a', 'b']);
  const preview = previewMovement(moves, 'a', 'b', { x: 558, y: 260 }, true);
  assert.deepEqual(preview.delta, { x: 10, y: 0 });
  assert.deepEqual(preview.positions, { a: { x: 200, y: 260 }, b: { x: 550, y: 260 } });
});

test('cancelling a drag preview leaves command revision and redo history untouched', () => {
  const doc = fixture();
  const engine = new CommandEngine(doc);
  engine.dispatch(new UpdateNodeLabelCommand('a', 'Backend Renamed'));
  engine.undo();
  const revision = engine.revision;
  const updatedAt = engine.getDocument().metadata.updatedAt;
  const preview = previewMovement(buildMovementClosure(doc, ['a']), 'a', 'a', { x: 220, y: 280 }, false);
  assert.deepEqual(preview.positions.a, { x: 220, y: 280 });
  // Discarding the returned preview mirrors pointer-cancel: no command is dispatched.
  assert.equal(engine.revision, revision);
  assert.equal(engine.getDocument().metadata.updatedAt, updatedAt);
  assert.equal(engine.canRedo, true);
  assert.deepEqual(engine.getDocument(), doc);
});

test('one move command translates a container subtree, keeps membership, and restores exact cache on undo', () => {
  const doc = fixture();
  const closure = buildMovementClosure(doc, ['vpc']);
  for (const move of Object.values(closure)) move.to = { x: move.from.x + 40, y: move.from.y - 20 };
  const engine = new CommandEngine(doc);
  engine.dispatch(new MoveDiagramObjectsCommand(closure));
  assert.equal(engine.getDocument().presentation.containers.vpc.x, 140);
  assert.equal(engine.getDocument().presentation.nodes.a.x, 230);
  assert.equal(engine.getDocument().presentation.nodes.b.y, 240);
  assert.equal(engine.getDocument().semantic.nodes.a.containerId, 'subnetA');
  assert.equal(engine.getDocument().presentation.connections?.ab?.route, undefined);
  assert.equal(engine.getDocument().presentation.connections?.ab?.sourceSide, 'right');
  assert.deepEqual(engine.getDocument().presentation.connections?.silent, {});
  engine.undo();
  assert.deepEqual(engine.getDocument(), doc);
  engine.redo();
  assert.equal(engine.getDocument().presentation.nodes.a.x, 230);
});

test('effective no-op preserves timestamp, undo history and redo branch', () => {
  const doc = fixture();
  const engine = new CommandEngine(doc);
  engine.dispatch(new UpdateNodeLabelCommand('a', 'Backend Renamed'));
  engine.undo();
  assert.equal(engine.canRedo, true);
  const revision = engine.revision;
  const updatedAt = engine.getDocument().metadata.updatedAt;
  const moves = { a: { kind: 'node' as const, from: { x: 190, y: 260 }, to: { x: 190, y: 260 } } };
  assert.equal(engine.dispatch(new MoveDiagramObjectsCommand(moves)), false);
  assert.equal(engine.revision, revision);
  assert.equal(engine.getDocument().metadata.updatedAt, updatedAt);
  assert.equal(engine.canRedo, true);
  engine.redo();
  assert.equal(engine.getDocument().semantic.nodes.a.label, 'Backend Renamed');
});

test('node and container labels preserve raw text and blank labels are rejected as no-ops', () => {
  const doc = fixture();
  const engine = new CommandEngine(doc);
  engine.dispatch(new UpdateNodeLabelCommand('a', '  Worker API  '));
  engine.dispatch(new UpdateContainerLabelCommand('subnetA', '  Data tier  '));
  assert.equal(engine.getDocument().semantic.nodes.a.label, '  Worker API  ');
  assert.equal(engine.getDocument().semantic.containers.subnetA.label, '  Data tier  ');
  const current = engine.getDocument();
  assert.equal(engine.dispatch(new UpdateNodeLabelCommand('a', '   ')), false);
  assert.equal(engine.getDocument(), current);
});

test('node rename resizes measured text in the same transaction and undo restores prior geometry', () => {
  const doc = fixture();
  const engine = new CommandEngine(doc);
  const before = engine.getDocument();
  engine.dispatch(new UpdateNodeLabelCommand('a', 'Backend service with a substantially longer descriptive name'));
  assert.ok((engine.getDocument().presentation.nodes.a.height ?? 0) > (before.presentation.nodes.a.height ?? 0));
  assert.equal(engine.getDocument().semantic.nodes.a.label, 'Backend service with a substantially longer descriptive name');
  engine.undo();
  assert.deepEqual(engine.getDocument(), before);
});

test('container rename grows its header and shifts nested content atomically', () => {
  const doc = fixture();
  const engine = new CommandEngine(doc);
  engine.dispatch(new UpdateContainerLabelCommand('subnetA', 'A very long wrapped subnet header', { minimumWidth: 320, oldContentTop: 40, newContentTop: 76 }));
  assert.equal(engine.getDocument().presentation.containers.subnetA.width, 320);
  assert.equal(engine.getDocument().presentation.containers.subnetA.height, 336);
  assert.equal(engine.getDocument().presentation.nodes.a.y, 296);
  engine.undo();
  assert.deepEqual(engine.getDocument(), doc);
});

test('semantic edits invalidate routes in the same command and undo restores the cache snapshot', () => {
  const engine = new CommandEngine(fixture());
  engine.dispatch(new UpdateNodeLabelCommand('a', 'Worker A'));
  assert.equal(engine.getDocument().presentation.connections?.ab?.route, undefined);
  assert.equal(engine.getDocument().presentation.connections?.ab?.sourceSide, 'right');
  assert.equal(engine.getDocument().presentation.connections?.loop?.route, undefined);
  assert.deepEqual(engine.getDocument().presentation.connections?.silent, {});
  engine.undo();
  assert.ok(engine.getDocument().presentation.connections?.ab?.route);
  assert.ok(engine.getDocument().presentation.connections?.loop?.route);
});

test('new connections retain explicit handles; reconnect changes endpoints and sides atomically', () => {
  const engine = new CommandEngine(fixture());
  engine.dispatch(new CreateConnectionCommand({ id: 'new', source: 'user', target: 'b', label: '' }, { sourceSide: 'bottom', targetSide: 'top' }));
  assert.equal(engine.getDocument().semantic.connections.new.target, 'b');
  assert.deepEqual(engine.getDocument().presentation.connections?.new, { sourceSide: 'bottom', targetSide: 'top' });
  engine.dispatch(new ReconnectConnectionCommand('new', 'cache', 'a', 'left-source', 'bottom-target'));
  assert.equal(engine.getDocument().semantic.connections.new.source, 'cache');
  assert.equal(engine.getDocument().semantic.connections.new.target, 'a');
  assert.equal(engine.getDocument().presentation.connections?.new?.sourceSide, 'left');
  assert.equal(engine.getDocument().presentation.connections?.new?.targetSide, 'bottom');
  engine.undo();
  assert.equal(engine.getDocument().semantic.connections.new.source, 'user');
  assert.equal(engine.getDocument().presentation.connections?.new?.sourceSide, 'bottom');
});

test('invalid reconnection is a no-op and does not invalidate the cache', () => {
  const engine = new CommandEngine(fixture());
  const before = engine.getDocument();
  assert.equal(engine.dispatch(new ReconnectConnectionCommand('ab', 'missing', 'b')), false);
  assert.equal(engine.getDocument(), before);
});

test('deleting a container cascades through descendants and incident edges in one undoable command', () => {
  const original = fixture();
  const engine = new CommandEngine(original);
  engine.dispatch(new DeleteSelectionCommand([], ['vpc'], []));
  const current = engine.getDocument();
  assert.equal(current.semantic.containers.vpc, undefined);
  assert.equal(current.semantic.containers.subnetA, undefined);
  assert.equal(current.semantic.containers.empty, undefined);
  assert.equal(current.semantic.nodes.a, undefined);
  assert.equal(current.semantic.nodes.b, undefined);
  assert.equal(current.semantic.nodes.cache !== undefined, true);
  assert.equal(current.semantic.connections.ab, undefined);
  assert.equal(current.presentation.connections?.ab, undefined);
  engine.undo();
  assert.deepEqual(engine.getDocument(), original);
});

test('layout command changes presentation only and preserves viewport, semantics, and route undo', () => {
  const doc = fixture();
  const engine = new CommandEngine(doc);
  const newNodes = { ...doc.presentation.nodes, a: { ...doc.presentation.nodes.a, x: 210 } };
  engine.dispatch(new ApplyLayoutCommand(doc.presentation.nodes, doc.presentation.containers, newNodes, doc.presentation.containers));
  assert.equal(engine.getDocument().presentation.nodes.a.x, 210);
  assert.equal(engine.getDocument().semantic.nodes.a.label, 'Backend A');
  assert.deepEqual(engine.getDocument().presentation.viewport, doc.presentation.viewport);
  engine.undo();
  assert.deepEqual(engine.getDocument(), doc);
});

test('replacement is one history command with exact undo and redo snapshots', () => {
  const before = fixture();
  const after = createEmptyDiagramDocument('Imported empty document');
  const engine = new CommandEngine(before);
  engine.dispatch(new SetDiagramDocumentCommand(before, after, 'Import'));
  assert.equal(engine.getDocument().metadata.title, 'Imported empty document');
  engine.undo();
  assert.deepEqual(engine.getDocument(), before);
  engine.redo();
  assert.deepEqual(engine.getDocument(), after);
});

test('operation tokens distinguish superseded and revision-stale results', () => {
  const coordinator = new OperationCoordinator();
  const first = coordinator.begin(4);
  const second = coordinator.begin(4);
  assert.equal(coordinator.inspect(first, 4), 'superseded');
  assert.equal(coordinator.inspect(second, 5), 'stale');
  assert.equal(coordinator.inspect(second, 4), 'current');
  assert.equal(coordinator.finish(first), false);
  assert.equal(coordinator.finish(second), true);
});

console.log('All editor command checks passed.');
