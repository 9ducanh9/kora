import assert from 'node:assert/strict';
import { adoptUserNodes, nodeHasDimensions } from '@xyflow/system';
import type { Node, InternalNode } from '@xyflow/react';
import { retainFlowMeasurements } from '../src/core/editor/flowNodeGeometry';

const lookup = new Map<string, InternalNode>();
const parents = new Map();
const handles = { source: [{ id: 'right-source', type: 'source' as const, nodeId: 'a', x: 92, y: 36, width: 8, height: 8, position: 'right' as never }], target: [] };
const initial: Node = { id: 'a', position: { x: 0, y: 0 }, width: 96, height: 80, data: {}, measured: { width: 96, height: 80 } };
adoptUserNodes([initial], lookup, parents);
lookup.get('a')!.internals.handleBounds = handles;
for (let x = 1; x <= 60; x++) {
  const moved = retainFlowMeasurements({ ...initial, measured: undefined, position: { x, y: 0 }, data: { label: 'A' } }, lookup.get('a'));
  adoptUserNodes([moved], lookup, parents);
  assert.equal(nodeHasDimensions(lookup.get('a')!), true, 'drag must not hide a node');
  assert.equal(lookup.get('a')!.internals.handleBounds, handles, 'drag must not drop edge endpoints');
}
const resized = retainFlowMeasurements({ ...initial, measured: undefined, width: 128 }, lookup.get('a'));
assert.equal(resized.measured, undefined, 'size changes must discard stale DOM measurements');
adoptUserNodes([resized], lookup, parents);
assert.equal(nodeHasDimensions(lookup.get('a')!), true, 'explicit dimensions keep resized nodes visible while remeasuring');
assert.equal(lookup.get('a')!.internals.handleBounds, undefined, 'resizes must refresh edge endpoints');
assert.equal(retainFlowMeasurements(initial).measured, initial.measured);
console.log('[PASS] 60 controlled drag updates retain visible nodes and edge endpoints; resizes remeasure.');
