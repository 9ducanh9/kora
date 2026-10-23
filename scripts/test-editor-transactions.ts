import assert from 'node:assert/strict';
import { CommandEngine } from '../src/core/commands/commandEngine';
import { ApplyLayoutCommand, SetDiagramDocumentCommand } from '../src/core/commands/commands';
import { Command } from '../src/core/commands/types';
import { createEmptyDiagramDocument, DiagramDocument } from '../src/core/diagram/types';
import { OperationCoordinator } from '../src/core/diagram/operationCoordinator';

function fixture(): DiagramDocument {
  const doc = createEmptyDiagramDocument('Transaction fixture');
  doc.semantic.nodes.a = { id: 'a', label: 'A', kind: 'generic', assetId: 'generic.component' };
  doc.semantic.nodes.b = { id: 'b', label: 'B', kind: 'generic', assetId: 'generic.component' };
  doc.semantic.connections.ab = { id: 'ab', source: 'a', target: 'b', label: 'read' };
  doc.presentation.nodes.a = { x: 20, y: 30, width: 96, height: 80 };
  doc.presentation.nodes.b = { x: 260, y: 40, width: 104, height: 88 };
  doc.presentation.connections = {
    ab: { sourceSide: 'right', targetSide: 'left', route: { version: '1.0', inputSignature: 'b'.repeat(64), points: [{ x: 116, y: 62 }, { x: 260, y: 62 }], label: { x: 172, y: 48, width: 36, height: 22 } } }
  };
  doc.presentation.viewport = { x: -40, y: 18, zoom: 1.25 };
  return doc;
}

function test(name: string, run: () => void) {
  run();
  console.log(`[PASS] ${name}`);
}

class InvalidOnExecute implements Command {
  readonly id = 'invalid-execute';
  readonly description = 'returns an invalid document';
  execute(document: DiagramDocument): DiagramDocument {
    return { ...document, presentation: { ...document.presentation, viewport: { ...document.presentation.viewport, zoom: 0 } } };
  }
  undo(document: DiagramDocument): DiagramDocument { return document; }
}

class InvalidOnRedo implements Command {
  readonly id = 'invalid-redo';
  readonly description = 'fails validation on the second execute';
  private calls = 0;
  constructor(private readonly before: DiagramDocument) {}
  execute(document: DiagramDocument): DiagramDocument {
    this.calls++;
    if (this.calls === 1) return { ...document, metadata: { ...document.metadata, title: 'After first execute' } };
    return { ...document, presentation: { ...document.presentation, viewport: { ...document.presentation.viewport, zoom: 0 } } };
  }
  undo(): DiagramDocument { return this.before; }
}

class InvalidOnUndo implements Command {
  readonly id = 'invalid-undo';
  readonly description = 'returns an invalid document on undo';
  execute(document: DiagramDocument): DiagramDocument { return { ...document, metadata: { ...document.metadata, title: 'Committed' } }; }
  undo(document: DiagramDocument): DiagramDocument {
    return { ...document, presentation: { ...document.presentation, viewport: { ...document.presentation.viewport, zoom: 0 } } };
  }
}

test('layout and document replacement each commit atomically with exact undo and redo snapshots', () => {
  const before = fixture();
  const engine = new CommandEngine(before);
  const changedNodes = { ...before.presentation.nodes, a: { ...before.presentation.nodes.a, x: 140 } };
  const changedRoutes = { ab: { sourceSide: 'bottom' as const, targetSide: 'top' as const } };
  engine.dispatch(new ApplyLayoutCommand(before.presentation.nodes, before.presentation.containers, changedNodes, before.presentation.containers, changedRoutes));
  const afterLayout = structuredClone(engine.getDocument());
  assert.deepEqual(engine.getDocument().semantic, before.semantic);
  assert.deepEqual(engine.getDocument().presentation.viewport, before.presentation.viewport);
  assert.equal(engine.getDocument().presentation.connections?.ab?.route, undefined);
  engine.undo();
  assert.deepEqual(engine.getDocument(), before);
  engine.redo();
  assert.deepEqual(engine.getDocument(), afterLayout);

  const imported = createEmptyDiagramDocument('Imported replacement');
  engine.dispatch(new SetDiagramDocumentCommand(engine.getDocument(), imported, 'Import'));
  engine.undo();
  assert.deepEqual(engine.getDocument(), afterLayout);
  engine.redo();
  assert.deepEqual(engine.getDocument(), imported);
});

test('invalid command execution leaves document, revision, listeners and history untouched', () => {
  const engine = new CommandEngine(fixture());
  const before = structuredClone(engine.getDocument());
  let notifications = 0;
  engine.subscribe(() => notifications++);
  assert.throws(() => engine.dispatch(new InvalidOnExecute()), /Command produced an invalid document/);
  assert.deepEqual(engine.getDocument(), before);
  assert.equal(engine.revision, 0);
  assert.equal(notifications, 0);
  assert.equal(engine.canUndo, false);
  assert.equal(engine.canRedo, false);
});

test('invalid undo leaves the committed document and cursor unchanged', () => {
  const engine = new CommandEngine(fixture());
  engine.dispatch(new InvalidOnUndo());
  const committed = structuredClone(engine.getDocument());
  const revision = engine.revision;
  assert.throws(() => engine.undo(), /Undo produced an invalid document/);
  assert.deepEqual(engine.getDocument(), committed);
  assert.equal(engine.revision, revision);
  assert.equal(engine.canUndo, true);
  assert.equal(engine.canRedo, false);
});

test('invalid redo rolls back the history cursor and can be retried without mutating state', () => {
  const before = fixture();
  const engine = new CommandEngine(before);
  engine.dispatch(new InvalidOnRedo(before));
  engine.undo();
  const undone = structuredClone(engine.getDocument());
  const revision = engine.revision;
  assert.throws(() => engine.redo(), /Redo produced an invalid document/);
  assert.deepEqual(engine.getDocument(), undone);
  assert.equal(engine.revision, revision);
  assert.equal(engine.canRedo, true);
  assert.equal(engine.canUndo, false);
});

test('a new edit after undo truncates the redo branch and invalidates route geometry in one revision', () => {
  const engine = new CommandEngine(fixture());
  const initialRoute = structuredClone(engine.getDocument().presentation.connections?.ab?.route);
  const labelCommand: Command = {
    id: 'change-label', description: 'change label',
    execute: document => ({ ...document, semantic: { ...document.semantic, nodes: { ...document.semantic.nodes, a: { ...document.semantic.nodes.a, label: 'Renamed' } } }, presentation: { ...document.presentation, connections: { ab: { sourceSide: 'right', targetSide: 'left' } } } }),
    undo: document => ({ ...document, semantic: { ...document.semantic, nodes: { ...document.semantic.nodes, a: { ...document.semantic.nodes.a, label: 'A' } } }, presentation: { ...document.presentation, connections: { ab: { sourceSide: 'right', targetSide: 'left', route: initialRoute } } } })
  };
  engine.dispatch(labelCommand);
  engine.dispatch(new ApplyLayoutCommand(engine.getDocument().presentation.nodes, engine.getDocument().presentation.containers, engine.getDocument().presentation.nodes, engine.getDocument().presentation.containers));
  engine.undo();
  assert.equal(engine.canRedo, true);
  engine.dispatch({
    id: 'move-a', description: 'move node',
    execute: document => ({ ...document, presentation: { ...document.presentation, nodes: { ...document.presentation.nodes, a: { ...document.presentation.nodes.a, x: 60 } }, connections: { ab: { sourceSide: 'right', targetSide: 'left' } } } }),
    undo: document => ({ ...document, presentation: { ...document.presentation, nodes: { ...document.presentation.nodes, a: { ...document.presentation.nodes.a, x: 20 } }, connections: { ab: { sourceSide: 'right', targetSide: 'left', route: initialRoute } } } })
  });
  assert.equal(engine.getDocument().presentation.nodes.a.x, 60);
  assert.equal(engine.canRedo, false);
  assert.equal(engine.getDocument().presentation.connections?.ab?.route, undefined);
});

test('operation coordinator rejects stale, superseded and explicitly invalidated completions', () => {
  const coordinator = new OperationCoordinator();
  const oldRevision = coordinator.begin(10);
  assert.equal(coordinator.inspect(oldRevision, 11), 'stale');
  const superseded = coordinator.begin(11);
  const current = coordinator.begin(11);
  assert.equal(coordinator.inspect(superseded, 11), 'superseded');
  assert.equal(coordinator.inspect(current, 11), 'current');
  assert.equal(coordinator.finish(superseded), false);
  coordinator.invalidate();
  assert.equal(coordinator.inspect(current, 11), 'superseded');
  assert.equal(coordinator.finish(current), false);
});

console.log('All editor transaction checks passed.');
