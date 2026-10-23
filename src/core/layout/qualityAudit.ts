import { ConnectionPresentation, ConnectionRoute, Rect } from '../diagram/types';
import { IRConnection, IRContainer, IRNode } from '../ir/types';
import { getContainerVisualConfig } from '../containers/registry';
import { isOrthogonal, resolveConnectionAnchor } from './anchors';
import { compareStable } from './visualMetrics';

export interface LayoutFinding {
  code: string;
  severity: 'blocking' | 'warning';
  entityIds: string[];
  geometry?: unknown;
}

export interface LayoutAuditInput {
  nodes: IRNode[];
  containers: IRContainer[];
  connections: IRConnection[];
  nodeBoxes: Record<string, Rect>;
  containerBoxes: Record<string, Rect>;
  connectionPresentations: Record<string, ConnectionPresentation>;
  contentTops?: Record<string, number>;
}

function finiteRect(rect: Rect | undefined): rect is Rect {
  return Boolean(rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0);
}

function intersects(a: Rect, b: Rect, epsilon = 0.01): boolean {
  return a.x < b.x + b.width - epsilon && a.x + a.width > b.x + epsilon && a.y < b.y + b.height - epsilon && a.y + a.height > b.y + epsilon;
}

function overlapSize(a: Rect, b: Rect) {
  return { x: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)), y: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) };
}

function segmentHitsRect(a: { x: number; y: number }, b: { x: number; y: number }, rect: Rect): boolean {
  if (Math.abs(a.x - b.x) <= 1) return a.x > rect.x + 1 && a.x < rect.x + rect.width - 1 && Math.max(a.y, b.y) > rect.y + 1 && Math.min(a.y, b.y) < rect.y + rect.height - 1;
  if (Math.abs(a.y - b.y) <= 1) return a.y > rect.y + 1 && a.y < rect.y + rect.height - 1 && Math.max(a.x, b.x) > rect.x + 1 && Math.min(a.x, b.x) < rect.x + rect.width - 1;
  return true;
}

function containerAncestors(id: string | undefined, containers: Map<string, IRContainer>): Set<string> {
  const result = new Set<string>();
  let current = id;
  while (current && !result.has(current)) {
    result.add(current);
    current = containers.get(current)?.parentId;
  }
  return result;
}

export function auditLayout(input: LayoutAuditInput): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  for (const node of input.nodes) if (!finiteRect(input.nodeBoxes[node.id])) findings.push({ code: 'LAYOUT_NODE_GEOMETRY_INVALID', severity: 'blocking', entityIds: [node.id], geometry: input.nodeBoxes[node.id] });
  for (const container of input.containers) if (!finiteRect(input.containerBoxes[container.id])) findings.push({ code: 'LAYOUT_CONTAINER_GEOMETRY_INVALID', severity: 'blocking', entityIds: [container.id], geometry: input.containerBoxes[container.id] });

  const containers = new Map(input.containers.map(container => [container.id, container]));
  const nodeById = new Map(input.nodes.map(node => [node.id, node]));
  for (const node of input.nodes) {
    const parentId = node.containerId;
    if (!parentId) continue;
    const parent = containers.get(parentId);
    const child = input.nodeBoxes[node.id];
    const box = input.containerBoxes[parentId];
    if (!parent || !finiteRect(child) || !finiteRect(box)) continue;
    const config = getContainerVisualConfig(parent.type);
    const contentTop = input.contentTops?.[parentId] ?? config.topPadding;
    const inside = child.x >= box.x + config.sidePadding - 1 && child.y >= box.y + contentTop - 1 && child.x + child.width <= box.x + box.width - config.sidePadding + 1 && child.y + child.height <= box.y + box.height - config.bottomPadding + 1;
    if (!inside) findings.push({ code: 'LAYOUT_PARENT_CONTENT_OVERFLOW', severity: 'blocking', entityIds: [node.id, parentId], geometry: { child, parent: box, contentTop } });
  }
  for (const container of input.containers) {
    if (!container.parentId) continue;
    const parent = containers.get(container.parentId);
    const child = input.containerBoxes[container.id];
    const box = input.containerBoxes[container.parentId];
    if (!parent || !finiteRect(child) || !finiteRect(box)) continue;
    const config = getContainerVisualConfig(parent.type);
    const contentTop = input.contentTops?.[parent.id] ?? config.topPadding;
    const inside = child.x >= box.x + config.sidePadding - 1 && child.y >= box.y + contentTop - 1 && child.x + child.width <= box.x + box.width - config.sidePadding + 1 && child.y + child.height <= box.y + box.height - config.bottomPadding + 1;
    if (!inside) findings.push({ code: 'LAYOUT_PARENT_CONTENT_OVERFLOW', severity: 'blocking', entityIds: [container.id, parent.id], geometry: { child, parent: box, contentTop } });
  }

  const siblings = new Map<string, Array<{ id: string; kind: 'node' | 'container'; box: Rect }>>();
  for (const node of input.nodes) {
    const box = input.nodeBoxes[node.id];
    if (finiteRect(box)) siblings.set(node.containerId ?? '', [...(siblings.get(node.containerId ?? '') ?? []), { id: node.id, kind: 'node', box }]);
  }
  for (const container of input.containers) {
    const box = input.containerBoxes[container.id];
    if (finiteRect(box)) siblings.set(container.parentId ?? '', [...(siblings.get(container.parentId ?? '') ?? []), { id: container.id, kind: 'container', box }]);
  }
  for (const entries of siblings.values()) {
    entries.sort((a, b) => compareStable(a.id, b.id));
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      if (intersects(entries[i].box, entries[j].box)) findings.push({ code: 'LAYOUT_SIBLING_OVERLAP', severity: 'blocking', entityIds: [entries[i].id, entries[j].id], geometry: overlapSize(entries[i].box, entries[j].box) });
    }
  }

  const connectionIds = new Set(input.connections.map(connection => connection.id));
  for (const id of Object.keys(input.connectionPresentations)) if (!connectionIds.has(id)) findings.push({ code: 'LAYOUT_ROUTE_ORPHAN', severity: 'blocking', entityIds: [id] });
  for (const connection of input.connections) {
    const route: ConnectionRoute | undefined = input.connectionPresentations[connection.id]?.route;
    if (!route) {
      findings.push({ code: 'LAYOUT_ROUTE_MISSING', severity: 'blocking', entityIds: [connection.id] });
      continue;
    }
    if (route.points.length < 2 || route.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      findings.push({ code: 'LAYOUT_ROUTE_INVALID', severity: 'blocking', entityIds: [connection.id] });
      continue;
    }
    let orthogonal = true;
    for (let i = 1; i < route.points.length; i++) if (!isOrthogonal(route.points[i - 1], route.points[i])) orthogonal = false;
    if (!orthogonal) findings.push({ code: 'LAYOUT_ROUTE_NON_ORTHOGONAL', severity: 'blocking', entityIds: [connection.id], geometry: route.points });
    if (route.label && !finiteRect(route.label)) findings.push({ code: 'LAYOUT_LABEL_GEOMETRY_INVALID', severity: 'blocking', entityIds: [connection.id], geometry: route.label });

    const source = nodeById.get(connection.source); const target = nodeById.get(connection.target);
    const sourceBox = input.nodeBoxes[connection.source]; const targetBox = input.nodeBoxes[connection.target];
    if (!source || !target || !finiteRect(sourceBox) || !finiteRect(targetBox)) continue;
    const presentation = input.connectionPresentations[connection.id] ?? {};
    const sourceAnchor = resolveConnectionAnchor(sourceBox, presentation.sourceSide ?? 'right', 'source');
    const targetAnchor = resolveConnectionAnchor(targetBox, presentation.targetSide ?? 'left', 'target');
    if (Math.hypot(route.points[0].x - sourceAnchor.x, route.points[0].y - sourceAnchor.y) > 1 || Math.hypot(route.points.at(-1)!.x - targetAnchor.x, route.points.at(-1)!.y - targetAnchor.y) > 1) {
      findings.push({ code: 'LAYOUT_ROUTE_ANCHOR_MISMATCH', severity: 'blocking', entityIds: [connection.id], geometry: { actualStart: route.points[0], expectedStart: sourceAnchor, actualEnd: route.points.at(-1), expectedEnd: targetAnchor } });
    }
    const endpointIds = new Set([connection.source, connection.target]);
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]; const b = route.points[i];
      for (const node of input.nodes) {
        if (endpointIds.has(node.id)) continue;
        const box = input.nodeBoxes[node.id];
        if (finiteRect(box) && segmentHitsRect(a, b, box)) findings.push({ code: 'LAYOUT_ROUTE_NODE_COLLISION', severity: 'blocking', entityIds: [connection.id, node.id], geometry: { a, b, obstacle: box } });
      }
      for (const container of input.containers) {
        const box = input.containerBoxes[container.id];
        if (!finiteRect(box)) continue;
        const config = getContainerVisualConfig(container.type);
        const header = { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, input.contentTops?.[container.id] ?? config.topPadding) };
        if (segmentHitsRect(a, b, header)) findings.push({ code: 'LAYOUT_ROUTE_HEADER_COLLISION', severity: 'blocking', entityIds: [connection.id, container.id], geometry: { a, b, obstacle: header } });
        const allowed = new Set([
          ...containerAncestors(source.containerId, containers),
          ...containerAncestors(target.containerId, containers)
        ]);
        if (!allowed.has(container.id) && segmentHitsRect(a, b, box)) findings.push({ code: 'LAYOUT_ROUTE_UNRELATED_CONTAINER_COLLISION', severity: 'blocking', entityIds: [connection.id, container.id], geometry: { a, b, obstacle: box } });
      }
    }
    const labelText = connection.label ?? '';
    if (labelText.trim() && !route.label) findings.push({ code: 'LAYOUT_LABEL_MISSING', severity: 'blocking', entityIds: [connection.id] });
    if (!labelText.trim() && route.label) findings.push({ code: 'LAYOUT_EMPTY_LABEL_RECT', severity: 'blocking', entityIds: [connection.id], geometry: route.label });
    if (route.label) {
      for (const node of input.nodes) {
        const box = input.nodeBoxes[node.id];
        if (finiteRect(box) && intersects(route.label, box, 4)) findings.push({ code: 'LAYOUT_LABEL_NODE_COLLISION', severity: 'blocking', entityIds: [connection.id, node.id], geometry: { label: route.label, obstacle: box } });
      }
      for (const container of input.containers) {
        const box = input.containerBoxes[container.id];
        if (!finiteRect(box)) continue;
        const config = getContainerVisualConfig(container.type);
        const header = { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, input.contentTops?.[container.id] ?? config.topPadding) };
        if (intersects(route.label, header, 4)) findings.push({ code: 'LAYOUT_LABEL_HEADER_COLLISION', severity: 'blocking', entityIds: [connection.id, container.id], geometry: { label: route.label, obstacle: header } });
        const allowed = new Set([
          ...containerAncestors(source.containerId, containers),
          ...containerAncestors(target.containerId, containers)
        ]);
        if (!allowed.has(container.id) && intersects(route.label, box, 4)) findings.push({ code: 'LAYOUT_LABEL_UNRELATED_CONTAINER_COLLISION', severity: 'blocking', entityIds: [connection.id, container.id], geometry: { label: route.label, obstacle: box } });
      }
      const paddedLabel = { x: route.label.x - 2, y: route.label.y - 2, width: route.label.width + 4, height: route.label.height + 4 };
      for (const other of input.connections) {
        if (other.id === connection.id) continue;
        const otherRoute = input.connectionPresentations[other.id]?.route;
        if (!otherRoute) continue;
        for (let i = 1; i < otherRoute.points.length; i++) {
          if (segmentHitsRect(otherRoute.points[i - 1], otherRoute.points[i], paddedLabel)) {
            findings.push({ code: 'LAYOUT_LABEL_ROUTE_COLLISION', severity: 'blocking', entityIds: [connection.id, other.id], geometry: { label: route.label, segment: [otherRoute.points[i - 1], otherRoute.points[i]] } });
          }
        }
        if (otherRoute.label && compareStable(connection.id, other.id) < 0 && intersects(route.label, otherRoute.label, 4)) {
          findings.push({ code: 'LAYOUT_LABEL_OVERLAP', severity: 'blocking', entityIds: [connection.id, other.id], geometry: { first: route.label, second: otherRoute.label } });
        }
      }
    }
  }
  return findings;
}
