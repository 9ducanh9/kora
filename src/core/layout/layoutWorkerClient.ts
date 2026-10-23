import { KoraArchitectureModel } from '../ir/types';
import { LayoutOptions, LayoutResult, computeCompoundLayoutDetailed } from './elkCompoundLayout';
import { composeArchitecture } from './architectureComposition';
import { measureVisuals } from './visualMetrics';

interface WorkerRequestOptions extends LayoutOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface ActiveJob { worker: Worker; cancel: (reason?: string) => void }
let nextJobId = 1;
const activeJobs = new Set<ActiveJob>();

export function cancelActiveLayoutJobs(reason = 'Layout was superseded by a newer operation.'): void {
  for (const job of [...activeJobs]) job.cancel(reason);
}

export async function computeCompoundLayoutInWorker(model: KoraArchitectureModel, options: WorkerRequestOptions = {}): Promise<LayoutResult> {
  if (typeof Worker === 'undefined') return computeCompoundLayoutDetailed(model, options);
  if (options.signal?.aborted) throw new DOMException('Layout was cancelled.', 'AbortError');
  const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module', name: 'kora-layout' });
  const id = nextJobId++;
  const serializableOptions: LayoutOptions = {
    composition: options.composition,
    direction: options.direction,
    nodeSpacing: options.nodeSpacing,
    layerSpacing: options.layerSpacing,
    containerSpacing: options.containerSpacing,
    candidate: options.candidate,
    connectionPresentations: options.connectionPresentations,
    metrics: options.metrics
  };
  return new Promise<LayoutResult>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error(`Layout worker exceeded ${options.timeoutMs ?? 10000}ms.`)), options.timeoutMs ?? 10000);
    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
      activeJobs.delete(job);
    };
    const finish = (error?: Error, result?: LayoutResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else if (result) resolve(result); else reject(new Error('Layout worker returned no result.'));
    };
    const onAbort = () => finish(new DOMException('Layout was cancelled.', 'AbortError'));
    const onMessage = (event: MessageEvent<{ id: number; progress?: 'layout' | 'routing' | 'audit'; result?: LayoutResult; error?: string }>) => {
      if (event.data.id !== id) return;
      if (event.data.progress) options.onProgress?.(event.data.progress);
      if (event.data.error) finish(new Error(event.data.error));
      if (event.data.result) finish(undefined, event.data.result);
    };
    const onError = (event: ErrorEvent) => finish(new Error(event.message || 'Layout worker could not run.'));
    const job: ActiveJob = { worker, cancel: reason => finish(new DOMException(reason ?? 'Layout was cancelled.', 'AbortError')) };
    activeJobs.add(job);
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try { worker.postMessage({ id, model, options: serializableOptions }); }
    catch (error) { finish(error instanceof Error ? error : new Error('Could not send layout job to worker.')); }
  });
}

export async function computeBestCompoundLayoutInWorker(model: KoraArchitectureModel, options: WorkerRequestOptions = {}): Promise<LayoutResult> {
  const startedAt = Date.now();
  const deadline = startedAt + (options.timeoutMs ?? 10000);
  const composition = options.composition ?? (composeArchitecture(model, options.metrics ?? measureVisuals(model)) ? 'architecture' : 'layered');
  const base = await computeCompoundLayoutInWorker(model, { ...options, composition, candidate: 'base', timeoutMs: Math.max(1, deadline - Date.now()) });
  if (!base.findings.some(finding => finding.severity === 'blocking')) return base;
  const remaining = deadline - Date.now();
  if (remaining <= 0) return base;
  const spacious = await computeCompoundLayoutInWorker(model, { ...options, composition: composition === 'architecture' ? 'layered' : composition, candidate: 'spacious', timeoutMs: remaining });
  const score = (result: LayoutResult) => [
    result.findings.filter(finding => finding.severity === 'blocking').length,
    result.findings.length,
    result.profile === 'base' ? 0 : 1
  ];
  const baseScore = score(base); const spaciousScore = score(spacious);
  if (spaciousScore[0] < baseScore[0] || (spaciousScore[0] === baseScore[0] && (spaciousScore[1] < baseScore[1] || (spaciousScore[1] === baseScore[1] && spaciousScore[2] < baseScore[2])))) return spacious;
  return base;
}
