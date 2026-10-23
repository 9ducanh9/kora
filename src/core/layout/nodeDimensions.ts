import { measureVisuals } from './visualMetrics';
import { Rect } from '../diagram/types';

export const COMPACT_NODE_WIDTH = 96;
export const ICON_SIZE = 48;
export const TOP_PADDING = 6;
export const BOTTOM_PADDING = 6;
export const ICON_LABEL_GAP = 4;

export interface NodeDimensionInput {
  label: string;
  subtitle?: string;
  assetId?: string;
}

export interface NodeDimensions {
  width: number;
  height: number;
  isTwoLineLabel: boolean;
  hasSubtitle: boolean;
  resolvedPrimaryLabel: string;
  resolvedSubtitle?: string;
}

/** Offline and legacy fallback backed by the same deterministic wrapping contract as layout. */
export function getNodeDimensions(input: NodeDimensionInput): NodeDimensions {
  const measured = measureVisuals({
    version: '1.0',
    nodes: [{ id: 'dimension-probe', label: input.label, kind: 'generic', assetId: input.assetId, subtitle: input.subtitle }],
    connections: [],
    containers: []
  }).nodes['dimension-probe'];
  return {
    width: measured.width,
    height: measured.height,
    isTwoLineLabel: measured.primaryLines > 1,
    hasSubtitle: Boolean(measured.subtitle?.trim()),
    resolvedPrimaryLabel: measured.primary,
    resolvedSubtitle: measured.subtitle
  };
}

/** Resolve one box for the canvas wrapper, handles, routing and exports. */
export function resolveEffectiveNodeBox(
  presentation: { x: number; y: number; width?: number; height?: number },
  node: NodeDimensionInput
): Rect {
  const measured = getNodeDimensions(node);
  return {
    x: presentation.x,
    y: presentation.y,
    width: Math.max(presentation.width ?? 0, measured.width),
    height: Math.max(presentation.height ?? 0, measured.height)
  };
}

export function isTwoLineLabel(text: string): boolean {
  return getNodeDimensions({ label: text }).isTwoLineLabel;
}
