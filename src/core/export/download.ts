import { safeExportFilename } from './filename';
import { DiagramExportError } from './limits';

export function startDiagramDownload(blob: Blob, title: string, extension: 'json' | 'svg' | 'png'): void {
  if (typeof window === 'undefined') throw new DiagramExportError('DOWNLOAD_UNAVAILABLE', 'A browser download cannot start in this environment.');
  const url = URL.createObjectURL(blob);
  try {
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = safeExportFilename(title, extension);
    anchor.style.display = 'none';
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
