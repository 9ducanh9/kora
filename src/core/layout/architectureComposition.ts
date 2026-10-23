import { KoraArchitectureModel, IRNode } from '../ir/types';
import { ConnectionSide, Rect } from '../diagram/types';
import { getContainerVisualConfig } from '../containers/registry';
import { compareStable, VisualMetricsSnapshot } from './visualMetrics';
import { composeTopology } from './topologyComposition';

export interface ArchitectureComposition { nodes: Record<string, Rect>; containers: Record<string, Rect> }
type Role = 'actor' | 'ingress' | 'compute' | 'identity' | 'storage' | 'service' | 'operations' | 'media' | 'hosting' | 'dns' | 'external';
const ingress = (node: IRNode) => /^aws\.(elb\.|apigateway|cloudfront)/u.test(node.assetId ?? '');
const compute = (node: IRNode) => /^aws\.(ecs|eks|ec2|lambda|apprunner)(\.|$)/u.test(node.assetId ?? '');

/** Shared composition policy for bounded diagrams; larger graphs keep the compound ELK strategy. */
export function supportsArchitectureComposition(model: KoraArchitectureModel): boolean {
  return model.nodes.length > 0 && model.nodes.length <= 80;
}

/** Presentation-only role composition. Every node, edge and declared parent stays intact. */
export function composeArchitecture(model: KoraArchitectureModel, metrics: VisualMetricsSnapshot): ArchitectureComposition | undefined {
  if (!supportsArchitectureComposition(model)) return undefined;
  const role = (node: IRNode): Role => {
    const asset = node.assetId ?? '';
    if (node.kind === 'actor' || asset === 'external.user') return 'actor';
    if (ingress(node)) return 'ingress';
    if (compute(node)) return 'compute';
    if (/^aws\.(cognito|iam)(\.|$)/u.test(asset)) return 'identity';
    if (/^aws\.(cloudwatch|ecr|secretsmanager|ssm)(\.|$)/u.test(asset)) return 'operations';
    if (/^aws\.(s3|dynamodb|rds|aurora|elasticache)(\.|$)/u.test(asset)) return 'storage';
    if (asset.startsWith('aws.')) return 'service';
    const incident = model.connections.filter(edge => edge.source === node.id || edge.target === node.id);
    if (incident.some(edge => /\b(WebRTC|SFU)\b/iu.test(edge.label ?? ''))) return 'media';
    if (/\bDNS\b/iu.test(node.label)) return 'dns';
    if (incident.some(edge => /\bstage=delivery\b/u.test(edge.description ?? '')) && /frontend|hosting|host frontend/iu.test(node.label)) return 'hosting';
    if (!incident.length || incident.every(edge => /\bstage=(startup|deployment)\b/u.test(edge.description ?? ''))) return 'operations';
    return 'external';
  };
  const groups = new Map<Role, IRNode[]>();
  const roles = new Map(model.nodes.map(node => [node.id, role(node)]));
  const simpleWeb = model.nodes.filter(ingress).length === 1 && model.nodes.filter(compute).length === 1 && model.nodes.some(node => roles.get(node.id) === 'actor');
  if (!simpleWeb) return composeTopology(model, metrics, roles);
  for (const node of model.nodes) groups.set(role(node), [...(groups.get(role(node)) ?? []), node]);
  for (const group of groups.values()) group.sort((a, b) => compareStable(a.assetId ?? a.label, b.assetId ?? b.label) || compareStable(a.id, b.id));
  // Adapt the grid to measured text, including long labels and nested headers.
  const widest = Math.max(192, ...Object.values(metrics.nodes).map(box => box.width));
  const tallest = Math.max(110, ...Object.values(metrics.nodes).map(box => box.height));
  const col = widest + 220;
  const row = tallest + 140;
  const coreY = row * 2 + 200;
  const nodes: Record<string, Rect> = {};
  const put = (node: IRNode, x: number, centerY: number) => {
    const box = metrics.nodes[node.id];
    nodes[node.id] = { x, y: centerY - box.height / 2, width: box.width, height: box.height };
  };
  for (const [kind, group] of groups) group.forEach((node, index) => {
    switch (kind) {
      case 'actor': put(node, 60, coreY + index * row); break;
      case 'ingress': put(node, 60 + col, coreY); break;
      case 'compute': put(node, 60 + col * 2, coreY); break;
      case 'identity': put(node, 60 + col * (1 + index % 2), coreY - row * (1.5 + Math.floor(index / 2))); break;
      case 'service': put(node, 60 + col * (3 + Math.floor(index / 3)), coreY + (index % 3 - 1) * row); break;
      case 'storage': put(node, 60 + col * (4 + Math.floor(index / 3)), coreY + (index % 3 - 1) * row); break;
      case 'media': put(node, 60 + col * (2 + index), 110); break;
      case 'hosting': put(node, 60, 110 + index * row); break;
      case 'dns': put(node, 60 + col, 110 + index * row); break;
      case 'operations': {
        const inCloud = node.assetId?.startsWith('aws.');
        put(node, 60 + col * (inCloud ? 1 + index % 4 : 0), coreY + row * (2 + Math.floor(index / 4))); break;
      }
      default: put(node, 60 + col * 5, coreY + index * row); break;
    }
  });
  // A subtree is a rigid group for collision detection; never change membership to fit a lane.
  const containers: Record<string, Rect> = {};
  const pending = new Set(model.containers.map(container => container.id));
  while (pending.size) {
    let changed = false;
    for (const container of model.containers) {
      if (!pending.has(container.id)) continue;
      const children = model.containers.filter(child => child.parentId === container.id);
      if (children.some(child => pending.has(child.id))) continue;
      const boxes = [...model.nodes.filter(node => node.containerId === container.id).map(node => nodes[node.id]), ...children.map(child => containers[child.id])];
      if (!boxes.length) return composeTopology(model, metrics, roles);
      const config = getContainerVisualConfig(container.type);
      const top = Math.max(config.topPadding, metrics.containers[container.id]?.contentTop ?? 0) + 24;
      const left = Math.min(...boxes.map(box => box.x)) - config.sidePadding - 24;
      const y = Math.min(...boxes.map(box => box.y)) - top;
      const right = Math.max(...boxes.map(box => box.x + box.width)) + config.sidePadding + 24;
      const bottom = Math.max(...boxes.map(box => box.y + box.height)) + config.bottomPadding + 24;
      containers[container.id] = { x: left, y, width: Math.max(right - left, metrics.containers[container.id]?.width ?? 0), height: bottom - y };
      pending.delete(container.id); changed = true;
    }
    if (!changed) return composeTopology(model, metrics, roles);
  }
  const siblings = new Map<string, Rect[]>();
  for (const node of model.nodes) siblings.set(node.containerId ?? '', [...(siblings.get(node.containerId ?? '') ?? []), nodes[node.id]]);
  for (const container of model.containers) siblings.set(container.parentId ?? '', [...(siblings.get(container.parentId ?? '') ?? []), containers[container.id]]);
  for (const boxes of siblings.values()) for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x < b.x + b.width + 24 && a.x + a.width + 24 > b.x && a.y < b.y + b.height + 24 && a.y + a.height + 24 > b.y) return composeTopology(model, metrics, roles);
  }
  // Normalize the whole composition to leave room for return routes around its perimeter.
  const all = [...Object.values(nodes), ...Object.values(containers)];
  const dx = 80 - Math.min(...all.map(box => box.x)), dy = 80 - Math.min(...all.map(box => box.y));
  for (const box of all) { box.x += dx; box.y += dy; }
  return { nodes, containers };
}

export function facingSides(source: Rect, target: Rect): { sourceSide: ConnectionSide; targetSide: ConnectionSide } {
  const dx = target.x + target.width / 2 - source.x - source.width / 2;
  const dy = target.y + target.height / 2 - source.y - source.height / 2;
  if (Math.abs(dy) > Math.abs(dx) * 1.25) return dy > 0 ? { sourceSide: 'bottom', targetSide: 'top' } : { sourceSide: 'top', targetSide: 'bottom' };
  return dx >= 0 ? { sourceSide: 'right', targetSide: 'left' } : { sourceSide: 'left', targetSide: 'right' };
}
