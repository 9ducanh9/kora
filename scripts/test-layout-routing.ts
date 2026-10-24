import { computeCompoundLayoutDetailed, normalizeSections, repairOrthogonalRoute } from '../src/core/layout/elkCompoundLayout';
import { PORT_ESCAPE_STUB, resolveConnectionAnchor, resolveEscapePoint } from '../src/core/layout/anchors';
import { cachedRouteForRender, createRouteInputSignature, routeCacheStatus, routeGeometryUsable } from '../src/core/layout/routeCache';
import { measureVisuals } from '../src/core/layout/visualMetrics';
import { KoraArchitectureModel } from '../src/core/ir/types';
import { ElkEdgeSection } from 'elkjs/lib/elk.bundled.js';
import { auditLayout } from '../src/core/layout/qualityAudit';
import { validateDiagramDocument } from '../src/core/diagram/validator';
import { ConnectionSide, Point, Rect } from '../src/core/diagram/types';
import { resolveConnectionGeometry } from '../src/core/layout/connectionGeometry';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[FAIL] ${message}`);
  console.log(`[PASS] ${message}`);
}

function crossesInterior(route: Array<{ x: number; y: number }>, box: { x: number; y: number; width: number; height: number }): boolean {
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]; const b = route[i];
    if (Math.abs(a.x - b.x) < 1 && a.x > box.x + 1 && a.x < box.x + box.width - 1 && Math.max(a.y, b.y) > box.y + 1 && Math.min(a.y, b.y) < box.y + box.height - 1) return true;
    if (Math.abs(a.y - b.y) < 1 && a.y > box.y + 1 && a.y < box.y + box.height - 1 && Math.max(a.x, b.x) > box.x + 1 && Math.min(a.x, b.x) < box.x + box.width - 1) return true;
  }
  return false;
}

function loopStaysOutside(points: Point[], box: Rect, side: ConnectionSide): boolean {
  const first = points[0]; const last = points.at(-1)!;
  const outgoing = points.find(point => Math.hypot(point.x - first.x, point.y - first.y) > 0.001);
  const incoming = [...points].reverse().find(point => Math.hypot(point.x - last.x, point.y - last.y) > 0.001);
  const outward = (point: Point | undefined, anchor: Point): boolean => Boolean(point && (side === 'left' ? point.x < anchor.x && point.y === anchor.y
    : side === 'right' ? point.x > anchor.x && point.y === anchor.y
      : side === 'top' ? point.y < anchor.y && point.x === anchor.x : point.y > anchor.y && point.x === anchor.x));
  const area = Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
  return outward(outgoing, first) && outward(incoming, last) && area > 1 && !crossesInterior(points, box);
}

async function run() {
  console.log('=== LAYOUT ROUTING REGRESSION ===');
  const anchorBox = { x: 10, y: 20, width: 100, height: 80 };
  const anchorChecks = (['top', 'right', 'bottom', 'left'] as const).flatMap(side => (['source', 'target'] as const).map(role => {
    const actual = resolveConnectionAnchor(anchorBox, side, role);
    const expected = side === 'top' ? { x: 60, y: 20 }
      : side === 'right' ? { x: 110, y: 60 }
        : side === 'bottom' ? { x: 60, y: 100 }
          : { x: 10, y: 60 };
    const escape = resolveEscapePoint(actual, side);
    return Math.hypot(actual.x - expected.x, actual.y - expected.y) < 0.001 && (side === 'top' ? actual.y - escape.y : side === 'right' ? escape.x - actual.x : side === 'bottom' ? escape.y - actual.y : actual.x - escape.x) === PORT_ESCAPE_STUB;
  }));
  assert(anchorChecks.every(Boolean), 'both handle roles use the side midpoint and an outward escape stub on all four sides');

  const alignedPairs: Array<{ name: string; source: Rect; target: Rect; sourceSide: ConnectionSide; targetSide: ConnectionSide }> = [];
  for (const unequal of [false, true]) {
    const horizontal = { x: 300, y: unequal ? 30 : 20, width: unequal ? 140 : 100, height: unequal ? 60 : 80 };
    const vertical = { x: unequal ? 20 : 10, y: 300, width: unequal ? 80 : 100, height: unequal ? 130 : 80 };
    const sizeName = unequal ? 'different sized' : 'equal sized';
    alignedPairs.push(
      { name: `${sizeName} left-to-right`, source: anchorBox, target: horizontal, sourceSide: 'right', targetSide: 'left' },
      { name: `${sizeName} right-to-left`, source: horizontal, target: anchorBox, sourceSide: 'left', targetSide: 'right' },
      { name: `${sizeName} top-to-bottom`, source: anchorBox, target: vertical, sourceSide: 'bottom', targetSide: 'top' },
      { name: `${sizeName} bottom-to-top`, source: vertical, target: anchorBox, sourceSide: 'top', targetSide: 'bottom' }
    );
  }
  for (const pair of alignedPairs) {
    const source = resolveConnectionAnchor(pair.source, pair.sourceSide, 'source');
    const target = resolveConnectionAnchor(pair.target, pair.targetSide, 'target');
    const geometry = resolveConnectionGeometry({ source, target, sourceSide: pair.sourceSide, targetSide: pair.targetSide });
    const horizontal = pair.sourceSide === 'left' || pair.sourceSide === 'right';
    const onLine = geometry.points.every(point => Math.abs(horizontal ? point.y - source.y : point.x - source.x) < 0.001);
    const length = geometry.points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - geometry.points[index].x, point.y - geometry.points[index].y), 0);
    assert(onLine && Math.abs(length - Math.hypot(target.x - source.x, target.y - source.y)) < 0.001, `${pair.name} center-aligned nodes render one straight connection without end staircases`);
  }

  const legacyModel: KoraArchitectureModel = {
    version: '1.0',
    nodes: [{ id: 'a', label: 'A', kind: 'generic', assetId: 'generic.component' }, { id: 'b', label: 'B', kind: 'generic', assetId: 'generic.component' }],
    containers: [], connections: [{ id: 'aligned', source: 'a', target: 'b', relationship: 'request' }]
  };
  const legacyBoxes = { a: { x: 0, y: 0, width: 100, height: 80 }, b: { x: 300, y: 0, width: 100, height: 80 } };
  // Captured from this fixture under the old 38%/62% handle profile.
  const oldSignature = '934216633102f70cee9e21aa9fbd9fc18ba095acb3c9f572ad53444e5a44cba3';
  const freshSignature = await createRouteInputSignature(legacyModel, legacyBoxes, {}, { aligned: { sourceSide: 'right', targetSide: 'left' } }, measureVisuals(legacyModel));
  const legacyRoute = { version: '1.0' as const, inputSignature: oldSignature, points: [{ x: 100, y: 49.6 }, { x: 200, y: 49.6 }, { x: 200, y: 30.4 }, { x: 300, y: 30.4 }] };
  assert(freshSignature !== oldSignature && routeCacheStatus(legacyRoute, freshSignature, undefined) === 'stale', 'saved routes from the 38%/62% profile are invalidated after centering handles');

  const loopSides = ['top', 'right', 'bottom', 'left'] as const;
  const loopModel: KoraArchitectureModel = {
    version: '1.0',
    nodes: loopSides.map(side => ({ id: `loop-${side}`, label: `Loop ${side}`, kind: 'generic', assetId: 'generic.component' })),
    containers: [],
    connections: loopSides.map(side => ({ id: `same-side-${side}`, source: `loop-${side}`, target: `loop-${side}`, relationship: 'event' }))
  };
  const loopResult = await computeCompoundLayoutDetailed(loopModel, {
    metrics: measureVisuals(loopModel),
    connectionPresentations: Object.fromEntries(loopSides.map(side => [`same-side-${side}`, { sourceSide: side, targetSide: side }]))
  });
  for (const side of loopSides) {
    const id = `loop-${side}`;
    const saved = loopResult.document.presentation.nodes[id];
    const box = { ...saved, width: saved.width ?? loopResult.metrics.nodes[id].width, height: saved.height ?? loopResult.metrics.nodes[id].height };
    const route = loopResult.document.presentation.connections?.[`same-side-${side}`]?.route;
    assert(Boolean(route && loopStaysOutside(route.points, box, side)), `centered ${side}-side self-loop keeps a visible exterior loop with normal entry and exit`);
  }
  const model: KoraArchitectureModel = {
    version: '1.0',
    nodes: [
      { id: 'source', label: 'WWW source label', kind: 'generic', assetId: 'generic.component' },
      { id: 'target', label: 'Target with a much longer subtitle', kind: 'generic', assetId: 'generic.component', subtitle: 'Combining e\u0301 and emoji 🧭' },
      { id: 'obstacle', label: 'Obstacle', kind: 'generic', assetId: 'generic.component' }
    ],
    containers: [],
    connections: [
      { id: 'parallel-a', source: 'source', target: 'target', relationship: 'request', label: 'First route label with enough words to wrap' },
      { id: 'parallel-b', source: 'source', target: 'target', relationship: 'data', label: 'Second route label' },
      { id: 'parallel-c', source: 'source', target: 'target', relationship: 'request', label: 'Third route label' },
      { id: 'reciprocal', source: 'target', target: 'source', relationship: 'request', label: 'Reverse' },
      { id: 'self-loop', source: 'target', target: 'target', relationship: 'event', label: 'Loop' },
      { id: 'self-loop-opposite', source: 'source', target: 'source', relationship: 'event', label: 'Opposite-side loop' }
    ]
  };
  const sides = {
    'parallel-a': { sourceSide: 'right' as const, targetSide: 'left' as const },
    'parallel-b': { sourceSide: 'bottom' as const, targetSide: 'top' as const },
    'parallel-c': { sourceSide: 'top' as const, targetSide: 'bottom' as const },
    reciprocal: { sourceSide: 'left' as const, targetSide: 'right' as const },
    'self-loop': { sourceSide: 'right' as const, targetSide: 'right' as const },
    'self-loop-opposite': { sourceSide: 'left' as const, targetSide: 'right' as const }
  };
  const candidates = await Promise.all((['RIGHT', 'DOWN'] as const).map(async direction => ({
    direction,
    result: await computeCompoundLayoutDetailed(model, { metrics: measureVisuals(model), connectionPresentations: sides, direction })
  })));
  for (const candidate of candidates) {
    assert(!candidate.result.findings.some(finding => finding.severity === 'blocking'), `F5 ${candidate.direction} has zero blocking route/label findings`);
    assert(Object.keys(candidate.result.document.presentation.connections ?? {}).length === model.connections.length, `F5 ${candidate.direction} retains parallel, reciprocal and both self-loop presentations`);
  }
  const result = candidates[0].result;
  const validation = validateDiagramDocument(result.document);
  assert(validation.ok, 'routing output satisfies strict Document schema and semantic validation');
  assert(!result.findings.some(finding => finding.severity === 'blocking'), `fixture routing has zero blocking findings (${result.findings.filter(finding => finding.severity === 'blocking').map(finding => finding.code).join(', ')})`);
  assert(Object.keys(result.document.presentation.connections ?? {}).length === model.connections.length, 'parallel, reciprocal and self connections each retain their own route record');
  for (const connection of model.connections) {
    const entry = result.document.presentation.connections?.[connection.id];
    const route = entry?.route;
    assert(Boolean(route), `${connection.id} has a cached route`);
    assert(route!.points.length >= 2, `${connection.id} route has at least two points`);
    assert(route!.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)), `${connection.id} route coordinates are finite`);
    for (let i = 1; i < route!.points.length; i++) assert(Math.abs(route!.points[i - 1].x - route!.points[i].x) < 1 || Math.abs(route!.points[i - 1].y - route!.points[i].y) < 1, `${connection.id} segment ${i} is orthogonal`);
    assert(Boolean(route!.label), `${connection.id} keeps a measured rectangle for its semantic label`);
    assert(/^[a-f0-9]{64}$/u.test(route!.inputSignature), `${connection.id} has a SHA-256 routing-input signature`);
    assert(routeCacheStatus(route, route!.inputSignature, connection.label) === 'usable', `${connection.id} cache matches its semantic label and signature`);
    assert(routeGeometryUsable(result.document, connection.id, route!, result.metrics), `${connection.id} route is attached to the shared source and target anchors`);
    assert(cachedRouteForRender(result.document, connection.id, route, route!.inputSignature, connection.label, result.metrics) === route, `${connection.id} usable cache is selected for ordinary rendering`);
    assert(cachedRouteForRender(result.document, connection.id, route, route!.inputSignature, connection.label, result.metrics, true) === undefined, `${connection.id} preview geometry never uses the committed route cache`);
  }
  assert((result.document.presentation.connections?.['self-loop']?.route?.points.length ?? 0) >= 4, 'self-loop remains visibly routed instead of collapsing to a point');
  assert((result.document.presentation.connections?.['self-loop-opposite']?.route?.points.length ?? 0) >= 4, 'opposite-side self-loop remains visibly routed');
  const parallelRouteKeys = ['parallel-a', 'parallel-b', 'parallel-c'].map(id => JSON.stringify(result.document.presentation.connections?.[id]?.route?.points));
  assert(new Set(parallelRouteKeys).size === 3, 'parallel edges remain separate selectable routes with stable lanes');

  const savedSource = result.document.presentation.nodes.source;
  const sourceBox = { ...savedSource, width: savedSource.width ?? result.metrics.nodes.source.width, height: savedSource.height ?? result.metrics.nodes.source.height };
  const routeStart = result.document.presentation.connections?.['parallel-b']?.route?.points[0];
  const expectedStart = resolveConnectionAnchor(sourceBox, 'bottom', 'source');
  assert(Math.hypot(routeStart!.x - expectedStart.x, routeStart!.y - expectedStart.y) <= 1, 'non-default bottom port starts at the rendered source handle');

  const obstacle = { x: 40, y: -10, width: 20, height: 20 };
  const repaired = repairOrthogonalRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, [obstacle], 'blocked-line');
  assert(Boolean(repaired) && !crossesInterior(repaired!, obstacle), 'bounded visibility repair routes around a blocking rectangle');

  const absolute = {
    start: { x: -20.5, y: 4 }, p1: { x: 130, y: 4 }, p2: { x: 130, y: 40 },
    p3: { x: 160, y: 40 }, p4: { x: 160, y: 80.5 }, end: { x: 100.25, y: 80.5 }
  };
  const offset = { x: 100, y: -40 };
  const local = (point: { x: number; y: number }) => ({ x: point.x - offset.x, y: point.y - offset.y });
  const section = (id: string, from: { x: number; y: number }, to: { x: number; y: number }): ElkEdgeSection => ({ id, startPoint: local(from), endPoint: local(to) });
  const shuffledSections = [
    section('s4-reversed', absolute.p4, absolute.p3),
    section('s2-reversed', absolute.p2, absolute.p1),
    section('s5-reversed', absolute.end, absolute.p4),
    section('s1', absolute.start, absolute.p1),
    section('s3', absolute.p2, absolute.p3)
  ];
  const normalizedSections = normalizeSections(shuffledSections, offset.x, offset.y, absolute.start, absolute.end);
  assert(JSON.stringify(normalizedSections) === JSON.stringify([absolute.start, absolute.p1, absolute.p2, absolute.p3, absolute.p4, absolute.end]), 'nested owner offsets are applied once while reversed ELK sections are reordered and joined');
  assert(Boolean(normalizeSections([...shuffledSections, section('disconnected', { x: 400, y: 400 }, { x: 500, y: 400 })], offset.x, offset.y, absolute.start, absolute.end)) === false, 'disconnected ELK sections are rejected so callers route-repair instead of drawing a jump');
  assert(Boolean(normalizeSections([...shuffledSections, section('ambiguous', absolute.p1, { x: 130, y: -20 })], offset.x, offset.y, absolute.start, absolute.end)) === false, 'ambiguous branched ELK sections are rejected instead of selecting an arbitrary branch');

  const negativeAudit = auditLayout({
    nodes: [
      { id: 'a', label: 'A', kind: 'generic' }, { id: 'b', label: 'B', kind: 'generic' },
      { id: 'c', label: 'C', kind: 'generic' }, { id: 'd', label: 'D', kind: 'generic' }
    ],
    containers: [{ id: 'unrelated', label: 'Unrelated', type: 'generic-group' }],
    connections: [
      { id: 'audited-a', source: 'a', target: 'b', label: 'A label' },
      { id: 'audited-b', source: 'c', target: 'd', label: 'B label' }
    ],
    nodeBoxes: {
      a: { x: 0, y: 100, width: 80, height: 60 }, b: { x: 320, y: 100, width: 80, height: 60 },
      c: { x: 150, y: 0, width: 80, height: 60 }, d: { x: 150, y: 240, width: 80, height: 60 }
    },
    containerBoxes: { unrelated: { x: 100, y: 80, width: 200, height: 120 } },
    contentTops: { unrelated: 36 },
    connectionPresentations: {
      'audited-a': { route: { version: '1.0', inputSignature: 'a'.repeat(64), points: [{ x: 80, y: 110 }, { x: 320, y: 110 }], label: { x: 120, y: 90, width: 40, height: 20 } } },
      'audited-b': { route: { version: '1.0', inputSignature: 'a'.repeat(64), points: [{ x: 140, y: 60 }, { x: 140, y: 240 }], label: { x: 145, y: 95, width: 40, height: 20 } } }
    }
  });
  const negativeCodes = new Set(negativeAudit.map(finding => finding.code));
  assert(negativeCodes.has('LAYOUT_ROUTE_HEADER_COLLISION') && negativeCodes.has('LAYOUT_ROUTE_UNRELATED_CONTAINER_COLLISION'), 'negative route fixture detects a header and unrelated-container intrusion');
  assert(negativeCodes.has('LAYOUT_LABEL_HEADER_COLLISION') && negativeCodes.has('LAYOUT_LABEL_ROUTE_COLLISION') && negativeCodes.has('LAYOUT_LABEL_OVERLAP'), 'negative label fixture detects header, other-edge and label-to-label collisions');

  const boundedObstacles = Array.from({ length: 320 }, (_, index) => ({ x: index * 10, y: index * 10, width: 1, height: 1 }));
  assert(repairOrthogonalRoute({ x: 0, y: 5000 }, { x: 5000, y: 0 }, boundedObstacles, 'budget-limit') === undefined, 'routing search rejects an oversized visibility grid within its fixed state budget');

  const stale = routeCacheStatus(result.document.presentation.connections?.['parallel-a']?.route, '0'.repeat(64), 'First route label with enough words to wrap');
  assert(stale === 'stale', 'global input signature changes make cached routes stale');
  const nodeBoxes = Object.fromEntries(Object.entries(result.document.presentation.nodes).map(([id, box]) => [id, { x: box.x, y: box.y, width: box.width ?? result.metrics.nodes[id].width, height: box.height ?? result.metrics.nodes[id].height }]));
  const changedObstacle = { ...nodeBoxes, obstacle: { ...nodeBoxes.obstacle, x: nodeBoxes.obstacle.x + 25 } };
  const changedSignature = await createRouteInputSignature(model, changedObstacle, {}, result.document.presentation.connections ?? {}, result.metrics);
  assert(changedSignature !== result.document.presentation.connections?.['parallel-a']?.route?.inputSignature, 'moving a non-endpoint obstacle invalidates every global cached route signature');
  const cached = result.document.presentation.connections?.['parallel-a']?.route;
  assert(Boolean(cached), 'the parallel fixture has a cached route');
  if (!cached) throw new Error('Missing parallel route fixture');
  assert(cachedRouteForRender(result.document, 'parallel-a', cached, cached.inputSignature, model.connections.find(connection => connection.id === 'parallel-a')?.label, result.metrics) === cached, 'cancelling a geometry preview restores the untouched route cache');
  const oldEndpoint = (box: Rect, side: ConnectionSide, ratio: number): Point => side === 'right' ? { x: box.x + box.width, y: box.y + box.height * ratio }
    : { x: box.x, y: box.y + box.height * ratio };
  const oldAnchorRoute = { ...cached, points: [oldEndpoint(nodeBoxes.source, 'right', 0.62), ...cached.points.slice(1, -1), oldEndpoint(nodeBoxes.target, 'left', 0.38)] };
  assert(!routeGeometryUsable(result.document, 'parallel-a', oldAnchorRoute, result.metrics), 'legacy 38%/62% endpoints fail geometry validation even when a cache has the current signature');
  assert(cachedRouteForRender(result.document, 'parallel-a', oldAnchorRoute, cached.inputSignature, model.connections.find(connection => connection.id === 'parallel-a')?.label, result.metrics) === undefined, 'ordinary rendering falls back from a route attached to legacy offset handles');
  assert(routeCacheStatus({ ...cached, version: '9.0' as '1.0' }, cached.inputSignature, 'First route label with enough words to wrap') === 'unusable', 'unknown route cache versions are rejected');
  assert(routeCacheStatus({ ...cached, label: { ...cached.label!, width: Number.NaN } }, cached.inputSignature, 'First route label with enough words to wrap') === 'unusable', 'malformed cached label rectangles are rejected');
  assert(routeCacheStatus(undefined, cached.inputSignature, 'First route label with enough words to wrap') === 'missing', 'legacy documents without a route cache can use the visible renderer fallback');
  assert(routeCacheStatus({ ...cached, label: undefined }, cached.inputSignature, 'First route label with enough words to wrap') === 'unusable', 'cached route with a missing semantic label rectangle is unusable');
  assert(routeCacheStatus({ ...cached, label: cached.label }, cached.inputSignature, '') === 'unusable', 'cached route with an extra label rectangle for empty semantics is unusable');
  const changedMetrics = structuredClone(result.metrics);
  changedMetrics.profile.labelLineHeight += 1;
  const metricsSignature = await createRouteInputSignature(model, nodeBoxes, {}, result.document.presentation.connections ?? {}, changedMetrics);
  assert(metricsSignature !== cached.inputSignature, 'font and line-height changes invalidate every cached route signature');
  console.log(`Routing findings from candidate: ${JSON.stringify(result.findings)}.`);
  console.log('All layout routing checks passed.');
}

run().catch(error => { console.error(error); process.exit(1); });
