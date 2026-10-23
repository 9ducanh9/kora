import assert from 'node:assert/strict';
import { LayoutResult } from '../src/core/layout/elkCompoundLayout';
import { computeBestCompoundLayoutInWorker, computeCompoundLayoutInWorker, cancelActiveLayoutJobs } from '../src/core/layout/layoutWorkerClient';
import { createEmptyDiagramDocument } from '../src/core/diagram/types';
import { measureVisuals } from '../src/core/layout/visualMetrics';
import { KoraArchitectureModel } from '../src/core/ir/types';

type Listener = (event: { data?: unknown; message?: string }) => void;

class MockWorker {
  static last: MockWorker | undefined;
  static created: MockWorker[] = [];
  readonly listeners = new Map<string, Set<Listener>>();
  request: { id: number; options?: { candidate?: string } } | undefined;
  terminated = false;

  constructor(_url: URL, _options?: WorkerOptions) {
    MockWorker.last = this;
    MockWorker.created.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener); this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: Listener) { this.listeners.get(type)?.delete(listener); }
  postMessage(message: { id: number; options?: { candidate?: string } }) { this.request = message; }
  terminate() { this.terminated = true; }
  emit(type: string, event: { data?: unknown; message?: string } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function resultFor(model: KoraArchitectureModel, profile: 'base' | 'spacious', blocking = false): LayoutResult {
  return {
    document: createEmptyDiagramDocument(`Worker ${profile}`),
    metrics: measureVisuals(model),
    findings: blocking ? [{ code: 'TEST_BLOCKING', severity: 'blocking', entityIds: ['fixture'] }] : [],
    profile
  };
}

function message(worker: MockWorker, result: LayoutResult, progress?: 'layout' | 'routing' | 'audit') {
  worker.emit('message', { data: { id: worker.request!.id, result, progress } });
}

async function run() {
  const originalWorker = globalThis.Worker;
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: MockWorker });
  const model: KoraArchitectureModel = { version: '1.0', nodes: [], containers: [], connections: [] };
  const metrics = measureVisuals(model);
  try {
    console.log('=== LAYOUT WORKER LIFECYCLE REGRESSION ===');

    let progress = '';
    const expected = resultFor(model, 'base');
    const successful = computeCompoundLayoutInWorker(model, { metrics, timeoutMs: 1000, onProgress: stage => { progress = stage; } });
    const successWorker = MockWorker.last!;
    assert(Boolean(successWorker.request) && successWorker.request?.options?.candidate === undefined, 'worker branch posts a serialized request instead of computing on the caller thread');
    successWorker.emit('message', { data: { id: successWorker.request!.id, progress: 'routing' } });
    message(successWorker, expected, 'audit');
    assert(await successful === expected, 'worker result resolves to the caller and progress messages are delivered');
    assert(progress === 'audit' && successWorker.terminated, 'successful completion reports final progress and terminates its worker');

    const abort = new AbortController();
    const cancelled = computeCompoundLayoutInWorker(model, { metrics, signal: abort.signal, timeoutMs: 1000 });
    const cancelledWorker = MockWorker.last!;
    abort.abort();
    await assert.rejects(cancelled, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
    assert(cancelledWorker.terminated, 'explicit cancellation rejects and terminates the active worker');

    const superseded = computeCompoundLayoutInWorker(model, { metrics, timeoutMs: 1000 });
    const supersededWorker = MockWorker.last!;
    cancelActiveLayoutJobs('A newer editor gesture superseded this layout.');
    await assert.rejects(superseded, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
    assert(supersededWorker.terminated, 'a newer editor operation cancels all active layout workers');

    const timed = computeCompoundLayoutInWorker(model, { metrics, timeoutMs: 8 });
    const timedWorker = MockWorker.last!;
    await assert.rejects(timed, /Layout worker exceeded 8ms/);
    assert(timedWorker.terminated, 'deadline expiration terminates its worker and returns a bounded error');

    MockWorker.created = [];
    const best = computeBestCompoundLayoutInWorker(model, { metrics, timeoutMs: 1000 });
    const baseWorker = MockWorker.last!;
    message(baseWorker, resultFor(model, 'base', true));
    await new Promise(resolve => setTimeout(resolve, 0));
    const spaciousWorker = MockWorker.last!;
    assert(spaciousWorker !== baseWorker && spaciousWorker.request?.options?.candidate === 'spacious', 'a blocking base candidate starts only the bounded spacious retry');
    const spaciousResult = resultFor(model, 'spacious');
    message(spaciousWorker, spaciousResult);
    const selected = await best;
    assert(selected === spaciousResult && MockWorker.created.length === 2, 'best-of-two scoring selects the cleaner candidate and never starts a third run');

    const errored = computeCompoundLayoutInWorker(model, { metrics, timeoutMs: 1000 });
    const errorWorker = MockWorker.last!;
    errorWorker.emit('error', { message: 'worker fixture error' });
    await assert.rejects(errored, /worker fixture error/);
    assert(errorWorker.terminated, 'worker errors reject cleanly and release the worker');
    console.log('All layout worker lifecycle checks passed.');
  } finally {
    cancelActiveLayoutJobs('Worker test cleanup.');
    Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: originalWorker });
  }
}

run().catch(error => { console.error(error); process.exit(1); });
