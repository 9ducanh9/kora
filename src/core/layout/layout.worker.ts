import { computeCompoundLayoutDetailed, LayoutOptions } from './elkCompoundLayout';
import { KoraArchitectureModel } from '../ir/types';

interface RequestMessage { id: number; model: KoraArchitectureModel; options: LayoutOptions }
const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null;
  postMessage: (message: unknown) => void;
};

workerScope.onmessage = async event => {
  const { id, model, options } = event.data;
  try {
    const result = await computeCompoundLayoutDetailed(model, {
      ...options,
      onProgress: stage => workerScope.postMessage({ id, progress: stage })
    });
    workerScope.postMessage({ id, result });
  } catch (error) {
    workerScope.postMessage({ id, error: error instanceof Error ? error.message : 'Layout worker failed.' });
  }
};
