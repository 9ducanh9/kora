import { DiagramDocument, Point, Rect } from '../diagram/types';
import { EXPORT_LIMITS, DiagramExportError } from './limits';

export type DiagramBounds = Rect;

function textFields(document: DiagramDocument): string[] {
  return [
    ...Object.values(document.semantic.nodes).flatMap(node => [node.label, node.subtitle ?? '']),
    ...Object.values(document.semantic.containers).map(container => container.label),
    ...Object.values(document.semantic.connections).map(connection => connection.label ?? ''),
    document.metadata.title
  ];
}

/** Resource guard that runs before DOM text measurement and asset loading. */
export function preflightDiagram(document: DiagramDocument): void {
  const nodes = Object.values(document.semantic.nodes);
  const containers = Object.values(document.semantic.containers);
  const connections = Object.values(document.semantic.connections);
  const entities = nodes.length + containers.length + connections.length;
  if (entities > EXPORT_LIMITS.maxEntities) throw new DiagramExportError('ENTITY_LIMIT', `Export supports up to ${EXPORT_LIMITS.maxEntities} diagram entities.`);
  if (entities === 0) throw new DiagramExportError('NOTHING_TO_EXPORT', 'Nothing to export. Add a node or container first.');

  let routePoints = 0;
  for (const [id, presentation] of Object.entries(document.presentation.connections ?? {})) {
    const count = presentation.route?.points.length ?? 0;
    if (count > EXPORT_LIMITS.maxPointsPerConnection) throw new DiagramExportError('CONNECTION_POINT_LIMIT', `Connection ${id} exceeds the route point limit.`);
    routePoints += count;
    if (routePoints > EXPORT_LIMITS.maxRoutePoints) throw new DiagramExportError('ROUTE_POINT_LIMIT', 'The diagram exceeds the total route point limit.');
  }

  let totalCodeUnits = 0;
  for (const value of textFields(document)) {
    if (value.length > EXPORT_LIMITS.maxTextFieldCodeUnits) throw new DiagramExportError('TEXT_FIELD_LIMIT', `A diagram text field exceeds ${EXPORT_LIMITS.maxTextFieldCodeUnits} characters.`);
    totalCodeUnits += value.length;
    if (totalCodeUnits > EXPORT_LIMITS.maxTotalTextCodeUnits) throw new DiagramExportError('TEXT_TOTAL_LIMIT', 'The diagram exceeds the total visible text limit.');
  }

  const renderInput = {
    semantic: document.semantic,
    presentation: document.presentation
  };
  let serialized: string;
  try { serialized = JSON.stringify(renderInput); }
  catch { throw new DiagramExportError('RENDER_INPUT_INVALID', 'Diagram render data could not be prepared.'); }
  if (new TextEncoder().encode(serialized).byteLength > EXPORT_LIMITS.maxRenderInputBytes) {
    throw new DiagramExportError('RENDER_INPUT_LIMIT', 'Diagram render data exceeds the 10 MiB limit.');
  }
}

export function diagramBounds(rectangles: Rect[], paths: Point[][], padding = 28): DiagramBounds {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const rect of rectangles) {
    xs.push(rect.x, rect.x + rect.width);
    ys.push(rect.y, rect.y + rect.height);
  }
  for (const points of paths) for (const point of points) { xs.push(point.x); ys.push(point.y); }
  if (!xs.length || !ys.length) throw new DiagramExportError('EMPTY_BOUNDS', 'The diagram has no visible geometry to export.');
  let minX = Number.POSITIVE_INFINITY; let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY; let maxY = Number.NEGATIVE_INFINITY;
  for (const x of xs) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  for (const y of ys) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const x = minX - padding; const y = minY - padding;
  const width = maxX - minX + padding * 2; const height = maxY - minY + padding * 2;
  if (![x, y, width, height, x + width, y + height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new DiagramExportError('BOUNDS_OVERFLOW', 'Diagram geometry exceeds finite SVG bounds.');
  }
  return { x, y, width, height };
}
