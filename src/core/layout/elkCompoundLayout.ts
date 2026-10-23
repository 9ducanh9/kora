import ELK, { ElkEdgeSection, ElkExtendedEdge, ElkNode, ElkPort, ElkPoint } from 'elkjs/lib/elk.bundled.js';
import { KoraArchitectureModel, IRConnection, IRContainer, IRNode } from '../ir/types';
import { ConnectionPresentation, ConnectionRoute, ConnectionSide, DiagramDocument, NodePresentation, ContainerPresentation, Point, Rect } from '../diagram/types';
import { getContainerVisualConfig } from '../containers/registry';
import { auditLayout, LayoutFinding } from './qualityAudit';
import { resolveConnectionAnchor, resolveEscapePoint, PORT_ESCAPE_STUB } from './anchors';
import { compareStable, measureVisuals, VisualMetricsSnapshot } from './visualMetrics';
import { createRouteInputSignature } from './routeCache';
import { stageLayoutPriorities } from './stagePriorities';
import { composeArchitecture, facingSides } from './architectureComposition';

let elk: InstanceType<typeof ELK> | undefined;
function getElk(): InstanceType<typeof ELK> {
  // ELK's bundled fake worker does not export a constructor inside a real
  // browser worker. Use its classic worker script there, and keep Node's fallback.
  return elk ??= new ELK(typeof Worker === 'function'
    ? { workerFactory: () => new Worker('/vendor/elk-worker.min.js') }
    : {});
}
const BASE_PROFILE = { nodeSpacing: 60, layerSpacing: 100, containerSpacing: 36 };
const SPACIOUS_PROFILE = { nodeSpacing: 90, layerSpacing: 140, containerSpacing: 54 };
const ROUTE_CLEARANCE = 8;

export interface LayoutOptions {
  composition?: 'layered' | 'architecture';
  direction?: 'RIGHT' | 'DOWN';
  nodeSpacing?: number;
  layerSpacing?: number;
  containerSpacing?: number;
  candidate?: 'base' | 'spacious';
  connectionPresentations?: Record<string, ConnectionPresentation>;
  metrics?: VisualMetricsSnapshot;
  onProgress?: (stage: 'layout' | 'routing' | 'audit') => void;
}

export interface LayoutResult {
  composition?: 'layered' | 'architecture';
  document: DiagramDocument;
  metrics: VisualMetricsSnapshot;
  findings: LayoutFinding[];
  profile: 'base' | 'spacious';
}

type InternalKind = 'root' | 'node' | 'container' | 'edge' | 'port' | 'label';
interface InternalEntry { semanticId?: string; kind: InternalKind }
interface OwnedEdge { edge: ElkExtendedEdge; offsetX: number; offsetY: number }
export interface ElkLayoutEngine { layout(graph: ElkNode): Promise<ElkNode> }

function assertFiniteRect(rect: Rect, id: string) {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    throw new Error(`LAYOUT_OUTPUT_INVALID: invalid geometry for '${id}'.`);
  }
}

function rectsIntersect(a: Rect, b: Rect, clearance = 0): boolean {
  return a.x < b.x + b.width + clearance && a.x + a.width + clearance > b.x &&
    a.y < b.y + b.height + clearance && a.y + a.height + clearance > b.y;
}

function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  if (Math.abs(a.x - b.x) <= 1) return a.x > rect.x + 1 && a.x < rect.x + rect.width - 1 && Math.max(a.y, b.y) > rect.y + 1 && Math.min(a.y, b.y) < rect.y + rect.height - 1;
  if (Math.abs(a.y - b.y) <= 1) return a.y > rect.y + 1 && a.y < rect.y + rect.height - 1 && Math.max(a.x, b.x) > rect.x + 1 && Math.min(a.x, b.x) < rect.x + rect.width - 1;
  return true;
}

function segmentBlocked(a: Point, b: Point, obstacles: Rect[], clearance = ROUTE_CLEARANCE): boolean {
  if (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01) return true;
  for (const rect of obstacles) {
    const expanded = { x: rect.x - clearance, y: rect.y - clearance, width: rect.width + clearance * 2, height: rect.height + clearance * 2 };
    if (Math.abs(a.x - b.x) <= 0.01) {
      const minY = Math.min(a.y, b.y); const maxY = Math.max(a.y, b.y);
      if (a.x > expanded.x + 0.01 && a.x < expanded.x + expanded.width - 0.01 && maxY > expanded.y + 0.01 && minY < expanded.y + expanded.height - 0.01) return true;
    } else {
      const minX = Math.min(a.x, b.x); const maxX = Math.max(a.x, b.x);
      if (a.y > expanded.y + 0.01 && a.y < expanded.y + expanded.height - 0.01 && maxX > expanded.x + 0.01 && minX < expanded.x + expanded.width - 0.01) return true;
    }
  }
  return false;
}

function simplifyPoints(points: Point[]): Point[] {
  const unique: Point[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const last = unique[unique.length - 1];
    if (last && Math.abs(last.x - point.x) <= 0.01 && Math.abs(last.y - point.y) <= 0.01) continue;
    if (unique.length > 1) {
      const before = unique[unique.length - 2];
      if ((Math.abs(before.x - last!.x) <= 0.01 && Math.abs(last!.x - point.x) <= 0.01) ||
        (Math.abs(before.y - last!.y) <= 0.01 && Math.abs(last!.y - point.y) <= 0.01)) unique.pop();
    }
    unique.push({ x: point.x, y: point.y });
  }
  return unique;
}

function selfLoopCandidates(box: Rect, start: Point, end: Point, sourceSide: ConnectionSide, targetSide: ConnectionSide, lane: number, labelSize?: { width: number; height: number }, gapOverride?: number): Point[][] {
  const gap = (gapOverride ?? Math.max(PORT_ESCAPE_STUB + ROUTE_CLEARANCE + 4, (labelSize?.width ?? box.width) / 2 + 8)) + Math.abs(lane);
  const outer = { x: box.x - gap, y: box.y - gap, width: box.width + gap * 2, height: box.height + gap * 2 };
  const sourceEscape = resolveEscapePoint(start, sourceSide);
  const targetEscape = resolveEscapePoint(end, targetSide);
  const boundaryPoint = (side: ConnectionSide, escape: Point): Point => {
    if (side === 'top') return { x: escape.x, y: outer.y };
    if (side === 'right') return { x: outer.x + outer.width, y: escape.y };
    if (side === 'bottom') return { x: escape.x, y: outer.y + outer.height };
    return { x: outer.x, y: escape.y };
  };
  const sourceBoundary = boundaryPoint(sourceSide, sourceEscape);
  const targetBoundary = boundaryPoint(targetSide, targetEscape);
  const railX = (side: ConnectionSide, anchor: Point): number => {
    if (side === 'left') return outer.x;
    if (side === 'right') return outer.x + outer.width;
    if (side === 'top') return anchor.x;
    return anchor.x < box.x + box.width / 2 ? outer.x : outer.x + outer.width;
  };
  const sourceX = railX(sourceSide, start);
  const targetX = railX(targetSide, end);
  const topRail = outer.y;
  const bottomRail = outer.y + outer.height;
  const railRoutes = [topRail, bottomRail].map(railY => simplifyPoints([
    start,
    sourceEscape,
    { x: sourceX, y: sourceEscape.y },
    { x: sourceX, y: railY },
    { x: targetX, y: railY },
    { x: targetX, y: targetEscape.y },
    targetEscape,
    end
  ]));
  const perimeter = 2 * (outer.width + outer.height);
  const position = (point: Point): number => {
    if (Math.abs(point.y - outer.y) < 0.01) return point.x - outer.x;
    if (Math.abs(point.x - (outer.x + outer.width)) < 0.01) return outer.width + point.y - outer.y;
    if (Math.abs(point.y - (outer.y + outer.height)) < 0.01) return outer.width + outer.height + outer.x + outer.width - point.x;
    return 2 * outer.width + outer.height + outer.y + outer.height - point.y;
  };
  const corners = [
    { distance: 0, point: { x: outer.x, y: outer.y } },
    { distance: outer.width, point: { x: outer.x + outer.width, y: outer.y } },
    { distance: outer.width + outer.height, point: { x: outer.x + outer.width, y: outer.y + outer.height } },
    { distance: 2 * outer.width + outer.height, point: { x: outer.x, y: outer.y + outer.height } }
  ];
  const sourcePosition = position(sourceBoundary);
  const targetPosition = position(targetBoundary);
  let clockwiseDistance = (targetPosition - sourcePosition + perimeter) % perimeter;
  let counterClockwiseDistance = (sourcePosition - targetPosition + perimeter) % perimeter;
  if (clockwiseDistance < 0.01) clockwiseDistance = perimeter;
  if (counterClockwiseDistance < 0.01) counterClockwiseDistance = perimeter;
  const clockwise = (clockwiseDistance >= counterClockwiseDistance ? [
    { direction: 'clockwise' as const, distance: clockwiseDistance }
  ] : [
    { direction: 'counterclockwise' as const, distance: counterClockwiseDistance }
  ]);
  const counter = clockwise[0].direction === 'clockwise'
    ? { direction: 'counterclockwise' as const, distance: counterClockwiseDistance }
    : { direction: 'clockwise' as const, distance: clockwiseDistance };
  const perimeterRoutes = [...clockwise, counter].map(({ direction, distance }) => {
    const crossings: Array<{ distance: number; point: Point }> = [];
    if (direction === 'clockwise') {
      const endDistance = sourcePosition + distance;
      for (const corner of corners) {
        for (let cycle = Math.floor(sourcePosition / perimeter); cycle <= Math.ceil(endDistance / perimeter); cycle++) {
          const unwrapped = corner.distance + cycle * perimeter;
          if (unwrapped > sourcePosition + 0.01 && unwrapped < endDistance - 0.01) crossings.push({ distance: unwrapped, point: corner.point });
        }
      }
    } else {
      const endDistance = sourcePosition - distance;
      for (const corner of corners) {
        for (let cycle = Math.floor(endDistance / perimeter); cycle <= Math.ceil(sourcePosition / perimeter); cycle++) {
          const unwrapped = corner.distance + cycle * perimeter;
          if (unwrapped < sourcePosition - 0.01 && unwrapped > endDistance + 0.01) crossings.push({ distance: unwrapped, point: corner.point });
        }
      }
    }
    crossings.sort((a, b) => direction === 'clockwise' ? a.distance - b.distance : b.distance - a.distance);
    const pathCorners = crossings.map(crossing => crossing.point);
    return simplifyPoints([start, sourceEscape, sourceBoundary, ...pathCorners, targetBoundary, targetEscape, end]);
  });
  // Centered same-side anchors coincide: a rail can fold back to a line.
  // Keep a visible exterior loop rather than selecting that degenerate route.
  return [...railRoutes, ...perimeterRoutes].filter(points => {
    const twiceArea = points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length];
      return area + point.x * next.y - next.x * point.y;
    }, 0);
    return points.length >= 4 && Math.abs(twiceArea) > 0.01 &&
      !points.slice(1).some((point, index) => segmentBlocked(points[index], point, [box], 0));
  });
}

interface SearchState { point: Point; direction: 'H' | 'V' | ''; cost: number; previous?: SearchState; key: string }

function stateOrder(a: SearchState, b: SearchState): number {
  return a.cost - b.cost || compareStable(a.key, b.key);
}

function heapPush(heap: SearchState[], state: SearchState): void {
  let index = heap.length;
  heap.push(state);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (stateOrder(heap[parent], state) <= 0) break;
    heap[index] = heap[parent]; index = parent;
  }
  heap[index] = state;
}

function heapPop(heap: SearchState[]): SearchState | undefined {
  if (!heap.length) return undefined;
  const first = heap[0];
  const last = heap.pop()!;
  if (heap.length) {
    let index = 0;
    while (true) {
      const left = index * 2 + 1; const right = left + 1;
      if (left >= heap.length) break;
      const child = right < heap.length && stateOrder(heap[right], heap[left]) < 0 ? right : left;
      if (stateOrder(last, heap[child]) <= 0) break;
      heap[index] = heap[child]; index = child;
    }
    heap[index] = last;
  }
  return first;
}

/** Bounded rectilinear visibility-grid search. Endpoints and sides remain fixed. */
export function repairOrthogonalRoute(start: Point, end: Point, obstacles: Rect[], connectionId = ''): Point[] | undefined {
  if (Math.abs(start.x - end.x) < 0.01 && Math.abs(start.y - end.y) < 0.01) {
    const loop = Math.abs(start.x - end.x) < 0.01 ? [{ x: start.x + 32, y: start.y }, { x: start.x + 32, y: start.y - 32 }, { x: start.x, y: start.y - 32 }] : [];
    return simplifyPoints([start, ...loop, end]);
  }
  const xs = new Set<number>([start.x, end.x]);
  const ys = new Set<number>([start.y, end.y]);
  for (const obstacle of obstacles) {
    xs.add(obstacle.x - ROUTE_CLEARANCE - 1); xs.add(obstacle.x + obstacle.width + ROUTE_CLEARANCE + 1);
    ys.add(obstacle.y - ROUTE_CLEARANCE - 1); ys.add(obstacle.y + obstacle.height + ROUTE_CLEARANCE + 1);
  }
  const xValues = [...xs].sort((a, b) => a - b);
  const yValues = [...ys].sort((a, b) => a - b);
  if (xValues.length * yValues.length > 400000) return undefined;
  const xIndex = new Map(xValues.map((value, index) => [value, index]));
  const yIndex = new Map(yValues.map((value, index) => [value, index]));
  const pointKey = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
  const states = new Map<string, SearchState>();
  const open: SearchState[] = [];
  const startState: SearchState = { point: start, direction: '', cost: 0, key: `${pointKey(start.x, start.y)}|` };
  states.set(startState.key, startState); heapPush(open, startState);
  let expanded = 0;
  let best: SearchState | undefined;
  while (open.length && expanded < 20000) {
    const current = heapPop(open)!;
    if (states.get(current.key)?.cost !== current.cost) continue;
    if (Math.abs(current.point.x - end.x) < 0.01 && Math.abs(current.point.y - end.y) < 0.01) { best = current; break; }
    expanded++;
    const xAt = xIndex.get(current.point.x); const yAt = yIndex.get(current.point.y);
    const neighbors: Point[] = [];
    if (xAt !== undefined) {
      if (xAt > 0) neighbors.push({ x: xValues[xAt - 1], y: current.point.y });
      if (xAt + 1 < xValues.length) neighbors.push({ x: xValues[xAt + 1], y: current.point.y });
    }
    if (yAt !== undefined) {
      if (yAt > 0) neighbors.push({ x: current.point.x, y: yValues[yAt - 1] });
      if (yAt + 1 < yValues.length) neighbors.push({ x: current.point.x, y: yValues[yAt + 1] });
    }
    neighbors.sort((a, b) => a.x - b.x || a.y - b.y);
    for (const point of neighbors) {
      if (segmentBlocked(current.point, point, obstacles)) continue;
      const direction: 'V' | 'H' = Math.abs(point.x - current.point.x) < 0.01 ? 'V' : 'H';
      const bendCost = current.direction && current.direction !== direction ? 24 : 0;
      const distance = Math.abs(point.x - current.point.x) + Math.abs(point.y - current.point.y);
      const cost = current.cost + distance + bendCost;
      const key = `${pointKey(point.x, point.y)}|${direction}`;
      const known = states.get(key);
      if (known && known.cost <= cost) continue;
      const next = { point, direction, cost, previous: current, key };
      states.set(key, next); heapPush(open, next);
    }
  }
  if (!best) return undefined;
  const path: Point[] = [];
  for (let state: SearchState | undefined = best; state; state = state.previous) path.push(state.point);
  return simplifyPoints(path.reverse());
}

function sectionPath(section: ElkEdgeSection, offsetX: number, offsetY: number): Point[] | undefined {
  if (!section.startPoint || !section.endPoint) return undefined;
  return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(point => ({ x: point.x + offsetX, y: point.y + offsetY }));
}

function samePoint(a: Point, b: Point, epsilon = 1): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

/** Reorders and joins one owner's ELK sections, then applies that edge owner's absolute origin once. */
export function normalizeSections(sections: ElkEdgeSection[] | undefined, offsetX: number, offsetY: number, start: Point, end: Point): Point[] | undefined {
  if (!sections?.length) return undefined;
  const pending = sections.map(section => ({ section, points: sectionPath(section, offsetX, offsetY) })).filter(item => item.points?.length);
  if (!pending.length) return undefined;
  const ordered: Point[] = [];
  const first = pending.find(item => samePoint(item.points![0], start)) ?? pending.find(item => samePoint(item.points![item.points!.length - 1], start));
  if (!first) return undefined;
  let current = first.points!;
  if (samePoint(current[current.length - 1], start) && !samePoint(current[0], start)) current = [...current].reverse();
  ordered.push(...current);
  pending.splice(pending.indexOf(first), 1);
  while (pending.length) {
    const tail = ordered[ordered.length - 1];
    const matches = pending.filter(item => samePoint(item.points![0], tail) || samePoint(item.points![item.points!.length - 1], tail));
    if (matches.length !== 1) return undefined;
    const next = matches[0];
    let path = next.points!;
    if (samePoint(path[path.length - 1], tail) && !samePoint(path[0], tail)) path = [...path].reverse();
    ordered.push(...path.slice(1));
    pending.splice(pending.indexOf(next), 1);
  }
  const path = simplifyPoints(ordered);
  if (!samePoint(path[0], start) || !samePoint(path[path.length - 1], end)) return undefined;
  path[0] = start;
  path[path.length - 1] = end;
  return path;
}

function walkEdges(node: ElkNode, offsetX: number, offsetY: number, result: OwnedEdge[]): void {
  for (const edge of (node as ElkNode & { edges?: ElkExtendedEdge[] }).edges ?? []) result.push({ edge, offsetX, offsetY });
  for (const child of node.children ?? []) walkEdges(child, offsetX + (child.x ?? 0), offsetY + (child.y ?? 0), result);
}

function createPrivateId(kind: InternalKind, used: Set<string>, sequence: { value: number }): string {
  let id = '';
  do { id = `__kora_${kind}_${String(sequence.value++).padStart(6, '0')}`; } while (used.has(id));
  used.add(id);
  return id;
}

function createPort(id: string, box: Rect, side: ConnectionSide, role: 'source' | 'target'): ElkPort {
  const anchor = resolveConnectionAnchor({ x: 0, y: 0, width: box.width, height: box.height }, side, role);
  const sideName = side === 'top' ? 'NORTH' : side === 'right' ? 'EAST' : side === 'bottom' ? 'SOUTH' : 'WEST';
  return { id, x: anchor.x - 0.5, y: anchor.y - 0.5, width: 1, height: 1, layoutOptions: { 'elk.port.side': sideName } };
}

function containerPad(container: IRContainer, metrics: VisualMetricsSnapshot) {
  const config = getContainerVisualConfig(container.type);
  const top = Math.max(config.topPadding, metrics.containers[container.id]?.contentTop ?? config.topPadding);
  return { top, left: config.sidePadding, bottom: config.bottomPadding, right: config.sidePadding };
}

function labelPlacement(points: Point[], size: { width: number; height: number } | undefined, obstacles: Rect[], conflicts?: (label: Rect) => boolean): Rect | undefined {
  if (!size || points.length < 2) return undefined;
  const candidates: Point[] = [];
  const segments = points.slice(1).map((point, index) => ({ a: points[index], b: point, index })).sort((a, b) => {
    const la = Math.abs(a.b.x - a.a.x) + Math.abs(a.b.y - a.a.y);
    const lb = Math.abs(b.b.x - b.a.x) + Math.abs(b.b.y - b.a.y);
    return lb - la || a.index - b.index;
  });
  for (const segment of segments) {
    const length = Math.abs(segment.b.x - segment.a.x) + Math.abs(segment.b.y - segment.a.y);
    const vertical = Math.abs(segment.a.x - segment.b.x) <= 0.01;
    const alongSize = vertical ? size.height : size.width;
    const crossSize = vertical ? size.width : size.height;
    const minDistance = alongSize / 2 + 4;
    const maxDistance = length - minDistance;
    if (maxDistance < minDistance) continue;
    const available = maxDistance - minDistance;
    const intervals = Math.max(1, Math.min(10, Math.floor(available / Math.max(24, alongSize * 0.35))));
    const centerDistance = (minDistance + maxDistance) / 2;
    const distances = [centerDistance];
    for (let step = 1; step <= intervals; step++) {
      const delta = available * step / (2 * intervals);
      distances.push(centerDistance - delta, centerDistance + delta);
    }
    const offsets = [0, -(crossSize / 2 + 4), crossSize / 2 + 4, -(crossSize / 2 + 16), crossSize / 2 + 16];
    const at = (ratio: number, offset: number) => ({
      x: segment.a.x + (segment.b.x - segment.a.x) * ratio + (vertical ? offset : 0),
      y: segment.a.y + (segment.b.y - segment.a.y) * ratio + (vertical ? 0 : offset)
    });
    for (const distance of distances) for (const offset of offsets) candidates.push(at(distance / length, offset));
  }
  for (const center of candidates) {
    const rect = { x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height };
    if (!obstacles.some(obstacle => rectsIntersect(rect, obstacle, 4)) && !conflicts?.({ x: rect.x - 2, y: rect.y - 2, width: rect.width + 4, height: rect.height + 4 })) return rect;
  }
  const center = candidates[0] ?? points[Math.floor(points.length / 2)];
  return { x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height };
}

async function buildCandidate(model: KoraArchitectureModel, options: LayoutOptions, metrics: VisualMetricsSnapshot, profile: 'base' | 'spacious', engine: ElkLayoutEngine): Promise<LayoutResult> {
  const direction = options.direction ?? 'RIGHT';
  const spacing = profile === 'base' ? BASE_PROFILE : SPACIOUS_PROFILE;
  const nodeSpacing = options.nodeSpacing ?? spacing.nodeSpacing;
  const layerSpacing = options.layerSpacing ?? spacing.layerSpacing;
  const containerSpacing = options.containerSpacing ?? spacing.containerSpacing;
  const semanticIds = new Set([...model.nodes, ...model.containers, ...model.connections].map(item => item.id));
  const usedIds = new Set(semanticIds);
  const sequence = { value: 0 };
  const internalBySemantic = new Map<string, string>();
  const internalReverse = new Map<string, InternalEntry>();
  const rootId = createPrivateId('root', usedIds, sequence);
  internalReverse.set(rootId, { kind: 'root' });
  for (const container of [...model.containers].sort((a, b) => compareStable(a.id, b.id))) {
    const id = createPrivateId('container', usedIds, sequence);
    internalBySemantic.set(`container:${container.id}`, id); internalReverse.set(id, { kind: 'container', semanticId: container.id });
  }
  for (const node of [...model.nodes].sort((a, b) => compareStable(a.id, b.id))) {
    const id = createPrivateId('node', usedIds, sequence);
    internalBySemantic.set(`node:${node.id}`, id); internalReverse.set(id, { kind: 'node', semanticId: node.id });
  }
  const connectionPresentations = options.connectionPresentations ?? {};
  const edgeInternal = new Map<string, string>();
  const portInternal = new Map<string, { source: string; target: string }>();
  const portsByNode = new Map<string, ElkPort[]>();
  const portNodes = new Map<string, string>();
  for (const connection of [...model.connections].sort((a, b) => compareStable(a.id, b.id))) {
    const source = model.nodes.find(node => node.id === connection.source);
    const target = model.nodes.find(node => node.id === connection.target);
    if (!source || !target) throw new Error(`LAYOUT_INPUT_INVALID: connection '${connection.id}' has a missing endpoint.`);
    const sourceSide = connectionPresentations[connection.id]?.sourceSide ?? 'right';
    const targetSide = connectionPresentations[connection.id]?.targetSide ?? 'left';
    const sourceBox = metrics.nodes[source.id]; const targetBox = metrics.nodes[target.id];
    if (!sourceBox || !targetBox) throw new Error(`LAYOUT_METRICS_MISSING: connection '${connection.id}' endpoint dimensions are missing.`);
    const sourcePort = createPrivateId('port', usedIds, sequence);
    const targetPort = createPrivateId('port', usedIds, sequence);
    const sourcePorts = portsByNode.get(source.id) ?? [];
    sourcePorts.push(createPort(sourcePort, { x: 0, y: 0, width: sourceBox.width, height: sourceBox.height }, sourceSide, 'source'));
    portsByNode.set(source.id, sourcePorts); portNodes.set(sourcePort, source.id); internalReverse.set(sourcePort, { kind: 'port', semanticId: connection.id });
    const targetPorts = portsByNode.get(target.id) ?? [];
    targetPorts.push(createPort(targetPort, { x: 0, y: 0, width: targetBox.width, height: targetBox.height }, targetSide, 'target'));
    portsByNode.set(target.id, targetPorts); portNodes.set(targetPort, target.id); internalReverse.set(targetPort, { kind: 'port', semanticId: connection.id });
    portInternal.set(connection.id, { source: sourcePort, target: targetPort });
    const edge = createPrivateId('edge', usedIds, sequence);
    edgeInternal.set(connection.id, edge); internalReverse.set(edge, { kind: 'edge', semanticId: connection.id });
  }

  const childContainerMap = new Map<string, IRContainer[]>();
  const childNodeMap = new Map<string, IRNode[]>();
  const rootContainers: IRContainer[] = [];
  const rootNodes: IRNode[] = [];
  for (const container of model.containers) { childContainerMap.set(container.id, []); childNodeMap.set(container.id, []); }
  for (const container of model.containers) {
    if (container.parentId && childContainerMap.has(container.parentId)) childContainerMap.get(container.parentId)!.push(container);
    else rootContainers.push(container);
  }
  for (const node of model.nodes) {
    if (node.containerId && childNodeMap.has(node.containerId)) childNodeMap.get(node.containerId)!.push(node);
    else rootNodes.push(node);
  }
  const buildContainer = (container: IRContainer): ElkNode => {
    const pad = containerPad(container, metrics);
    const children: ElkNode[] = [
      ...(childContainerMap.get(container.id) ?? []).sort((a, b) => compareStable(a.id, b.id)).map(buildContainer),
      ...(childNodeMap.get(container.id) ?? []).sort((a, b) => compareStable(a.id, b.id)).map(node => ({
        id: internalBySemantic.get(`node:${node.id}`)!,
        width: metrics.nodes[node.id]?.width,
        height: metrics.nodes[node.id]?.height,
        ports: (portsByNode.get(node.id) ?? []).sort((a, b) => compareStable(a.id, b.id)),
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' }
      }))
    ];
    const header = metrics.containers[container.id];
    return {
      id: internalBySemantic.get(`container:${container.id}`)!,
      width: header?.width,
      height: header?.height,
      layoutOptions: {
        'elk.padding': `[top=${pad.top},left=${pad.left},bottom=${pad.bottom},right=${pad.right}]`,
        'elk.spacing.nodeNode': String(containerSpacing),
        'elk.direction': direction,
        'elk.nodeSize.constraints': 'FIXED',
        'elk.nodeSize.minimum': `[width=${header?.width ?? 180},height=${header?.height ?? 100}]`
      },
      children
    };
  };

  const children: ElkNode[] = [
    ...rootContainers.sort((a, b) => compareStable(a.id, b.id)).map(buildContainer),
    ...rootNodes.sort((a, b) => compareStable(a.id, b.id)).map(node => ({
      id: internalBySemantic.get(`node:${node.id}`)!,
      width: metrics.nodes[node.id]?.width,
      height: metrics.nodes[node.id]?.height,
      ports: (portsByNode.get(node.id) ?? []).sort((a, b) => compareStable(a.id, b.id)),
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' }
    }))
  ];
  const edges: ElkExtendedEdge[] = [...model.connections].sort((a, b) => compareStable(a.id, b.id)).map(connection => {
    const ports = portInternal.get(connection.id)!;
    const labelMetric = metrics.connections[connection.id];
    let labels: Array<{ id: string; text: string; width: number; height: number }> | undefined;
    if (labelMetric) {
      const labelId = createPrivateId('label', usedIds, sequence);
      internalReverse.set(labelId, { kind: 'label', semanticId: connection.id });
      labels = [{ id: labelId, text: connection.label ?? '', width: labelMetric.width, height: labelMetric.height }];
    }
    return { id: edgeInternal.get(connection.id)!, sources: [ports.source], targets: [ports.target], labels, layoutOptions: stageLayoutPriorities(connection.description) };
  });
  const graph: ElkNode = {
    id: rootId,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
      'elk.spacing.nodeNode': String(nodeSpacing),
      'elk.padding': '[top=50,left=50,bottom=50,right=50]',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.randomSeed': '137',
      'elk.separateConnectedComponents': 'true'
    },
    children,
    edges
  };
  options.onProgress?.('layout');
  const laidOut = children.length || edges.length ? await engine.layout(graph) : graph;
  const nodeBoxes: Record<string, Rect & NodePresentation> = {};
  const containerBoxes: Record<string, Rect & ContainerPresentation> = {};
  const ownedEdges: OwnedEdge[] = [];
  const foundNodes = new Set<string>(); const foundContainers = new Set<string>();
  const traverse = (item: ElkNode, offsetX: number, offsetY: number) => {
    const entry = internalReverse.get(item.id);
    const currentX = (item.x ?? 0) + offsetX;
    const currentY = (item.y ?? 0) + offsetY;
    if (entry?.kind === 'container' && entry.semanticId) {
      if (item.x === undefined || item.y === undefined || item.width === undefined || item.height === undefined) throw new Error(`LAYOUT_OUTPUT_INVALID: missing container geometry for '${entry.semanticId}'.`);
      const box = { x: currentX, y: currentY, width: item.width, height: item.height };
      assertFiniteRect(box, entry.semanticId); containerBoxes[entry.semanticId] = box; foundContainers.add(entry.semanticId);
    } else if (entry?.kind === 'node' && entry.semanticId) {
      if (item.x === undefined || item.y === undefined || item.width === undefined || item.height === undefined) throw new Error(`LAYOUT_OUTPUT_INVALID: missing node geometry for '${entry.semanticId}'.`);
      const box = { x: currentX, y: currentY, width: item.width, height: item.height };
      assertFiniteRect(box, entry.semanticId); nodeBoxes[entry.semanticId] = box; foundNodes.add(entry.semanticId);
    }
    for (const edge of (item as ElkNode & { edges?: ElkExtendedEdge[] }).edges ?? []) ownedEdges.push({ edge, offsetX: currentX, offsetY: currentY });
    for (const child of item.children ?? []) traverse(child, currentX, currentY);
  };
  // Root is synthetic and uses the defined origin (0,0) when ELK omits it.
  traverse(laidOut, 0, 0);
  for (const node of model.nodes) if (!foundNodes.has(node.id)) throw new Error(`LAYOUT_OUTPUT_INVALID: ELK omitted node '${node.id}'.`);
  for (const container of model.containers) if (!foundContainers.has(container.id)) throw new Error(`LAYOUT_OUTPUT_INVALID: ELK omitted container '${container.id}'.`);

  const composition = options.composition === 'architecture' && direction === 'RIGHT' ? composeArchitecture(model, metrics) : undefined;
  if (composition) {
    Object.assign(nodeBoxes, composition.nodes);
    Object.assign(containerBoxes, composition.containers);
  }

  const modelNodes = new Map(model.nodes.map(node => [node.id, node]));
  const modelConnections = [...model.connections].sort((a, b) => compareStable(a.id, b.id));
  const edgeBySemantic = new Map<string, OwnedEdge>();
  const seenEdges = new Set<string>();
  for (const owned of ownedEdges) {
    const entry = internalReverse.get(owned.edge.id);
    if (entry?.kind !== 'edge' || !entry.semanticId) continue;
    if (seenEdges.has(entry.semanticId)) throw new Error(`LAYOUT_OUTPUT_INVALID: duplicate ELK edge output for '${entry.semanticId}'.`);
    seenEdges.add(entry.semanticId); edgeBySemantic.set(entry.semanticId, owned);
  }
  for (const connection of modelConnections) if (!edgeBySemantic.has(connection.id)) throw new Error(`LAYOUT_OUTPUT_INVALID: ELK omitted connection '${connection.id}'.`);

  options.onProgress?.('routing');
  const sideOnly: Record<string, ConnectionPresentation> = {};
  for (const connection of modelConnections) {
    const saved = connectionPresentations[connection.id];
    if (composition) {
      const inferred = connection.source === connection.target
        ? { sourceSide: 'top' as const, targetSide: 'right' as const }
        : facingSides(nodeBoxes[connection.source], nodeBoxes[connection.target]);
      sideOnly[connection.id] = { sourceSide: saved?.sourceSide ?? inferred.sourceSide, targetSide: saved?.targetSide ?? inferred.targetSide };
      continue;
    }
    if (saved && (saved.sourceSide !== undefined || saved.targetSide !== undefined)) {
      sideOnly[connection.id] = { ...(saved.sourceSide !== undefined ? { sourceSide: saved.sourceSide } : {}), ...(saved.targetSide !== undefined ? { targetSide: saved.targetSide } : {}) };
    }
  }
  const inputSignature = await createRouteInputSignature(model, nodeBoxes, containerBoxes, sideOnly, metrics);
  const nodeObstacles = Object.values(nodeBoxes);
  const routePresentations: Record<string, ConnectionPresentation> = { ...sideOnly };
  const routedPoints = new Map<string, Point[]>();
  const loopCandidatesByConnection = new Map<string, Point[][]>();
  const edgeObstacles = new Map<string, Rect[]>();
  const routingFindings: LayoutFinding[] = [];
  const connectionsByPair = new Map<string, IRConnection[]>();
  for (const connection of modelConnections) {
    const key = connection.source <= connection.target ? `${connection.source}\u0000${connection.target}` : `${connection.target}\u0000${connection.source}`;
    connectionsByPair.set(key, [...(connectionsByPair.get(key) ?? []), connection]);
  }
  for (const group of connectionsByPair.values()) group.sort((a, b) => compareStable(a.id, b.id));
  const pairOrdinal = new Map<string, number>();
  for (const connection of modelConnections) {
    const source = modelNodes.get(connection.source)!; const target = modelNodes.get(connection.target)!;
    const sourceBox = nodeBoxes[source.id]; const targetBox = nodeBoxes[target.id];
    const sourceSide: ConnectionSide = sideOnly[connection.id]?.sourceSide ?? 'right';
    const targetSide: ConnectionSide = sideOnly[connection.id]?.targetSide ?? 'left';
    const start = resolveConnectionAnchor(sourceBox, sourceSide, 'source');
    const end = resolveConnectionAnchor(targetBox, targetSide, 'target');
    const sourceEscape = resolveEscapePoint(start, sourceSide);
    const targetEscape = resolveEscapePoint(end, targetSide);
    const owned = edgeBySemantic.get(connection.id)!;
    let points = composition ? undefined : normalizeSections(owned.edge.sections, owned.offsetX, owned.offsetY, start, end);
    const endpointAncestors = new Set<string>();
    for (const endpointId of [source.containerId, target.containerId]) {
      let current = endpointId;
      while (current && !endpointAncestors.has(current)) {
        endpointAncestors.add(current);
        current = model.containers.find(container => container.id === current)?.parentId;
      }
    }
    const obstacles = [
      ...Object.entries(nodeBoxes).filter(([id]) => id !== source.id && id !== target.id).map(([, box]) => box),
      // A self-loop must leave its own node instead of taking a shortcut through it.
      ...(source.id === target.id ? [sourceBox] : []),
      ...Object.entries(containerBoxes).flatMap(([id, box]) => {
        const container = model.containers.find(item => item.id === id);
        if (!container) return [];
        if (!endpointAncestors.has(id)) return [box];
        const top = metrics.containers[id]?.contentTop ?? getContainerVisualConfig(container.type).topPadding;
        return [{ x: box.x, y: box.y, width: box.width, height: Math.min(box.height, top) }];
      })
    ];
    const hasLoop = source.id === target.id;
    const key = source.id <= target.id ? `${source.id}\u0000${target.id}` : `${target.id}\u0000${source.id}`;
    const group = connectionsByPair.get(key) ?? [connection];
    const ordinal = pairOrdinal.get(key) ?? 0; pairOrdinal.set(key, ordinal + 1);
    const laneBias = (ordinal - (group.length - 1) / 2) * (composition ? 48 : 6);
    const collides = (route: Point[]) => route.slice(1).some((point, index) => segmentBlocked(route[index], point, obstacles, 0));
    if (hasLoop) {
      const expandedLoops = [
        ...selfLoopCandidates(sourceBox, start, end, sourceSide, targetSide, laneBias, metrics.connections[connection.id]),
        ...[24, 40, 72, 112, 160, 224, 300].flatMap(gap => selfLoopCandidates(sourceBox, start, end, sourceSide, targetSide, laneBias, metrics.connections[connection.id], gap))
      ];
      loopCandidatesByConnection.set(connection.id, expandedLoops);
      const clearLoop = expandedLoops.find(candidate => !collides(candidate));
      if (clearLoop) points = clearLoop;
    }
    if (!points || points.length < 2 || (hasLoop && points.length < 4) || collides(points)) {
      const middle: Point = Math.abs(sourceEscape.x - targetEscape.x) > Math.abs(sourceEscape.y - targetEscape.y)
        ? { x: (sourceEscape.x + targetEscape.x) / 2 + laneBias, y: sourceEscape.y }
        : { x: sourceEscape.x, y: (sourceEscape.y + targetEscape.y) / 2 + laneBias };
      const middle2: Point = { x: middle.x, y: targetEscape.y };
      const horizontal = Math.abs(sourceEscape.x - targetEscape.x) >= Math.abs(sourceEscape.y - targetEscape.y);
      const channel = horizontal ? (sourceEscape.y + targetEscape.y) / 2 + laneBias : (sourceEscape.x + targetEscape.x) / 2 + laneBias;
      const parallel = horizontal
        ? [start, sourceEscape, { x: sourceEscape.x, y: channel }, { x: targetEscape.x, y: channel }, targetEscape, end]
        : [start, sourceEscape, { x: channel, y: sourceEscape.y }, { x: channel, y: targetEscape.y }, targetEscape, end];
      const directCandidates = [
        ...(composition ? [simplifyPoints(parallel)] : []),
        simplifyPoints([start, sourceEscape, middle, middle2, targetEscape, end]),
        simplifyPoints([start, sourceEscape, { x: targetEscape.x, y: sourceEscape.y + laneBias }, targetEscape, end]),
        simplifyPoints([start, sourceEscape, { x: sourceEscape.x + laneBias, y: targetEscape.y }, targetEscape, end])
      ];
      points = directCandidates.find(candidate => !collides(candidate));
      if (!points) {
        const middleRoute = repairOrthogonalRoute(sourceEscape, targetEscape, obstacles, connection.id);
        points = middleRoute ? simplifyPoints([start, ...middleRoute, end]) : undefined;
      }
      if (!points || collides(points)) {
        points = simplifyPoints([start, sourceEscape, { x: sourceEscape.x, y: targetEscape.y }, targetEscape, end]);
        routingFindings.push({ code: 'ROUTE_REPAIR_UNRESOLVED', severity: 'warning', entityIds: [connection.id], geometry: points });
      }
    }
    const labelObstacles = [...obstacles, sourceBox, ...(source.id === target.id ? [] : [targetBox])];
    routedPoints.set(connection.id, points);
    edgeObstacles.set(connection.id, labelObstacles);
    routePresentations[connection.id] = {
      ...(sideOnly[connection.id] ?? {}),
      route: { version: '1.0', inputSignature, points } as ConnectionRoute
    };
  }
  const placedLabels: Rect[] = [];
  for (const connection of modelConnections) {
    let points = routedPoints.get(connection.id)!;
    const size = metrics.connections[connection.id];
    const labelObstacles = [...(edgeObstacles.get(connection.id) ?? []), ...placedLabels];
    const conflictsWithOtherRoutes = (label: Rect) => modelConnections.some(other => {
      if (other.id === connection.id) return false;
      const otherPoints = routedPoints.get(other.id) ?? [];
      return otherPoints.slice(1).some((point, index) => segmentIntersectsRect(otherPoints[index], point, label));
    });
    let label = labelPlacement(points, size, labelObstacles, conflictsWithOtherRoutes);
    const labelClear = (box: Rect | undefined) => box && !labelObstacles.some(obstacle => rectsIntersect(box, obstacle, 4)) && !conflictsWithOtherRoutes({ x: box.x - 2, y: box.y - 2, width: box.width + 4, height: box.height + 4 });
    if (size && !labelClear(label)) {
      // A compact loop may be clear while leaving no space for its label. Try the
      // already bounded perimeter alternatives before adding a local label shelf.
      for (const candidate of loopCandidatesByConnection.get(connection.id) ?? []) {
        if (candidate.slice(1).some((point, index) => segmentBlocked(candidate[index], point, labelObstacles, 0))) continue;
        const candidateLabel = labelPlacement(candidate, size, labelObstacles, conflictsWithOtherRoutes);
        if (labelClear(candidateLabel)) { points = candidate; label = candidateLabel; routedPoints.set(connection.id, points); break; }
      }
    }
    if (size && !labelClear(label)) {
      // Reserve a local shelf for a label instead of accepting a label over another wire.
      // Both semantic endpoints and their selected handle anchors remain unchanged.
      // Straight centered ports simplify to two points. Restore their escape stubs
      // while searching so a label shelf never changes either endpoint direction.
      const presentation = routePresentations[connection.id];
      search: for (const base of [points, ...(loopCandidatesByConnection.get(connection.id) ?? [])]) {
        if (base.slice(1).some((point, index) => segmentBlocked(base[index], point, labelObstacles, 0))) continue;
        const shelfPoints = base.length === 2 ? [
          base[0], resolveEscapePoint(base[0], presentation.sourceSide ?? 'right'),
          resolveEscapePoint(base[1], presentation.targetSide ?? 'left'), base[1]
        ] : base;
        const segments = shelfPoints.slice(1).map((b, index) => ({ a: shelfPoints[index], b, index })).sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y));
        for (const segment of segments) {
          if (segment.index === 0 || segment.index >= shelfPoints.length - 2) continue;
          for (const offset of [40, -40, 72, -72, 112, -112, 160, -160, 224, -224, 300, -300]) {
            const horizontal = Math.abs(segment.a.y - segment.b.y) < 0.01;
            const shelf = horizontal
              ? [{ x: segment.a.x, y: segment.a.y + offset }, { x: segment.b.x, y: segment.b.y + offset }]
              : [{ x: segment.a.x + offset, y: segment.a.y }, { x: segment.b.x + offset, y: segment.b.y }];
            const candidate = simplifyPoints([...shelfPoints.slice(0, segment.index + 1), ...shelf, ...shelfPoints.slice(segment.index + 1)]);
            if (candidate.slice(1).some((point, index) => segmentBlocked(candidate[index], point, labelObstacles, 0))) continue;
            const candidateLabel = labelPlacement(candidate, size, labelObstacles, conflictsWithOtherRoutes);
            if (labelClear(candidateLabel)) { points = candidate; label = candidateLabel; routedPoints.set(connection.id, points); break search; }
          }
        }
      }
    }
    if (size && label && (labelObstacles.some(obstacle => rectsIntersect(label, obstacle, 4)) || conflictsWithOtherRoutes({ x: label.x - 2, y: label.y - 2, width: label.width + 4, height: label.height + 4 }))) {
      routingFindings.push({ code: 'LABEL_PLACEMENT_UNRESOLVED', severity: 'warning', entityIds: [connection.id], geometry: label });
    }
    const currentRoute = routePresentations[connection.id].route!;
    routePresentations[connection.id] = { ...routePresentations[connection.id], route: { ...currentRoute, points, ...(label ? { label } : {}) } };
    if (label) placedLabels.push(label);
  }
  options.onProgress?.('audit');
  const findings = [
    ...auditLayout({ nodes: model.nodes, containers: model.containers, connections: model.connections, nodeBoxes, containerBoxes, connectionPresentations: routePresentations, contentTops: Object.fromEntries(Object.entries(metrics.containers).map(([id, value]) => [id, value.contentTop])) }),
    ...routingFindings
  ];
  const now = new Date().toISOString();
  const document: DiagramDocument = {
    version: '1.0',
    semantic: {
      ...(model.scope ? { scope: model.scope } : {}),
      nodes: Object.fromEntries(model.nodes.map(node => [node.id, { ...node }])),
      connections: Object.fromEntries(model.connections.map(connection => [connection.id, { ...connection }])),
      containers: Object.fromEntries(model.containers.map(container => [container.id, { ...container }]))
    },
    presentation: { nodes: nodeBoxes, containers: containerBoxes, ...(model.connections.length ? { connections: routePresentations } : {}), viewport: { x: 0, y: 0, zoom: 1 } },
    metadata: { title: model.scope?.title || 'AWS Architecture Diagram', createdAt: now, updatedAt: now }
  };
  return { document, metrics, findings, profile, composition: composition ? 'architecture' : 'layered' };
}

/** Deterministic compound ELK layout with private IDs, explicit ports, route cache and geometry audit. */
export async function computeCompoundLayoutDetailed(model: KoraArchitectureModel, options: LayoutOptions = {}, engine: ElkLayoutEngine = getElk()): Promise<LayoutResult> {
  const metrics = options.metrics ?? measureVisuals(model);
  return buildCandidate(model, options, metrics, options.candidate ?? 'base', engine);
}

/** Backward-compatible document-only entry point used by generation and existing callers. */
export async function computeCompoundLayout(model: KoraArchitectureModel, options: LayoutOptions = {}): Promise<DiagramDocument> {
  return (await computeCompoundLayoutDetailed(model, options)).document;
}
