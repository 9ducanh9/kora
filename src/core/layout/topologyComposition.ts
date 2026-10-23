import { KoraArchitectureModel, IRConnection } from '../ir/types';
import { Rect } from '../diagram/types';
import { getContainerVisualConfig } from '../containers/registry';
import { compareStable, VisualMetricsSnapshot } from './visualMetrics';

/** Collapse cycles before ranking so responses cannot make a DAG walk diverge. */
export function topologyRanks(ids: string[], edges: IRConnection[]): Map<string, number> {
  const allowed = new Set(ids), adjacency = new Map(ids.map(id => [id, [] as string[]]));
  for (const edge of edges) if (allowed.has(edge.source) && allowed.has(edge.target) && edge.source !== edge.target) adjacency.get(edge.source)!.push(edge.target);
  let sequence = 0;
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], active = new Set<string>(), components: string[][] = [];
  const visit = (id: string) => {
    index.set(id, sequence); low.set(id, sequence++); stack.push(id); active.add(id);
    for (const target of [...adjacency.get(id)!].sort(compareStable)) {
      if (!index.has(target)) { visit(target); low.set(id, Math.min(low.get(id)!, low.get(target)!)); }
      else if (active.has(target)) low.set(id, Math.min(low.get(id)!, index.get(target)!));
    }
    if (low.get(id) === index.get(id)) {
      const component: string[] = [];
      let member: string;
      do { member = stack.pop()!; active.delete(member); component.push(member); } while (member !== id);
      components.push(component);
    }
  };
  for (const id of [...ids].sort(compareStable)) if (!index.has(id)) visit(id);
  const componentById = new Map(components.flatMap((members, component) => members.map(id => [id, component] as const)));
  const incoming = components.map(() => new Set<number>());
  for (const edge of edges) {
    const a = componentById.get(edge.source), b = componentById.get(edge.target);
    if (a !== undefined && b !== undefined && a !== b) incoming[b].add(a);
  }
  const ranks = new Map<number, number>();
  const rank = (component: number): number => {
    if (!ranks.has(component)) ranks.set(component, Math.max(0, ...[...incoming[component]].map(parent => rank(parent) + 1)));
    return ranks.get(component)!;
  };
  return new Map(ids.map(id => [id, rank(componentById.get(id)!)]));
}

/** Pack only presentation subtrees; never change a declared semantic parent. */
export function fitComposition(model: KoraArchitectureModel, metrics: VisualMetricsSnapshot, nodes: Record<string, Rect>): { nodes: Record<string, Rect>; containers: Record<string, Rect> } | undefined {
  const containers: Record<string, Rect> = {};
  const childContainers = new Map<string, string[]>(), childNodes = new Map<string, string[]>();
  for (const container of model.containers) childContainers.set(container.parentId ?? '', [...(childContainers.get(container.parentId ?? '') ?? []), container.id]);
  for (const node of model.nodes) childNodes.set(node.containerId ?? '', [...(childNodes.get(node.containerId ?? '') ?? []), node.id]);
  const box = (id: string, container: boolean) => container ? containers[id] : nodes[id];
  const move = (id: string, container: boolean, dy: number) => {
    box(id, container).y += dy;
    if (container) {
      for (const child of childNodes.get(id) ?? []) move(child, false, dy);
      for (const child of childContainers.get(id) ?? []) move(child, true, dy);
    }
  };
  const pack = (parent: string) => {
    const units = [...(childContainers.get(parent) ?? []).map(id => ({ id, container: true })), ...(childNodes.get(parent) ?? []).map(id => ({ id, container: false }))];
    units.sort((a, b) => box(a.id, a.container).y - box(b.id, b.container).y || box(a.id, a.container).x - box(b.id, b.container).x || compareStable(a.id, b.id));
    const placed: Rect[] = [];
    for (const unit of units) {
      const current = box(unit.id, unit.container);
      for (let attempt = 0; attempt <= placed.length; attempt++) {
        const conflicts = placed.filter(other => current.x < other.x + other.width + 28 && current.x + current.width + 28 > other.x && current.y < other.y + other.height + 28 && current.y + current.height + 28 > other.y);
        if (!conflicts.length) break;
        move(unit.id, unit.container, Math.max(...conflicts.map(other => other.y + other.height + 28)) - current.y);
      }
      placed.push(current);
    }
    return placed;
  };
  const pending = new Set(model.containers.map(container => container.id));
  while (pending.size) {
    let changed = false;
    for (const container of model.containers) {
      if (!pending.has(container.id) || (childContainers.get(container.id) ?? []).some(id => pending.has(id))) continue;
      const boxes = pack(container.id), config = getContainerVisualConfig(container.type), measured = metrics.containers[container.id];
      if (!boxes.length) {
        // An explicitly empty boundary still gets visible geometry and a header.
        containers[container.id] = { x: 80, y: 80, width: measured?.width ?? 180, height: measured?.height ?? 100 };
      } else {
        const x = Math.min(...boxes.map(b => b.x)) - config.sidePadding - 24;
        const y = Math.min(...boxes.map(b => b.y)) - Math.max(config.topPadding, measured?.contentTop ?? 0) - 24;
        containers[container.id] = { x, y, width: Math.max(measured?.width ?? 180, Math.max(...boxes.map(b => b.x + b.width)) - x + config.sidePadding + 24), height: Math.max(...boxes.map(b => b.y + b.height)) - y + config.bottomPadding + 24 };
      }
      pending.delete(container.id); changed = true;
    }
    if (!changed) return undefined;
  }
  pack('');
  const all = [...Object.values(nodes), ...Object.values(containers)];
  const dx = 80 - Math.min(...all.map(b => b.x)), dy = 80 - Math.min(...all.map(b => b.y));
  for (const b of all) { b.x += dx; b.y += dy; }
  return { nodes, containers };
}

/** Generic topology recipe for multi-backend, serverless, event and data diagrams. */
export function composeTopology(model: KoraArchitectureModel, metrics: VisualMetricsSnapshot, roles: Map<string, string>) {
  const web = [...roles.values()].includes('actor') && [...roles.values()].some(role => role === 'ingress' || role === 'compute');
  const auxiliary = new Set(['identity', 'operations', 'media', 'hosting', 'dns']);
  let main = model.nodes.filter(node => !auxiliary.has(roles.get(node.id)!));
  if (!main.length) main = model.nodes;
  const mainIds = new Set(main.map(node => node.id));
  const order: Record<string, number> = { actor: 0, ingress: 1, compute: 2, service: 3, storage: 4, external: 3 };
  const edges = model.connections.filter(edge => {
    if (!mainIds.has(edge.source) || !mainIds.has(edge.target) || edge.relationship === 'association' || /\bstage=(startup|deployment)\b/u.test(edge.description ?? '')) return false;
    if (edge.relationship === 'data' && model.connections.some(other => other.source === edge.target && other.target === edge.source && other.relationship === 'request')) return false;
    if (web && edge.relationship === 'data' && (order[roles.get(edge.source)!] ?? 0) > (order[roles.get(edge.target)!] ?? 0)) return false;
    return true;
  });
  const ranks = topologyRanks(main.map(node => node.id), edges);
  const widest = Math.max(192, ...Object.values(metrics.nodes).map(b => b.width));
  const tallest = Math.max(110, ...Object.values(metrics.nodes).map(b => b.height));
  const col = widest + 220, row = tallest + 160;
  const nodes: Record<string, Rect> = {}, layers = new Map<number, typeof main>();
  for (const node of main) { const rank = ranks.get(node.id)!; layers.set(rank, [...(layers.get(rank) ?? []), node]); }
  const mainY = row * 2 + 200;
  const stable = (a: typeof main[number], b: typeof main[number]) => compareStable(a.assetId ?? a.label, b.assetId ?? b.label) || compareStable(a.label, b.label) || compareStable(a.id, b.id);
  const put = (id: string, x: number, y: number) => { const b = metrics.nodes[id]; nodes[id] = { x, y, width: b.width, height: b.height }; };
  for (const [rank, layer] of layers) layer.sort(stable).forEach((node, index) => put(node.id, 80 + rank * col, mainY + index * row));
  const lastRank = Math.max(0, ...ranks.values()), bottom = Math.max(...Object.values(nodes).map(b => b.y + b.height)) + row;
  const groups = new Map<string, typeof main>();
  for (const node of model.nodes.filter(node => !nodes[node.id])) { const kind = roles.get(node.id)!; groups.set(kind, [...(groups.get(kind) ?? []), node]); }
  for (const [kind, group] of groups) group.sort(stable).forEach((node, index) => {
    const inside = Boolean(node.containerId);
    if (kind === 'operations') put(node.id, 80 + col * (inside ? 1 + index % Math.max(1, lastRank) : 0), bottom + Math.floor(index / Math.max(1, lastRank)) * row);
    else if (kind === 'media') put(node.id, 80 + col * (1 + index), 80);
    else if (kind === 'identity') put(node.id, 80 + col * (1 + index), mainY - row * 1.5);
    else put(node.id, 80 + col * index, kind === 'hosting' ? 80 : 80 + row);
  });
  return fitComposition(model, metrics, nodes);
}
