import assert from 'node:assert/strict';
import { createEmptyDiagramDocument, DiagramDocument } from '../src/core/diagram/types';
import { decodeDiagramDocument, validateDiagramDocument } from '../src/core/diagram/validator';
import { DIAGRAM_STORAGE_KEY, StorageAdapter } from '../src/core/diagram/storage';
import { PersistenceCoordinator } from '../src/core/workspace/persistenceCoordinator';
import { CommandEngine } from '../src/core/commands/commandEngine';
import { SetDiagramDocumentCommand, UpdateNodeLabelCommand } from '../src/core/commands/commands';
import { OperationCoordinator } from '../src/core/diagram/operationCoordinator';
import { awaitInteraction, cancelActiveInteractions, registerActiveInteraction, registerCancellablePreview, settleActiveInteractions } from '../src/core/editor/interactionSettlement';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
let passed = 0;

class MemoryStorage implements StorageAdapter {
  value: string | null = null;
  writes = 0;
  failWrites = false;
  failReads = false;
  getItem(key: string) { assert.equal(key, DIAGRAM_STORAGE_KEY); if (this.failReads) throw new Error('denied'); return this.value; }
  setItem(key: string, value: string) { assert.equal(key, DIAGRAM_STORAGE_KEY); this.writes++; if (this.failWrites) throw new Error('quota'); this.value = value; }
}

class FakeClock {
  private id = 0;
  private now = 0;
  private timers = new Map<number, { due: number; callback: () => void }>();
  setTimer = ((handler: TimerHandler, timeout = 0) => {
    const id = ++this.id;
    this.timers.set(id, { due: this.now + Number(timeout), callback: () => { if (typeof handler === 'function') handler(); } });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  clearTimer = ((id: ReturnType<typeof setTimeout>) => { this.timers.delete(id as unknown as number); }) as typeof clearTimeout;
  advance(milliseconds: number) {
    this.now += milliseconds;
    while (true) {
      const next = [...this.timers.entries()].filter(([, timer]) => timer.due <= this.now).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) return;
      this.timers.delete(next[0]); next[1].callback();
    }
  }
}

function documentWithSource(prompt = 'Users → API 🚀') {
  const doc = createEmptyDiagramDocument('Workspace test');
  doc.metadata.source = { kind: 'prompt', prompt, context: { scope: 'overall-architecture' }, parser: { id: 'fake-test' }, generatedAt: '2026-10-18T00:00:00.000Z' };
  return doc;
}

async function check(name: string, test: () => void | Promise<void>) {
  await test(); passed++; process.stdout.write(`PASS ${name}\n`);
}

async function main() {
  await check('U01 legacy documents keep source absent; valid source round-trips and invalid timestamp is rejected', () => {
    const legacy = createEmptyDiagramDocument('Legacy');
    const decodedLegacy = decodeDiagramDocument(JSON.stringify(legacy));
    assert.equal(decodedLegacy.ok, true);
    if (decodedLegacy.ok) assert.equal(Object.hasOwn(decodedLegacy.value.metadata, 'source'), false);
    const sourced = documentWithSource('  Tiếng Việt 👋  ');
    const decodedSourced = decodeDiagramDocument(JSON.stringify(sourced));
    assert.equal(decodedSourced.ok, true);
    if (decodedSourced.ok) assert.equal(decodedSourced.value.metadata.source?.prompt, '  Tiếng Việt 👋  ');
    const invalid = clone(sourced); invalid.metadata.source!.generatedAt = 'yesterday';
    assert.equal(validateDiagramDocument(invalid).ok, false);
  });

  await check('U09/U10 commit-only debounce stores the latest snapshot and Undo before flush is a no-op', () => {
    const clock = new FakeClock(); const storage = new MemoryStorage();
    const persistence = new PersistenceCoordinator({ adapter: storage, debounceMs: 10, maxWaitMs: 30, setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: () => new Date('2026-10-18T00:00:00.000Z') });
    const initial = createEmptyDiagramDocument('Initial');
    assert.equal(persistence.hydrate(initial).status, 'missing');
    const edited = { ...initial, metadata: { ...initial.metadata, title: 'Edited' } };
    persistence.observe(edited, 1, 0, false);
    assert.equal(storage.writes, 0);
    persistence.observe(edited, 1, 0, true);
    assert.equal(persistence.getStatus().state, 'dirty');
    clock.advance(9); assert.equal(storage.writes, 0);
    const undone = { ...edited, metadata: { ...initial.metadata } };
    persistence.observe(undone, 2, 0, true);
    clock.advance(40);
    assert.equal(storage.writes, 0);
    assert.equal(persistence.getStatus().state, 'new');
    persistence.dispose();
  });

  await check('U02/U13 source survives save and no-op save does not write or mutate the Document', () => {
    const storage = new MemoryStorage(); const persistence = new PersistenceCoordinator({ adapter: storage });
    const doc = documentWithSource('  prompt\n  with spaces ');
    storage.value = JSON.stringify(doc);
    assert.equal(persistence.hydrate(doc).status, 'loaded');
    const before = JSON.stringify(doc);
    const first = persistence.saveExplicit(doc);
    const writes = storage.writes;
    const second = persistence.saveExplicit({ ...doc, metadata: { ...doc.metadata, updatedAt: '2027-01-01T00:00:00.000Z' } });
    assert.equal(first?.ok, true); assert.equal(second?.ok, true);
    assert.equal(storage.writes, writes);
    assert.equal(JSON.stringify(doc), before);
    assert.equal(JSON.parse(storage.value!).metadata.source.prompt, '  prompt\n  with spaces ');
    persistence.dispose();
  });

  await check('U14 storage failure stays visible without retry loops; Retry saves the latest snapshot', () => {
    const clock = new FakeClock(); const storage = new MemoryStorage(); storage.failWrites = true;
    const persistence = new PersistenceCoordinator({ adapter: storage, debounceMs: 5, maxWaitMs: 20, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const initial = createEmptyDiagramDocument('Initial'); persistence.hydrate(initial);
    const latest = { ...initial, metadata: { ...initial.metadata, title: 'Latest after quota' } };
    persistence.observe(latest, 1, 0, true); clock.advance(5);
    assert.equal(persistence.getStatus().state, 'error'); assert.equal(persistence.getStatus().dirty, true);
    const writeCountAfterFailure = storage.writes;
    persistence.observe({ ...latest, metadata: { ...latest.metadata, title: 'Newest' } }, 2, 0, true); clock.advance(50);
    assert.equal(storage.writes, writeCountAfterFailure);
    storage.failWrites = false;
    assert.equal(persistence.saveExplicit()?.ok, true);
    assert.equal(JSON.parse(storage.value!).metadata.title, 'Newest');
    assert.equal(persistence.getStatus().state, 'clean');
    persistence.dispose();
  });

  await check('U16 external storage change pauses autosave, then explicit Save writes the current document', () => {
    const storage = new MemoryStorage(); const original = createEmptyDiagramDocument('A');
    storage.value = JSON.stringify(original);
    const persistence = new PersistenceCoordinator({ adapter: storage });
    assert.equal(persistence.hydrate(createEmptyDiagramDocument()).status, 'loaded');
    const external = clone(original); external.metadata.title = 'B';
    assert.equal(persistence.handleExternalStorageChange(JSON.stringify(external)), true);
    const current = { ...original, metadata: { ...original.metadata, title: 'A current edit' } };
    persistence.observe(current, 1, 0, true);
    assert.equal(persistence.getStatus().state, 'paused');
    assert.equal(persistence.saveExplicit()?.ok, true);
    assert.equal(JSON.parse(storage.value!).metadata.title, 'A current edit');
    persistence.dispose();
  });

  await check('U04 replacement Undo/Redo restores the matching provenance and edits create one history command', () => {
    const previous = createEmptyDiagramDocument('Previous');
    const generated = documentWithSource('Generate A'); generated.metadata.title = 'Generated A';
    const engine = new CommandEngine(previous);
    const events: string[] = [];
    engine.subscribe((_doc, event) => events.push(`${event.kind}:${event.operation}`));
    assert.equal(engine.dispatch(new SetDiagramDocumentCommand(previous, generated, 'Generate')), true);
    assert.equal(engine.getDocument().metadata.source?.prompt, 'Generate A');
    assert.equal(engine.undo(), true); assert.equal(engine.getDocument().metadata.source, undefined);
    assert.equal(engine.redo(), true); assert.equal(engine.getDocument().metadata.source?.prompt, 'Generate A');
    assert.deepEqual(events, ['replacement:dispatch', 'replacement:undo', 'replacement:redo']);
    const beforeUndo = engine.canUndo; assert.equal(beforeUndo, true);
  });

  await check('U06 operation owner cancellation cannot be cleared by a superseded request', () => {
    const coordinator = new OperationCoordinator(); const calls: string[] = [];
    const first = coordinator.begin(0, 0); coordinator.registerCancellation(first, reason => calls.push(`A:${reason}`));
    const second = coordinator.begin(0, 0); coordinator.registerCancellation(second, reason => calls.push(`B:${reason}`));
    assert.deepEqual(calls, ['A:superseded']);
    coordinator.invalidate();
    assert.deepEqual(calls, ['A:superseded', 'B:invalidated']);
  });

  await check('U17 Save settlement waits for active labels, times out at its deadline, and drops late font completion', async () => {
    let commits = 0;
    const unregisterImmediate = registerActiveInteraction('edge:settlement-test', () => { commits++; });
    await settleActiveInteractions(100);
    unregisterImmediate();
    assert.equal(commits, 1);

    let finishFonts!: () => void;
    const fonts = new Promise<void>(resolve => { finishFonts = resolve; });
    const unregisterDelayed = registerActiveInteraction('node:settlement-test', async signal => {
      await awaitInteraction(fonts, signal, 100);
      commits++;
    });
    await assert.rejects(settleActiveInteractions(10), error => error instanceof Error && 'code' in error && error.code === 'SETTLEMENT_TIMEOUT');
    finishFonts();
    await new Promise(resolve => setTimeout(resolve, 0));
    unregisterDelayed();
    assert.equal(commits, 1);
  });

  await check('U03/U04/U11 replacement cancellation aborts an in-flight blur commit and clears canvas previews', async () => {
    let finishFonts!: () => void;
    const fonts = new Promise<void>(resolve => { finishFonts = resolve; });
    const editorController = new AbortController();
    let cancelCount = 0; let committed = false; let previewCancelled = false;
    registerActiveInteraction('node:replacement-cancel', async () => {
      await awaitInteraction(fonts, editorController.signal, 100);
      committed = true;
    }, () => {
      cancelCount++;
      editorController.abort(new DOMException('Replaced by a new document.', 'AbortError'));
    });
    const unregisterPreview = registerCancellablePreview('canvas:replacement-cancel', () => { previewCancelled = true; });
    const blurCommit = awaitInteraction(fonts, editorController.signal, 100).then(() => { committed = true; }).catch(() => undefined);
    cancelActiveInteractions();
    finishFonts();
    await blurCommit;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(cancelCount, 1);
    assert.equal(committed, false);
    assert.equal(previewCancelled, true);
    unregisterPreview();
  });

  await check('U12 invalid and unavailable startup stay paused until explicit Save succeeds', () => {
    const clock = new FakeClock(); const invalidStorage = new MemoryStorage(); invalidStorage.value = '{broken';
    const initial = createEmptyDiagramDocument('Safe workspace');
    const invalid = new PersistenceCoordinator({ adapter: invalidStorage, debounceMs: 5, maxWaitMs: 20, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    assert.equal(invalid.hydrate(initial).status, 'invalid');
    const afterEdit = { ...initial, metadata: { ...initial.metadata, title: 'Edited safely' } };
    invalid.observe(afterEdit, 1, 0, true); clock.advance(30);
    assert.equal(invalidStorage.writes, 0); assert.equal(invalid.getStatus().state, 'paused');
    assert.equal(invalid.saveExplicit(afterEdit)?.ok, true);
    assert.equal(JSON.parse(invalidStorage.value!).metadata.title, 'Edited safely');
    invalid.dispose();
    assert.equal(invalidStorage.writes, 1);

    const unavailableStorage = new MemoryStorage(); unavailableStorage.failReads = true;
    const unavailable = new PersistenceCoordinator({ adapter: unavailableStorage, debounceMs: 5, maxWaitMs: 20, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    assert.equal(unavailable.hydrate(initial).status, 'unavailable');
    unavailable.observe(afterEdit, 1, 0, true); clock.advance(30);
    assert.equal(unavailableStorage.writes, 0); assert.equal(unavailable.getStatus().state, 'paused');
    assert.equal(unavailable.saveExplicit(afterEdit)?.ok, true);
    assert.equal(JSON.parse(unavailableStorage.value!).metadata.title, 'Edited safely');
    unavailable.dispose();
    assert.equal(unavailableStorage.writes, 1);
  });

  await check('U10 replacement followed by Undo cancels old timers and keeps the current canonical storage value', () => {
    const clock = new FakeClock(); const storage = new MemoryStorage();
    const initial = createEmptyDiagramDocument('Stored A'); storage.value = JSON.stringify(initial);
    const persistence = new PersistenceCoordinator({ adapter: storage, debounceMs: 10, maxWaitMs: 30, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    persistence.hydrate(initial);
    const engine = new CommandEngine(initial); let epoch = 0;
    engine.subscribe((doc, event) => {
      if (event.kind === 'replacement' || event.operation === 'undo' || event.operation === 'redo') epoch++;
      persistence.observe(doc, event.revision, epoch, true);
    });
    const replacement = createEmptyDiagramDocument('Replacement B');
    assert.equal(engine.dispatch(new SetDiagramDocumentCommand(initial, replacement, 'Import')), true);
    clock.advance(5);
    assert.equal(engine.undo(), true);
    clock.advance(40);
    assert.equal(storage.writes, 0);
    assert.equal(JSON.parse(storage.value!).metadata.title, 'Stored A');
    assert.equal(persistence.getStatus().state, 'clean');
    persistence.dispose();
  });

  await check('U11 a cancelled generation operation does not cancel a valid dirty autosave', () => {
    const clock = new FakeClock(); const storage = new MemoryStorage();
    const initial = createEmptyDiagramDocument('Before');
    const persistence = new PersistenceCoordinator({ adapter: storage, debounceMs: 10, maxWaitMs: 30, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    persistence.hydrate(initial);
    const committed = { ...initial, metadata: { ...initial.metadata, title: 'Committed edit' } };
    persistence.observe(committed, 1, 0, true);
    const operations = new OperationCoordinator(); operations.begin(1, 0); operations.invalidate();
    clock.advance(10);
    assert.equal(storage.writes, 1);
    assert.equal(JSON.parse(storage.value!).metadata.title, 'Committed edit');
    persistence.dispose();
  });

  await check('U13/U14 max-wait flush and page-hidden flush use the newest committed snapshot once', () => {
    const clock = new FakeClock(); const storage = new MemoryStorage();
    const initial = createEmptyDiagramDocument('Initial');
    const persistence = new PersistenceCoordinator({ adapter: storage, debounceMs: 10, maxWaitMs: 25, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    persistence.hydrate(initial);
    for (let index = 1; index <= 3; index++) {
      const latest = { ...initial, metadata: { ...initial.metadata, title: `Commit ${index}` } };
      persistence.observe(latest, index, 0, true);
      if (index < 3) clock.advance(8);
    }
    clock.advance(9);
    assert.equal(storage.writes, 1);
    assert.equal(JSON.parse(storage.value!).metadata.title, 'Commit 3');
    const hiddenEdit = { ...initial, metadata: { ...initial.metadata, title: 'Page hidden latest' } };
    persistence.observe(hiddenEdit, 4, 0, true); persistence.onVisibilityHidden();
    assert.equal(storage.writes, 2);
    assert.equal(JSON.parse(storage.value!).metadata.title, 'Page hidden latest');
    persistence.dispose();
  });

  await check('U15 valid Load cancels a dirty timer and establishes the value read at Load time', () => {
    const clock = new FakeClock(); const storage = new MemoryStorage();
    const initial = createEmptyDiagramDocument('Saved A'); storage.value = JSON.stringify(initial);
    const persistence = new PersistenceCoordinator({ adapter: storage, debounceMs: 10, maxWaitMs: 30, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    persistence.hydrate(initial);
    const dirty = { ...initial, metadata: { ...initial.metadata, title: 'Unsaved A edit' } };
    persistence.observe(dirty, 1, 0, true);
    const loaded = createEmptyDiagramDocument('Saved B'); storage.value = JSON.stringify(loaded);
    persistence.acceptLoadedDocument(loaded);
    clock.advance(40);
    assert.equal(storage.writes, 0);
    assert.equal(storage.value, JSON.stringify(loaded));
    assert.equal(persistence.getStatus().state, 'clean');
    persistence.dispose();
  });

  process.stdout.write(`Workspace experience harness: ${passed}/14 groups passed.\n`);
}

void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
