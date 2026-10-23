import { KoraArchitectureModel } from '../../../src/core/ir/types';

export const STRESS_LAYOUT_SEED = 0x4b4f5241;

export function createStressLayoutModel(seed = STRESS_LAYOUT_SEED): KoraArchitectureModel {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const containers: KoraArchitectureModel['containers'] = [];
  const levels: string[][] = [];
  for (let i = 0; i < 4; i++) {
    const id = `stress-root-${i}`;
    containers.push({ id, label: `Stress Root ${i}`, type: 'generic-group' });
    levels[0] ??= []; levels[0].push(id);
  }
  for (let depth = 1; depth <= 4; depth++) {
    levels[depth] = [];
    const parentLevel = levels[depth - 1];
    for (let index = 0; index < 4; index++) {
      const id = `stress-depth-${depth}-${index}`;
      const parentId = parentLevel[index % parentLevel.length];
      containers.push({ id, label: `Stress Group ${depth}.${index}`, type: 'generic-group', parentId });
      levels[depth].push(id);
    }
  }
  const nodes: KoraArchitectureModel['nodes'] = Array.from({ length: 100 }, (_, index) => ({
    id: `stress-node-${String(index).padStart(3, '0')}`,
    label: index % 9 === 0 ? `Worker ${index} — primary processing service` : `Service ${index}`,
    kind: 'generic',
    assetId: 'generic.component',
    ...(index % 13 === 0 ? {} : { containerId: containers[Math.floor(next() * containers.length)].id })
  }));
  const connections: KoraArchitectureModel['connections'] = Array.from({ length: 150 }, (_, index) => {
    const source = Math.floor(next() * nodes.length);
    let target = Math.floor(next() * nodes.length);
    if (index % 17 === 0) target = source;
    return {
      id: `stress-edge-${String(index).padStart(3, '0')}`,
      source: nodes[source].id,
      target: nodes[target].id,
      relationship: index % 3 === 0 ? 'event' : index % 3 === 1 ? 'data' : 'request',
      label: index % 4 === 0 ? `Flow ${index} with stable stress label` : ''
    };
  });
  return { version: '1.0', nodes, connections, containers };
}
