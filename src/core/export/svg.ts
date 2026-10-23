import { DiagramDocument, Point, Rect } from '../diagram/types';
import { validateDiagramDocument } from '../diagram/validator';
import { IRNode, KoraArchitectureModel } from '../ir/types';
import { resolveAsset, resolveNodeDisplay } from '../assets/registry';
import { getContainerVisualConfig } from '../containers/registry';
import { resolveConnectionAnchor } from '../layout/anchors';
import { cachedRouteForRender, createRouteInputSignature } from '../layout/routeCache';
import { measureVisuals, measureVisualsFromCurrentBrowser, measureVisualsInBrowser, VisualMetricsSnapshot } from '../layout/visualMetrics';
import { resolveConnectionGeometry } from '../layout/connectionGeometry';
import { createTextMeasureContext, resolveTextLayout, TextLayout } from '../layout/textLayout';
import { DiagramBounds, diagramBounds, preflightDiagram } from './preflight';
import { DiagramExportError, EXPORT_LIMITS, ExportTheme, throwIfAborted, withExportDeadline } from './limits';
import { fetchFontBase64, fetchLocalSvgAsset, inlineSvg } from './resources';

export interface SvgExportOptions {
  theme?: ExportTheme;
  background?: 'theme' | 'transparent';
  signal?: AbortSignal;
}

export interface SvgExportResult {
  blob: Blob;
  bounds: DiagramBounds;
  entities: number;
  byteLength: number;
}

interface Paint {
  canvas: string; surface: string; text: string; secondary: string; muted: string;
  connector: string; border: string;
  container: Record<string, { border: string; text: string; fill: string; dash?: string }>;
}

const PAINT: Record<ExportTheme, Paint> = {
  light: {
    canvas: '#f6f8fa', surface: '#ffffff', text: '#1f2328', secondary: '#656d76', muted: '#8c959f', connector: '#545b64', border: '#d0d7de',
    container: {
      cloud: { border: '#242f3e', text: '#242f3e', fill: '#ffffff', }, region: { border: '#00a4a6', text: '#008183', fill: '#eaf7f7', dash: '6 4' },
      vpc: { border: '#8c4fff', text: '#7025fb', fill: '#f5f0ff' }, 'availability-zone': { border: '#ed7100', text: '#c45d00', fill: '#fff6eb', dash: '6 4' },
      'subnet-public': { border: '#7aa116', text: '#5e7d0e', fill: '#f5f8eb' }, 'subnet-private': { border: '#00a4a6', text: '#008183', fill: '#eaf7f7' },
      'auto-scaling-group': { border: '#ed7100', text: '#c45d00', fill: '#fff6eb', dash: '6 4' }, 'corporate-data-center': { border: '#7d8998', text: '#545b64', fill: '#f1f3f5' },
      'security-group': { border: '#8c959f', text: '#57606a', fill: '#f5f6f7', dash: '6 4' }, 'generic-group': { border: '#8c959f', text: '#57606a', fill: '#f5f6f7', dash: '6 4' }
    }
  },
  dark: {
    canvas: '#090d12', surface: '#161b22', text: '#f0f6fc', secondary: '#8b949e', muted: '#6e7681', connector: '#8b949e', border: '#30363d',
    container: {
      cloud: { border: '#545b64', text: '#f0f6fc', fill: '#090d12' }, region: { border: '#00a4a6', text: '#38d3d5', fill: '#102426', dash: '6 4' },
      vpc: { border: '#a371f7', text: '#b388ff', fill: '#201931' }, 'availability-zone': { border: '#ed7100', text: '#ff9900', fill: '#281d12', dash: '6 4' },
      'subnet-public': { border: '#7aa116', text: '#8bc34a', fill: '#202514' }, 'subnet-private': { border: '#00a4a6', text: '#38d3d5', fill: '#102426' },
      'auto-scaling-group': { border: '#ed7100', text: '#ff9900', fill: '#281d12', dash: '6 4' }, 'corporate-data-center': { border: '#8b949e', text: '#c9d1d9', fill: '#1a2028' },
      'security-group': { border: '#6e7681', text: '#8b949e', fill: '#151a20', dash: '6 4' }, 'generic-group': { border: '#6e7681', text: '#8b949e', fill: '#151a20', dash: '6 4' }
    }
  }
};

function esc(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function modelFromDocument(doc: DiagramDocument): KoraArchitectureModel {
  return { version: '1.0', scope: doc.semantic.scope, nodes: Object.values(doc.semantic.nodes), connections: Object.values(doc.semantic.connections), containers: Object.values(doc.semantic.containers) };
}

function textLines(layout: TextLayout, x: number, y: number, fontSize: number, weight: number, fill: string): string {
  if (!layout.runs.length) return '';
  return `<text text-anchor="start" dominant-baseline="middle" font-family="Kora Geist,Arial,sans-serif" font-size="${fontSize}" font-weight="${weight}" letter-spacing="${layout.letterSpacing}" fill="${fill}">${layout.runs.map(run => `<tspan x="${x + run.x}" y="${y + run.y}">${esc(run.text)}</tspan>`).join('')}</text>`;
}

function effectiveRoute(
  doc: DiagramDocument,
  id: string,
  signature: string,
  metrics: VisualMetricsSnapshot
) {
  const connection = doc.semantic.connections[id];
  return cachedRouteForRender(doc, id, doc.presentation.connections?.[id]?.route, signature, connection?.label, metrics);
}

async function waitForDocumentFonts(signal?: AbortSignal): Promise<void> {
  const ready = typeof document !== 'undefined' ? document.fonts?.ready : undefined;
  if (!ready) return;
  if (!signal) return ready.then(() => undefined);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish(signal.reason ?? new DOMException('Export cancelled.', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else ready.then(() => finish(), error => finish(error));
  });
}

function getAssetPaths(doc: DiagramDocument): string[] {
  const paths = new Set<string>();
  for (const node of Object.values(doc.semantic.nodes)) paths.add(resolveAsset(node.assetId || node.label).assetPath);
  for (const container of Object.values(doc.semantic.containers)) {
    const badge = getContainerVisualConfig(container.type).badgePath;
    if (badge) paths.add(badge);
  }
  return [...paths].sort();
}

async function loadAssetMap(paths: string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const assets = new Map<string, string>();
  let totalBytes = 0;
  for (let offset = 0; offset < paths.length; offset += 4) {
    throwIfAborted(signal);
    const batch = paths.slice(offset, offset + 4);
    const loaded = await Promise.all(batch.map(async path => [path, await fetchLocalSvgAsset(path, signal)] as const));
    for (const [path, content] of loaded) {
      totalBytes += new TextEncoder().encode(content).byteLength;
      if (totalBytes > EXPORT_LIMITS.maxSvgBytes) throw new DiagramExportError('ASSET_TOTAL_LIMIT', 'Diagram icons exceed the SVG resource budget.');
      assets.set(path, content);
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return assets;
}

function containerDepth(doc: DiagramDocument, id: string): number {
  let depth = 0; let parent = doc.semantic.containers[id]?.parentId; const seen = new Set<string>([id]);
  while (parent && !seen.has(parent)) { seen.add(parent); depth++; parent = doc.semantic.containers[parent]?.parentId; }
  return depth;
}

async function renderDiagramSvgWithSignal(rawDocument: unknown, options: SvgExportOptions = {}): Promise<SvgExportResult> {
  const validated = validateDiagramDocument(rawDocument);
  if (!validated.ok) throw new DiagramExportError('DOCUMENT_INVALID', 'The current diagram is invalid and cannot be exported.');
  const doc = validated.value;
  preflightDiagram(doc);
  throwIfAborted(options.signal);

  if (typeof document !== 'undefined') {
    try { await waitForDocumentFonts(options.signal); }
    catch (error) {
      if (options.signal?.aborted) throwIfAborted(options.signal);
      throw new DiagramExportError('FONT_LOAD_FAILED', 'The local diagram fonts could not be prepared for export.');
    }
    throwIfAborted(options.signal);
    if (document.fonts && !document.fonts.check('12px "Kora Geist"')) throw new DiagramExportError('FONT_LOAD_FAILED', 'Kora Geist did not load for diagram rendering.');
  }

  const model = modelFromDocument(doc);
  const metrics = typeof document === 'undefined' ? measureVisuals(model) : measureVisualsFromCurrentBrowser(model);
  const textContext = createTextMeasureContext(metrics.profile.fontFamily);
  const nodeBoxes = Object.fromEntries(Object.entries(doc.presentation.nodes).map(([id, presentation]) => {
    const measured = metrics.nodes[id];
    return [id, {
      x: presentation.x,
      y: presentation.y,
      width: Math.max(presentation.width ?? 0, measured?.width ?? 96),
      height: Math.max(presentation.height ?? 0, measured?.height ?? 79)
    }];
  }));
  const signature = await createRouteInputSignature(model, nodeBoxes, doc.presentation.containers, doc.presentation.connections ?? {}, metrics);
  throwIfAborted(options.signal);

  const paint = PAINT[options.theme ?? 'dark'];
  const assets = await loadAssetMap(getAssetPaths(doc), options.signal);
  const [latinFont, extendedFont] = await Promise.all([
    fetchFontBase64('/fonts/geist-latin.woff2', options.signal),
    fetchFontBase64('/fonts/geist-latin-ext.woff2', options.signal)
  ]);
  throwIfAborted(options.signal);

  const rects: Rect[] = [...Object.values(nodeBoxes), ...Object.values(doc.presentation.containers)];
  const paths: Point[][] = [];
  const renderedEdges = Object.values(doc.semantic.connections).map(connection => {
    const sourceBox = nodeBoxes[connection.source]; const targetBox = nodeBoxes[connection.target];
    if (!sourceBox || !targetBox) throw new DiagramExportError('CONNECTION_ENDPOINT_MISSING', 'A connection endpoint has no export geometry.');
    const presentation = doc.presentation.connections?.[connection.id] ?? {};
    const route = effectiveRoute(doc, connection.id, signature, metrics);
    const geometry = resolveConnectionGeometry({
      source: resolveConnectionAnchor(sourceBox, presentation.sourceSide ?? 'right', 'source'),
      target: resolveConnectionAnchor(targetBox, presentation.targetSide ?? 'left', 'target'),
      sourceSide: presentation.sourceSide ?? 'right', targetSide: presentation.targetSide ?? 'left',
      sourceId: connection.source, targetId: connection.target, route
    });
    const measured = metrics.connections[connection.id] ?? { width: 32, height: 23, lines: 1 };
    const labelRect = connection.label?.trim()
      ? route?.label ?? { x: geometry.labelX - measured.width / 2, y: geometry.labelY - measured.height / 2, width: measured.width, height: measured.height }
      : undefined;
    if (labelRect) rects.push(labelRect);
    paths.push(geometry.points);
    return { connection, geometry, labelRect };
  });
  const bounds = diagramBounds(rects, paths);

  const containers = Object.entries(doc.semantic.containers)
    .filter(([id]) => doc.presentation.containers[id])
    .sort(([a], [b]) => containerDepth(doc, a) - containerDepth(doc, b) || a.localeCompare(b))
    .map(([id, container]) => {
      const box = doc.presentation.containers[id]; const config = getContainerVisualConfig(container.type); const style = paint.container[container.type] ?? paint.container['generic-group'];
      const title = container.label || config.defaultLabel;
      const titleX = box.x + 10 + (config.badgeSize ? config.badgeSize + 6 : 0);
      const titleWidth = Math.max(32, Math.min(240, box.width - (titleX - box.x) - 14));
      const titleLayout = resolveTextLayout(title, { maxWidth: titleWidth, fontFamily: metrics.profile.fontFamily, fontSize: config.fontSize, fontWeight: config.fontWeight, lineHeight: config.fontSize * 1.2, letterSpacing: container.type === 'cloud' ? metrics.profile.containerLetterSpacing : 0, align: 'start' }, textContext);
      const headerY = box.y + 8 + Math.max(config.badgeSize, titleLayout.lines.length * config.fontSize * 1.2) / 2;
      const badge = config.badgePath ? inlineSvg(assets.get(config.badgePath)!, box.x + 10, box.y + 8, config.badgeSize, config.badgeSize, `container-${id}`) : '';
      return `<g data-entity-id="${esc(id)}" data-entity-kind="container"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="6" fill="${style.fill}" fill-opacity="${container.type === 'cloud' ? 0 : 1}" stroke="${style.border}" stroke-width="1.5"${style.dash ? ` stroke-dasharray="${style.dash}"` : ''}/>${badge}${textLines(titleLayout, titleX, headerY, config.fontSize, config.fontWeight, style.text)}</g>`;
    }).join('');

  const edges = renderedEdges.map(({ connection, geometry, labelRect }) => {
    const label = connection.label ?? '';
    let labelMarkup = '';
    if (labelRect && label.trim()) {
      const layout = resolveTextLayout(label, { maxWidth: Math.max(1, Math.min(metrics.profile.labelMaxWidth, labelRect.width - 14)), fontFamily: metrics.profile.fontFamily, fontSize: 11, fontWeight: 500, lineHeight: metrics.profile.labelLineHeight, letterSpacing: metrics.profile.labelLetterSpacing }, textContext);
      const centerX = labelRect.x + labelRect.width / 2; const centerY = labelRect.y + labelRect.height / 2;
      labelMarkup = `<g class="edge-label"><rect x="${labelRect.x}" y="${labelRect.y}" width="${labelRect.width}" height="${labelRect.height}" rx="4" fill="${paint.surface}" stroke="${paint.border}"/>${textLines(layout, centerX, centerY, 11, 500, paint.text)}</g>`;
    }
    return `<g data-entity-id="${esc(connection.id)}" data-entity-kind="connection"><path d="${geometry.path}" fill="none" stroke="${paint.connector}" stroke-width="2" marker-end="url(#kora-arrow)"/>${labelMarkup}</g>`;
  }).join('');

  const nodes = Object.entries(doc.semantic.nodes).map(([id, node]) => {
    const box = nodeBoxes[id]; const display = resolveNodeDisplay(node.label, node.subtitle, node.assetId);
    const asset = resolveAsset(node.assetId || node.label); const iconX = box.x + (box.width - 48) / 2; const iconY = box.y + 6;
    const icon = inlineSvg(assets.get(asset.assetPath)!, iconX, iconY, 48, 48, `node-${id}`);
    const isExternal = asset.category === 'external' || asset.category === 'generic' || node.kind === 'external' || node.kind === 'actor';
    const labelWidth = Math.max(1, box.width - 12);
    const label = resolveTextLayout(display.primaryLabel, { maxWidth: labelWidth, fontFamily: metrics.profile.fontFamily, fontSize: 11, fontWeight: 600, lineHeight: metrics.profile.nodeLineHeight, letterSpacing: metrics.profile.nodeLetterSpacing }, textContext);
    const subtitle = resolveTextLayout(display.subtitle ?? '', { maxWidth: labelWidth, fontFamily: metrics.profile.fontFamily, fontSize: 9.5, fontWeight: 500, lineHeight: metrics.profile.subtitleLineHeight, letterSpacing: metrics.profile.subtitleLetterSpacing }, textContext);
    const labelCenterY = iconY + 48 + 4 + (label.runs.length - 1) * metrics.profile.nodeLineHeight / 2;
    const labelMarkup = textLines(label, box.x + box.width / 2, labelCenterY, 11, 600, paint.text);
    const subtitleCenterY = subtitle.runs.length
      ? labelCenterY + (label.runs.length - 1) * metrics.profile.nodeLineHeight / 2 + 2 + metrics.profile.subtitleLineHeight / 2 + (subtitle.runs.length - 1) * metrics.profile.subtitleLineHeight / 2
      : labelCenterY;
    const subtitleMarkup = textLines(subtitle, box.x + box.width / 2, subtitleCenterY, 9.5, 500, paint.secondary);
    const externalFrame = isExternal ? `<rect x="${iconX}" y="${iconY}" width="48" height="48" rx="8" fill="${paint.surface}" fill-opacity="0.45" stroke="${paint.muted}" stroke-opacity="0.5" stroke-dasharray="4 3"/>` : '';
    return `<g data-entity-id="${esc(id)}" data-entity-kind="node">${externalFrame}${icon}${labelMarkup}${subtitleMarkup}</g>`;
  }).join('');

  const background = options.background === 'transparent' ? '' : `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${paint.canvas}"/>`;
  const title = doc.metadata.title ? `<title>${esc(doc.metadata.title)}</title>` : '';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.ceil(bounds.width)}" height="${Math.ceil(bounds.height)}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" role="img">${title}<defs><marker id="kora-arrow" markerWidth="12" markerHeight="12" refX="10" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L10 5 L0 10 Z" fill="${paint.connector}"/></marker></defs><style>@font-face{font-family:'Kora Geist';src:url(data:font/woff2;base64,${latinFont}) format('woff2');font-weight:100 900;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}@font-face{font-family:'Kora Geist';src:url(data:font/woff2;base64,${extendedFont}) format('woff2');font-weight:100 900;unicode-range:U+0100-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF}</style>${background}${containers}${edges}${nodes}</svg>`;
  const bytes = new TextEncoder().encode(svg);
  if (bytes.byteLength > EXPORT_LIMITS.maxSvgBytes) throw new DiagramExportError('SVG_SIZE_LIMIT', 'SVG output exceeds 25 MiB. Choose a smaller diagram or export JSON.');
  throwIfAborted(options.signal);
  return { blob: new Blob([bytes], { type: 'image/svg+xml;charset=utf-8' }), bounds, entities: Object.keys(doc.semantic.nodes).length + Object.keys(doc.semantic.containers).length + Object.keys(doc.semantic.connections).length, byteLength: bytes.byteLength };
}

export function renderDiagramSvg(rawDocument: unknown, options: SvgExportOptions = {}): Promise<SvgExportResult> {
  return withExportDeadline(options.signal, signal => renderDiagramSvgWithSignal(rawDocument, { ...options, signal }));
}
