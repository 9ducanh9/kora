import { DiagramDocument } from '../diagram/types';
import { DiagramMove } from './commands';

export type DiagramPosition = { x: number; y: number };

/** Calculates an immutable drag preview; the command engine is changed only on commit. */
export function previewMovement(
  moves: Record<string, DiagramMove>,
  anchorId: string,
  pointerId: string,
  pointerPosition: DiagramPosition,
  snapToGrid: boolean,
  gridSize = 20
): { positions: Record<string, DiagramPosition>; delta: DiagramPosition } {
  const anchor = moves[anchorId];
  const pointer = moves[pointerId];
  if (!anchor || !pointer) return { positions: {}, delta: { x: 0, y: 0 } };

  let x = pointerPosition.x - pointer.from.x;
  let y = pointerPosition.y - pointer.from.y;
  if (snapToGrid) {
    x = Math.round((anchor.from.x + x) / gridSize) * gridSize - anchor.from.x;
    y = Math.round((anchor.from.y + y) / gridSize) * gridSize - anchor.from.y;
  }

  const positions: Record<string, DiagramPosition> = {};
  for (const [id, move] of Object.entries(moves)) {
    positions[id] = { x: move.from.x + x, y: move.from.y + y };
  }
  return { positions, delta: { x, y } };
}

/** Returns the semantic movement closure for explicitly selected nodes and containers. */
export function buildMovementClosure(doc: DiagramDocument, selectedIds: string[]): Record<string, DiagramMove> {
  const containerIds = new Set(selectedIds.filter(id => Object.prototype.hasOwnProperty.call(doc.semantic.containers, id)));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const container of Object.values(doc.semantic.containers)) {
      if (container.parentId && containerIds.has(container.parentId) && !containerIds.has(container.id)) {
        containerIds.add(container.id);
        expanded = true;
      }
    }
  }

  const nodeIds = new Set(selectedIds.filter(id => Object.prototype.hasOwnProperty.call(doc.semantic.nodes, id)));
  for (const node of Object.values(doc.semantic.nodes)) if (node.containerId && containerIds.has(node.containerId)) nodeIds.add(node.id);

  const moves: Record<string, DiagramMove> = {};
  for (const id of [...nodeIds].sort()) {
    const box = doc.presentation.nodes[id];
    if (box) moves[id] = { kind: 'node', from: { x: box.x, y: box.y }, to: { x: box.x, y: box.y } };
  }
  for (const id of [...containerIds].sort()) {
    const box = doc.presentation.containers[id];
    if (box) moves[id] = { kind: 'container', from: { x: box.x, y: box.y }, to: { x: box.x, y: box.y } };
  }
  return moves;
}
