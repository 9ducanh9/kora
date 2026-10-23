import { DiagramExportError, EXPORT_LIMITS, throwIfAborted } from './limits';
import { SvgExportResult } from './svg';

export interface PngExportOptions {
  scale?: 1 | 2;
  background?: string | 'transparent';
  signal?: AbortSignal;
}

function abortReason(signal?: AbortSignal): unknown {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException('Export cancelled.', 'AbortError');
}

function decodeImage(image: HTMLImageElement, url: string, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish(abortReason(signal));
    image.onload = () => finish();
    image.onerror = () => finish(new DiagramExportError('PNG_DECODE_FAILED', 'The generated SVG could not be decoded for PNG export.'));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else image.src = url;
  });
}

function encodeCanvas(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const finish = (error?: unknown, blob?: Blob) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else if (blob) resolve(blob);
      else reject(new DiagramExportError('PNG_ENCODE_FAILED', 'The browser returned an empty PNG file.'));
    };
    const onAbort = () => finish(abortReason(signal));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    try {
      canvas.toBlob(blob => finish(undefined, blob ?? undefined), 'image/png');
    } catch {
      finish(new DiagramExportError('PNG_ENCODE_FAILED', 'The browser could not encode the PNG file.'));
    }
  });
}

export async function rasterizeDiagramPng(svg: SvgExportResult, options: PngExportOptions = {}): Promise<Blob> {
  throwIfAborted(options.signal);
  const scale = options.scale ?? 2;
  const width = Math.ceil(svg.bounds.width * scale); const height = Math.ceil(svg.bounds.height * scale);
  if (width > EXPORT_LIMITS.maxPngSide || height > EXPORT_LIMITS.maxPngSide || width * height > EXPORT_LIMITS.maxPngPixels) {
    throw new DiagramExportError('PNG_DIMENSION_LIMIT', 'PNG exceeds V1 pixel limits. Try 1× or choose SVG export.');
  }
  if (typeof document === 'undefined' || typeof Image === 'undefined') throw new DiagramExportError('PNG_UNAVAILABLE', 'PNG export requires a browser canvas.');
  const url = URL.createObjectURL(svg.blob);
  const image = new Image();
  const canvas = document.createElement('canvas');
  try {
    await decodeImage(image, url, options.signal);
    throwIfAborted(options.signal);
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new DiagramExportError('PNG_CANVAS_FAILED', 'The browser could not create an export canvas.');
    if (options.background && options.background !== 'transparent') {
      context.fillStyle = options.background;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    throwIfAborted(options.signal);
    const blob = await encodeCanvas(canvas, options.signal);
    throwIfAborted(options.signal);
    if (blob.size === 0) throw new DiagramExportError('PNG_ENCODE_FAILED', 'The browser returned an empty PNG file.');
    return blob;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') throw new DiagramExportError('PNG_SECURITY', 'The browser blocked access to the export canvas.');
    throw error;
  } finally {
    image.onload = null; image.onerror = null; image.src = '';
    canvas.width = 0; canvas.height = 0;
    URL.revokeObjectURL(url);
  }
}
