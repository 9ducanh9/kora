import { ConnectionPresentation, ConnectionRoute, DiagramDocument, Rect } from '../diagram/types';
import { KoraArchitectureModel } from '../ir/types';
import { VisualMetricsSnapshot } from './visualMetrics';
import { compareStable } from './visualMetrics';
import { CONNECTION_ANCHOR_VERSION, resolveConnectionAnchor } from './anchors';
import { resolveEffectiveNodeBox } from './nodeDimensions';

function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter(key => record[key] !== undefined).sort(compareStable).map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

export function routeInputPayload(
  model: KoraArchitectureModel,
  nodeBoxes: Record<string, Rect>,
  containerBoxes: Record<string, Rect>,
  presentations: Record<string, ConnectionPresentation>,
  metrics: VisualMetricsSnapshot
): unknown {
  const sorted = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => compareStable(a.id, b.id));
  return {
    routeVersion: 'kora-routing-v1',
    profile: {
      clearance: 8,
      labelClearance: 4,
      laneGap: 12,
      anchor: CONNECTION_ANCHOR_VERSION,
      stub: 12
    },
    semantics: {
      nodes: sorted(model.nodes),
      containers: sorted(model.containers),
      connections: sorted(model.connections)
    },
    nodeBoxes,
    containerBoxes,
    sides: Object.fromEntries(Object.entries(presentations).sort(([a], [b]) => compareStable(a, b)).map(([id, item]) => [id, { sourceSide: item.sourceSide ?? 'right', targetSide: item.targetSide ?? 'left' }])),
    metrics
  };
}

export async function createRouteInputSignature(
  model: KoraArchitectureModel,
  nodeBoxes: Record<string, Rect>,
  containerBoxes: Record<string, Rect>,
  presentations: Record<string, ConnectionPresentation>,
  metrics: VisualMetricsSnapshot
): Promise<string> {
  const payload = new TextEncoder().encode(canonical(routeInputPayload(model, nodeBoxes, containerBoxes, presentations, metrics)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function routeCacheStatus(route: ConnectionRoute | undefined, expectedSignature: string, semanticLabel: string | undefined): 'missing' | 'stale' | 'unusable' | 'usable' {
  if (!route) return 'missing';
  if (route.inputSignature !== expectedSignature) return 'stale';
  if (route.version !== '1.0' || !/^[a-f0-9]{64}$/u.test(route.inputSignature)) return 'unusable';
  if (route.points.length < 2 || route.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return 'unusable';
  if (route.label && (![route.label.x, route.label.y, route.label.width, route.label.height].every(Number.isFinite) || route.label.width <= 0 || route.label.height <= 0)) return 'unusable';
  if ((semanticLabel ?? '').trim() && !route.label) return 'unusable';
  if (!(semanticLabel ?? '').trim() && route.label) return 'unusable';
  return 'usable';
}

export function routeGeometryUsable(document: DiagramDocument, connectionId: string, route: ConnectionRoute, metricsSnapshot?: VisualMetricsSnapshot): boolean {
  const connection = document.semantic.connections[connectionId];
  if (!connection) return false;
  const source = document.presentation.nodes[connection.source];
  const target = document.presentation.nodes[connection.target];
  if (!source || !target) return false;
  const effectiveBox = (id: string, presentation: typeof source) => {
    const fallback = resolveEffectiveNodeBox(presentation, document.semantic.nodes[id]);
    const measured = metricsSnapshot?.nodes[id];
    return {
      x: presentation.x,
      y: presentation.y,
      width: Math.max(presentation.width ?? 0, measured?.width ?? fallback.width),
      height: Math.max(presentation.height ?? 0, measured?.height ?? fallback.height)
    };
  };
  const sourceBox = effectiveBox(connection.source, source);
  const targetBox = effectiveBox(connection.target, target);
  const presentation = document.presentation.connections?.[connectionId] ?? {};
  const expectedStart = resolveConnectionAnchor(sourceBox, presentation.sourceSide ?? 'right', 'source');
  const expectedEnd = resolveConnectionAnchor(targetBox, presentation.targetSide ?? 'left', 'target');
  const start = route.points[0]; const end = route.points.at(-1);
  if (!end || Math.hypot(start.x - expectedStart.x, start.y - expectedStart.y) > 1 || Math.hypot(end.x - expectedEnd.x, end.y - expectedEnd.y) > 1) return false;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1]; const b = route.points[i];
    if (Math.abs(a.x - b.x) > 1 && Math.abs(a.y - b.y) > 1) return false;
    for (const [id, box] of Object.entries(document.presentation.nodes)) {
      if (id === connection.source || id === connection.target) continue;
      const effective = effectiveBox(id, box);
      const width = effective.width;
      const height = effective.height;
      if (Math.abs(a.x - b.x) <= 1 && a.x > box.x + 1 && a.x < box.x + width - 1 && Math.max(a.y, b.y) > box.y + 1 && Math.min(a.y, b.y) < box.y + height - 1) return false;
      if (Math.abs(a.y - b.y) <= 1 && a.y > box.y + 1 && a.y < box.y + height - 1 && Math.max(a.x, b.x) > box.x + 1 && Math.min(a.x, b.x) < box.x + width - 1) return false;
    }
  }
  return true;
}

export function cachedRouteForRender(
  document: DiagramDocument,
  connectionId: string,
  route: ConnectionRoute | undefined,
  expectedSignature: string,
  semanticLabel: string | undefined,
  metrics?: VisualMetricsSnapshot,
  geometryPreviewActive = false
): ConnectionRoute | undefined {
  if (geometryPreviewActive || routeCacheStatus(route, expectedSignature, semanticLabel) !== 'usable' || !route || !routeGeometryUsable(document, connectionId, route, metrics)) return undefined;
  return route;
}

export function routingPresentationFromDocument(document: DiagramDocument): Record<string, ConnectionPresentation> {
  return document.presentation.connections ?? {};
}
