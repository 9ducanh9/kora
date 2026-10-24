import assert from 'node:assert/strict';
import { createEmptyDiagramDocument } from '../src/core/diagram/types';
import { validateDiagramDocument, decodeDiagramDocument } from '../src/core/diagram/validator';

const document = createEmptyDiagramDocument('Resource boundaries');
document.semantic.nodes.a = { id: 'a', label: 'a'.repeat(10_001), kind: 'generic' };
document.presentation.nodes.a = { x: 0, y: 0, width: 96, height: 80 };
assert.equal(validateDiagramDocument(document).ok, false, 'visible text is bounded before rendering');
document.semantic.nodes.a.label = 'Accepted';
assert.equal(validateDiagramDocument(document).ok, true);
assert.equal(decodeDiagramDocument(' '.repeat(10 * 1024 * 1024 + 1)).ok, false, 'byte guard precedes JSON parsing');
for (let i = 0; i < 65; i++) {
  const id = `group-${i}`;
  document.semantic.containers[id] = { id, type: 'generic-group', label: id, ...(i ? { parentId: `group-${i - 1}` } : {}) };
  document.presentation.containers[id] = { x: 0, y: 0, width: 200, height: 200 };
}
assert.equal(validateDiagramDocument(document).ok, false, 'deep containment is rejected before recursive validation');
console.log('PASS document import resource boundaries');
