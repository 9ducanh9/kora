import { resolveNodeDisplay } from '../assets/registry';
import { getContainerVisualConfig } from '../containers/registry';
import { KoraArchitectureModel } from '../ir/types';
import { createTextMeasureContext, resolveTextLayout, TextLayout } from './textLayout';

export const VISUAL_PROFILE_VERSION = 'kora-visual-v2';

export interface BoxMetrics {
  width: number;
  height: number;
  lines: number;
}

export interface VisualMetricsSnapshot {
  profile: {
    version: string;
    source: 'browser-dom' | 'browser-canvas' | 'offline-estimate';
    fontFamily: string;
    nodeFont: string;
    subtitleFont: string;
    containerFonts: Record<string, string>;
    labelFont: string;
    nodePadding: number;
    iconSize: number;
    iconGap: number;
    nodeLineHeight: number;
    subtitleLineHeight: number;
    headerMaxWidth: number;
    headerLineHeight: number;
    labelMaxWidth: number;
    labelLineHeight: number;
    nodeLetterSpacing: number;
    subtitleLetterSpacing: number;
    containerLetterSpacing: number;
    labelLetterSpacing: number;
  };
  nodes: Record<string, BoxMetrics & { primary: string; subtitle?: string; primaryLines: number; subtitleLines: number; primaryLayout: TextLayout; subtitleLayout: TextLayout }>;
  containers: Record<string, BoxMetrics & { contentTop: number; titleLayout: TextLayout }>;
  connections: Record<string, BoxMetrics & { labelLayout: TextLayout }>;
}

const WIDTH_CANDIDATES = [96, 128, 160, 192];

function metricFonts(family: string) {
  return {
    node: `600 11px ${family}`,
    subtitle: `500 9.5px ${family}`,
    label: `500 11px ${family}`
  };
}

export function measureVisuals(model: KoraArchitectureModel, context?: CanvasRenderingContext2D, fontFamily = 'Arial, sans-serif'): VisualMetricsSnapshot {
  const fonts = metricFonts(fontFamily);
  const profile: VisualMetricsSnapshot['profile'] = {
    version: VISUAL_PROFILE_VERSION,
    source: context ? 'browser-canvas' : 'offline-estimate',
    fontFamily,
    nodeFont: fonts.node,
    subtitleFont: fonts.subtitle,
    containerFonts: {},
    labelFont: fonts.label,
    nodePadding: 6,
    iconSize: 48,
    iconGap: 4,
    nodeLineHeight: 13.75,
    subtitleLineHeight: 11.4,
    headerMaxWidth: 240,
    headerLineHeight: 16,
    labelMaxWidth: 200,
    labelLineHeight: 13,
    nodeLetterSpacing: 0,
    subtitleLetterSpacing: 0,
    containerLetterSpacing: 0.3,
    labelLetterSpacing: 0.2
  };
  const nodes: VisualMetricsSnapshot['nodes'] = {};
  for (const node of [...model.nodes].sort((a, b) => compareStable(a.id, b.id))) {
    const display = resolveNodeDisplay(node.label, node.subtitle, node.assetId);
    let chosenWidth = WIDTH_CANDIDATES[WIDTH_CANDIDATES.length - 1];
    let primaryLayout = resolveTextLayout(display.primaryLabel, { maxWidth: chosenWidth, fontFamily, fontSize: 11, fontWeight: 600, lineHeight: profile.nodeLineHeight, letterSpacing: profile.nodeLetterSpacing }, context);
    let subtitleLayout = resolveTextLayout(display.subtitle ?? '', { maxWidth: chosenWidth, fontFamily, fontSize: 9.5, fontWeight: 500, lineHeight: profile.subtitleLineHeight, letterSpacing: profile.subtitleLetterSpacing }, context);
    for (const width of WIDTH_CANDIDATES) {
      primaryLayout = resolveTextLayout(display.primaryLabel, { maxWidth: width - profile.nodePadding * 2, fontFamily, fontSize: 11, fontWeight: 600, lineHeight: profile.nodeLineHeight, letterSpacing: profile.nodeLetterSpacing }, context);
      subtitleLayout = resolveTextLayout(display.subtitle ?? '', { maxWidth: width - profile.nodePadding * 2, fontFamily, fontSize: 9.5, fontWeight: 500, lineHeight: profile.subtitleLineHeight, letterSpacing: profile.subtitleLetterSpacing }, context);
      chosenWidth = width;
      if (primaryLayout.lines.length <= 3 && subtitleLayout.lines.length <= 2) break;
    }
    const hasSubtitle = Boolean(display.subtitle?.trim());
    const primaryLines = primaryLayout.lines.length;
    const subtitleLines = subtitleLayout.lines.length;
    const height = profile.nodePadding * 2 + profile.iconSize + profile.iconGap + primaryLines * profile.nodeLineHeight + (hasSubtitle ? 2 + subtitleLines * profile.subtitleLineHeight : 0);
    nodes[node.id] = { width: chosenWidth, height: Math.ceil(height), lines: primaryLines + subtitleLines, primary: display.primaryLabel, subtitle: display.subtitle, primaryLines, subtitleLines, primaryLayout, subtitleLayout };
  }

  const containers: VisualMetricsSnapshot['containers'] = {};
  for (const container of [...model.containers].sort((a, b) => compareStable(a.id, b.id))) {
    const config = getContainerVisualConfig(container.type);
    const font = `${config.fontWeight} ${config.fontSize}px ${fontFamily}`;
    profile.containerFonts[container.id] = font;
    const titleLayout = resolveTextLayout(container.label || config.defaultLabel, { maxWidth: profile.headerMaxWidth, fontFamily, fontSize: config.fontSize, fontWeight: config.fontWeight, lineHeight: config.fontSize * 1.2, letterSpacing: container.type === 'cloud' ? profile.containerLetterSpacing : 0, align: 'start' }, context);
    const headerWidth = (config.badgeSize ? config.badgeSize + 8 : 0) + titleLayout.width + 20;
    const headerHeight = Math.max(config.badgeSize, titleLayout.lines.length * profile.headerLineHeight) + 16;
    const contentTop = Math.max(config.topPadding, headerHeight + 8);
    containers[container.id] = { width: Math.max(180, Math.ceil(headerWidth)), height: Math.max(100, Math.ceil(contentTop + config.bottomPadding)), lines: titleLayout.lines.length, contentTop, titleLayout };
  }

  const connections: VisualMetricsSnapshot['connections'] = {};
  for (const connection of [...model.connections].sort((a, b) => compareStable(a.id, b.id))) {
    const label = connection.label ?? '';
    if (!label.trim()) continue;
    const labelLayout = resolveTextLayout(label, { maxWidth: profile.labelMaxWidth, fontFamily, fontSize: 11, fontWeight: 500, lineHeight: profile.labelLineHeight, letterSpacing: profile.labelLetterSpacing }, context);
    connections[connection.id] = { width: Math.max(32, labelLayout.width + 14), height: labelLayout.lines.length * profile.labelLineHeight + 10, lines: labelLayout.lines.length, labelLayout };
  }
  return { profile, nodes, containers, connections };
}

export async function measureVisualsInBrowser(model: KoraArchitectureModel, options: { signal?: AbortSignal } = {}): Promise<VisualMetricsSnapshot> {
  if (options.signal?.aborted) throw new DOMException('Visual measurement was cancelled.', 'AbortError');
  if (typeof document === 'undefined') return measureVisuals(model);
  try {
    if (document.fonts?.ready) {
      await new Promise<void>((resolve, reject) => {
        const signal = options.signal;
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        const onAbort = () => { cleanup(); reject(new DOMException('Visual measurement was cancelled.', 'AbortError')); };
        signal?.addEventListener('abort', onAbort, { once: true });
        document.fonts.ready.then(() => { cleanup(); resolve(); }, () => { cleanup(); resolve(); });
        if (signal?.aborted) onAbort();
      });
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // Canvas uses the currently available fallback font when font readiness fails.
  }
  if (options.signal?.aborted) throw new DOMException('Visual measurement was cancelled.', 'AbortError');
  return measureVisualsFromCurrentBrowser(model);
}

export function measureVisualsFromCurrentBrowser(model: KoraArchitectureModel): VisualMetricsSnapshot {
  if (typeof document === 'undefined') return measureVisuals(model);
  const family = typeof getComputedStyle === 'function'
    ? getComputedStyle(document.body).fontFamily || getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'Arial, sans-serif'
    : 'Arial, sans-serif';
  const context = createTextMeasureContext(family);
  return measureVisuals(model, context, family);
}

export function compareStable(a: string, b: string): number {
  const left = Array.from(a, char => char.codePointAt(0) ?? 0);
  const right = Array.from(b, char => char.codePointAt(0) ?? 0);
  const count = Math.min(left.length, right.length);
  for (let i = 0; i < count; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
}
