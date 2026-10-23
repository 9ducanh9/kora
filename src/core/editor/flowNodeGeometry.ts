import type { Node } from '@xyflow/react';

/** Keep React Flow's DOM measurements when a controlled update only moves a node. */
export function retainFlowMeasurements(node: Node, previous?: Node): Node {
  if (node.width !== previous?.width || node.height !== previous?.height) return node;
  return previous?.measured ? { ...node, measured: previous.measured } : node;
}
