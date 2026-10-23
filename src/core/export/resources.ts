import { EXPORT_LIMITS, DiagramExportError, throwIfAborted } from './limits';

export async function fetchLocalSvgAsset(path: string, signal?: AbortSignal): Promise<string> {
  if (!path.startsWith('/assets/') || path.includes('..')) throw new DiagramExportError('ASSET_PATH_INVALID', 'A diagram icon uses an unsupported asset path.');
  throwIfAborted(signal);
  const response = await fetch(path, { signal, cache: 'force-cache' });
  if (!response.ok) throw new DiagramExportError('ASSET_LOAD_FAILED', 'A required diagram icon could not be loaded.');
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('image/svg+xml')) throw new DiagramExportError('ASSET_TYPE_INVALID', 'A required diagram icon is not SVG.');
  const source = await response.text();
  if (new TextEncoder().encode(source).byteLength > EXPORT_LIMITS.maxAssetBytes) throw new DiagramExportError('ASSET_LIMIT', 'A diagram icon exceeds the asset size limit.');
  if (/<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:|javascript:)|url\(\s*["']?\s*(?:https?:|\/\/|javascript:)/iu.test(source)) {
    throw new DiagramExportError('ASSET_UNSAFE', 'A diagram icon contains unsupported external or active content.');
  }
  return source;
}

export async function fetchFontBase64(path: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const response = await fetch(path, { signal, cache: 'force-cache' });
  if (!response.ok) throw new DiagramExportError('FONT_LOAD_FAILED', 'A required local diagram font could not be loaded.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > EXPORT_LIMITS.maxAssetBytes) throw new DiagramExportError('FONT_LIMIT', 'A local diagram font has an invalid size.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return btoa(binary);
}

export function inlineSvg(source: string, x: number, y: number, width: number, height: number, prefix: string): string {
  const root = source.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg\s*>/iu);
  if (!root) throw new DiagramExportError('ASSET_INVALID', 'A diagram icon could not be decoded.');
  const viewBox = root[1].match(/\bviewBox\s*=\s*(["'])(.*?)\1/iu)?.[2];
  if (!viewBox) throw new DiagramExportError('ASSET_INVALID', 'A diagram icon has no viewBox.');
  const idMap = new Map<string, string>();
  let body = root[2].replace(/\bid\s*=\s*(["'])(.*?)\1/giu, (_match, quote: string, id: string) => {
    const replacement = `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/gu, '-')}`;
    idMap.set(id, replacement);
    return `id=${quote}${replacement}${quote}`;
  });
  for (const [id, replacement] of idMap) {
    body = body.replace(new RegExp(`#${escapeRegExp(id)}(?![a-zA-Z0-9_-])`, 'gu'), `#${replacement}`);
    body = body.replace(new RegExp(`(aria-labelledby=["'][^"']*)\\b${escapeRegExp(id)}\\b`, 'gu'), `$1${replacement}`);
  }
  return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${escapeXml(viewBox)}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
