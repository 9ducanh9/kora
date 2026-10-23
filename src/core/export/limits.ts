export const EXPORT_LIMITS = {
  maxEntities: 5_000,
  maxRoutePoints: 100_000,
  maxPointsPerConnection: 10_000,
  maxTextFieldCodeUnits: 10_000,
  maxTotalTextCodeUnits: 200_000,
  maxRenderInputBytes: 10 * 1024 * 1024,
  maxSvgBytes: 25 * 1024 * 1024,
  maxPngSide: 8_192,
  maxPngPixels: 16_000_000,
  maxAssetBytes: 4 * 1024 * 1024,
  timeoutMs: 30_000
} as const;

export type ExportFormat = 'svg' | 'png';
export type ExportTheme = 'light' | 'dark';

export class DiagramExportError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'DiagramExportError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('Export cancelled.', 'AbortError');
}

export async function withExportDeadline<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(signal?.reason ?? new DOMException('Export cancelled.', 'AbortError'));
  signal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DiagramExportError('TIMEOUT', 'Export timed out after 30 seconds.')), EXPORT_LIMITS.timeoutMs);
  try {
    if (signal?.aborted) onParentAbort();
    return await work(controller.signal);
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);
  }
}
