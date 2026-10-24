import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { BASELINE_CASES } from '../tests/fixtures/baseline/cases';
import { createEmptyDiagramDocument, DiagramDocument } from '../src/core/diagram/types';
import { KoraArchitectureModel } from '../src/core/ir/types';
import { getNodeDimensions, resolveEffectiveNodeBox } from '../src/core/layout/nodeDimensions';
import { resolveConnectionAnchor } from '../src/core/layout/anchors';
import { resolveConnectionGeometry } from '../src/core/layout/connectionGeometry';
import { preflightDiagram, diagramBounds } from '../src/core/export/preflight';
import { renderDiagramSvg } from '../src/core/export/svg';
import { rasterizeDiagramPng } from '../src/core/export/png';
import { DiagramExportError, EXPORT_LIMITS } from '../src/core/export/limits';
import { safeExportFilename } from '../src/core/export/filename';
import { validateDiagramDocument } from '../src/core/diagram/validator';
import { measureVisuals } from '../src/core/layout/visualMetrics';
import { resolveTextLayout } from '../src/core/layout/textLayout';
import { getContainerVisualConfig } from '../src/core/containers/registry';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
let passed = 0;

function makeDocument(model: KoraArchitectureModel): DiagramDocument {
  const empty = createEmptyDiagramDocument('Export fixture');
  const nodes = Object.fromEntries(model.nodes.map(node => [node.id, node]));
  const containers = Object.fromEntries(model.containers.map(container => [container.id, container]));
  const connections = Object.fromEntries(model.connections.map(connection => [connection.id, connection]));
  const nodePresentations = Object.fromEntries(model.nodes.map((node, index) => [node.id, { x: 80 + (index % 3) * 230, y: 70 + Math.floor(index / 3) * 170, width: 96, height: 79 }]));
  const containerPresentations = Object.fromEntries(model.containers.map((container, index) => [container.id, { x: 40 + index * 30, y: 30 + index * 30, width: 540, height: 390 }]));
  const connectionPresentations = Object.fromEntries(model.connections.map((connection, index) => [connection.id, { sourceSide: index % 2 ? 'bottom' as const : 'right' as const, targetSide: index % 2 ? 'top' as const : 'left' as const }]));
  return {
    ...empty,
    semantic: { scope: model.scope, nodes, connections, containers },
    presentation: { nodes: nodePresentations, containers: containerPresentations, connections: connectionPresentations, viewport: { x: 400, y: 300, zoom: 0.5 } },
    metadata: { ...empty.metadata, source: { kind: 'prompt', prompt: 'SECRET SOURCE PROMPT MUST NOT APPEAR IN IMAGE', parser: { id: 'offline-test' }, generatedAt: '2026-10-18T00:00:00.000Z' } }
  };
}

async function check(name: string, test: () => void | Promise<void>) {
  await test(); passed++; process.stdout.write(`PASS ${name}\n`);
}

async function withLocalAssetFetch<T>(run: () => Promise<T>, rejectPath?: string): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    if (rejectPath && path === rejectPath) return new Response('missing', { status: 404 });
    const localPath = path.startsWith('/') ? resolve(process.cwd(), 'public', path.slice(1)) : path;
    try {
      const bytes = await readFile(localPath);
      const contentType = path.endsWith('.svg') ? 'image/svg+xml' : 'font/woff2';
      return new Response(bytes, { status: 200, headers: { 'content-type': contentType } });
    } catch { return new Response('missing', { status: 404 }); }
  }) as typeof fetch;
  try { return await run(); }
  finally { globalThis.fetch = originalFetch; }
}

async function main() {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
  const base = BASELINE_CASES[0].model;
  const doc = makeDocument(base);
  const checked = validateDiagramDocument(doc); assert.equal(checked.ok, true);

  await check('U19/U21 shared effective box retains saved size while preventing long-label overflow', () => {
    const node = { id: 'long', label: 'A Vietnamese label that is deliberately much wider than a compact legacy box', assetId: 'aws.s3', kind: 'aws-service' as const };
    const measured = getNodeDimensions(node);
    const effective = resolveEffectiveNodeBox({ x: 12, y: -20, width: 30, height: 28 }, node);
    assert.ok(effective.width >= measured.width); assert.ok(effective.height >= measured.height);
    assert.equal(effective.x, 12); assert.equal(effective.y, -20);
  });

  await check('U20 canvas and exporter use the same fallback, self-loop and cached polyline geometry', () => {
    const a = { x: 40, y: 50 }; const b = { x: 220, y: 160 };
    const fallback = resolveConnectionGeometry({ source: a, target: b, sourceSide: 'right', targetSide: 'left' });
    assert.ok(fallback.path.startsWith('M')); assert.ok(fallback.points.length >= 3);
    const loop = resolveConnectionGeometry({ source: a, target: { x: 70, y: 80 }, sourceSide: 'right', targetSide: 'left', sourceId: 'n1', targetId: 'n1' });
    assert.equal(loop.points.length, 5); assert.equal(loop.labelX, loop.points[2].x);
    const route = { version: '1.0' as const, inputSignature: 'a'.repeat(64), points: [a, { x: 100, y: 50 }, b], label: { x: 90, y: 70, width: 40, height: 20 } };
    const cached = resolveConnectionGeometry({ source: a, target: b, sourceSide: 'right', targetSide: 'left', route });
    assert.deepEqual(cached.points, route.points); assert.equal(cached.labelX, 110); assert.equal(cached.labelY, 80);
    assert.deepEqual(resolveConnectionAnchor({ x: 0, y: 0, width: 100, height: 80 }, 'right', 'source'), { x: 100, y: 40 });
  });

  await check('centered same-side fallback loops remain outside their node with visible area and normal entry/exit', () => {
    const box = { x: 10, y: 20, width: 100, height: 80 };
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const anchor = resolveConnectionAnchor(box, side, 'source');
      const geometry = resolveConnectionGeometry({ source: anchor, target: resolveConnectionAnchor(box, side, 'target'), sourceSide: side, targetSide: side, sourceId: 'loop', targetId: 'loop' });
      const points = geometry.points;
      const outgoing = points.find(point => Math.hypot(point.x - anchor.x, point.y - anchor.y) > 0.001)!;
      const incoming = [...points].reverse().find(point => Math.hypot(point.x - anchor.x, point.y - anchor.y) > 0.001)!;
      const outward = (point: { x: number; y: number }) => side === 'left' ? point.x < anchor.x && point.y === anchor.y
        : side === 'right' ? point.x > anchor.x && point.y === anchor.y
          : side === 'top' ? point.y < anchor.y && point.x === anchor.x : point.y > anchor.y && point.x === anchor.x;
      assert.deepEqual(points[0], anchor); assert.deepEqual(points.at(-1), anchor);
      assert.ok(outgoing && incoming && outward(outgoing) && outward(incoming), `${side} loop must leave and return through the outward normal`);
      const area = Math.abs(points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y;
      }, 0)) / 2;
      assert.ok(area > 1, `${side} loop must not collapse into a retraced line`);
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1]; const b = points[index];
        assert.ok(a.x === b.x || a.y === b.y, `${side} loop segments must stay orthogonal`);
        const crosses = a.x === b.x
          ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
          : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width;
        assert.equal(crosses, false, `${side} loop must not cross the node interior`);
      }
    }
  });

  await check('SVG exports center-aligned horizontal/vertical arrows without legacy handle staircases', async () => {
    const model: KoraArchitectureModel = {
      version: '1.0', nodes: [{ id: 'a', label: 'A', kind: 'generic', assetId: 'generic.component' }, { id: 'b', label: 'B', kind: 'generic', assetId: 'generic.component' }],
      containers: [], connections: [{ id: 'aligned', source: 'a', target: 'b', relationship: 'request' }]
    };
    for (const vertical of [false, true]) {
      const fixture = makeDocument(model);
      const sourceBox = { x: 0, y: 0, width: 100, height: 100 };
      const targetBox = vertical ? { x: 0, y: 300, width: 100, height: 100 } : { x: 300, y: 0, width: 100, height: 100 };
      fixture.presentation.nodes = { a: sourceBox, b: targetBox };
      const sourceSide = vertical ? 'bottom' : 'right'; const targetSide = vertical ? 'top' : 'left';
      fixture.presentation.connections = { aligned: { sourceSide, targetSide, route: {
        version: '1.0', inputSignature: '934216633102f70cee9e21aa9fbd9fc18ba095acb3c9f572ad53444e5a44cba3',
        points: vertical ? [{ x: 62, y: 100 }, { x: 62, y: 200 }, { x: 38, y: 200 }, { x: 38, y: 300 }]
          : [{ x: 100, y: 62 }, { x: 200, y: 62 }, { x: 200, y: 38 }, { x: 300, y: 38 }]
      } } };
      const svg = await withLocalAssetFetch(async () => (await renderDiagramSvg(fixture)).blob.text());
      const path = /data-entity-id="aligned" data-entity-kind="connection"><path d="([^"]+)"/u.exec(svg)?.[1];
      const expected = resolveConnectionGeometry({ source: resolveConnectionAnchor(sourceBox, sourceSide, 'source'), target: resolveConnectionAnchor(targetBox, targetSide, 'target'), sourceSide, targetSide });
      assert.equal(path, expected.path, `${vertical ? 'vertical' : 'horizontal'} export must fall back from the old cache to the shared centered geometry`);
      const coordinate = vertical ? 'x' : 'y';
      assert.ok(expected.points.every(point => point[coordinate] === 50));
    }
  });

  await check('U21 shared text layout preserves normalized Vietnamese, graphemes and positioned line runs', async () => {
    const text = '  Mạng   người dùng W i\r\nAPI Gateway  ';
    const layout = resolveTextLayout(text, { maxWidth: 34, fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 600, lineHeight: 13.75 });
    assert.equal(layout.lines.join('').replaceAll(' ', ''), 'MạngngườidùngWiAPIGateway');
    assert.equal(layout.runs.length, layout.lines.length);
    assert.ok(layout.runs.every((run, index) => run.text === layout.lines[index] && Number.isFinite(run.x) && Number.isFinite(run.y)));
    assert.equal(layout.runs[0].y, -(layout.lines.length - 1) * 13.75 / 2);
    assert.equal(layout.runs.at(-1)?.y, (layout.lines.length - 1) * 13.75 / 2);
    const longUnbroken = 'W'.repeat(EXPORT_LIMITS.maxTextFieldCodeUnits);
    const stressLayout = resolveTextLayout(longUnbroken, { maxWidth: 120, fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 600, lineHeight: 13.75 });
    assert.equal(stressLayout.lines.join(''), longUnbroken, 'a maximum-size unbroken label is wrapped without truncation');
    assert.ok(stressLayout.lines.length > 1);

    const model = clone(BASELINE_CASES[1].model);
    model.nodes[0].label = text;
    model.connections[0].label = text;
    model.containers[0].label = text;
    const metrics = measureVisuals(model);
    const nodeMetric = metrics.nodes[model.nodes[0].id];
    const containerMetric = metrics.containers[model.containers[0].id];
    const connectionMetric = metrics.connections[model.connections[0].id];
    assert.equal(nodeMetric.primary, text, 'semantic display text retains the exact source string');
    for (const measured of [nodeMetric.primaryLayout, containerMetric.titleLayout, connectionMetric.labelLayout]) {
      assert.equal(measured.lines.join('').replaceAll(' ', ''), 'MạngngườidùngWiAPIGateway');
      assert.equal(measured.runs.length, measured.lines.length);
    }
    const exported = await withLocalAssetFetch(async () => renderDiagramSvg(makeDocument(model)));
    const svg = await exported.blob.text();
    const renderedLines = [...svg.matchAll(/<tspan\b[^>]*>(.*?)<\/tspan>/gu)].map(match => match[1]);
    const nodeWidth = Math.max(96, nodeMetric.width);
    const nodeLayout = resolveTextLayout(nodeMetric.primary, { maxWidth: nodeWidth - 12, fontFamily: metrics.profile.fontFamily, fontSize: 11, fontWeight: 600, lineHeight: metrics.profile.nodeLineHeight, letterSpacing: metrics.profile.nodeLetterSpacing });
    const config = getContainerVisualConfig(model.containers[0].type);
    const containerWidth = 540;
    const titleWidth = Math.max(32, Math.min(240, containerWidth - 10 - (config.badgeSize ? config.badgeSize + 6 : 0) - 14));
    const titleLayout = resolveTextLayout(text.trim().replace(/\s+/gu, ' '), { maxWidth: titleWidth, fontFamily: metrics.profile.fontFamily, fontSize: config.fontSize, fontWeight: config.fontWeight, lineHeight: config.fontSize * 1.2, letterSpacing: 0, align: 'start' });
    const connectionLayout = resolveTextLayout(text, { maxWidth: connectionMetric.width - 14, fontFamily: metrics.profile.fontFamily, fontSize: 11, fontWeight: 500, lineHeight: metrics.profile.labelLineHeight, letterSpacing: metrics.profile.labelLetterSpacing });
    for (const line of [...nodeLayout.lines, ...titleLayout.lines, ...connectionLayout.lines]) assert.ok(renderedLines.includes(line), `SVG should emit the shared line run ${line}`);
  });

  await check('U19/U23 empty, oversized text, route points and arithmetic overflow fail in preflight', () => {
    const empty = createEmptyDiagramDocument();
    assert.throws(() => preflightDiagram(empty), (error: unknown) => error instanceof DiagramExportError && error.code === 'NOTHING_TO_EXPORT');
    const tooLong = clone(doc); tooLong.semantic.nodes.users.label = 'x'.repeat(EXPORT_LIMITS.maxTextFieldCodeUnits + 1);
    assert.throws(() => preflightDiagram(tooLong), (error: unknown) => error instanceof DiagramExportError && error.code === 'TEXT_FIELD_LIMIT');
    const tooManyPoints = clone(doc);
    const first = Object.keys(tooManyPoints.semantic.connections)[0];
    tooManyPoints.presentation.connections![first].route = { version: '1.0', inputSignature: 'a'.repeat(64), points: Array.from({ length: EXPORT_LIMITS.maxPointsPerConnection + 1 }, (_, index) => ({ x: index, y: 0 })) };
    assert.throws(() => preflightDiagram(tooManyPoints), (error: unknown) => error instanceof DiagramExportError && error.code === 'CONNECTION_POINT_LIMIT');
    assert.throws(() => diagramBounds([{ x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 10 }], []), (error: unknown) => error instanceof DiagramExportError && error.code === 'BOUNDS_OVERFLOW');
  });

  await check('U22/U26 SVG embeds local fonts/icons, namespaces repeated IDs, keeps vectors and excludes provenance', async () => {
    const model = clone(base);
    model.connections.push(
      { id: 'self-loop', source: 'cloudfront', target: 'cloudfront', label: 'Retry', relationship: 'event' },
      { id: 'reciprocal', source: 'cloudfront', target: 'users', label: 'Reply', relationship: 'data' },
      { id: 'parallel', source: 'cloudfront', target: 's3', label: '/api/*', relationship: 'request' }
    );
    const fixture = makeDocument(model);
    let requests = 0;
    await withLocalAssetFetch(async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input, init) => { requests++; return originalFetch(input, init); }) as typeof fetch;
      try {
        const rendered = await renderDiagramSvg(fixture, { theme: 'light' });
        const svg = await rendered.blob.text();
        assert.equal(rendered.entities, 3 + 0 + 5);
        assert.ok(svg.includes('data-entity-id="self-loop"'));
        assert.ok(svg.includes('data-entity-id="parallel"'));
        assert.ok(svg.includes('data:font/woff2;base64,'));
        assert.ok(svg.includes('<path d="M'));
        assert.ok(svg.includes('<tspan'));
        assert.ok(!svg.includes('SECRET SOURCE PROMPT'));
        assert.ok(!svg.includes('https://fonts.googleapis.com'));
        assert.ok(!svg.includes('foreignObject'));
        const ids = [...svg.matchAll(/\bid="([^"]+)"/gu)].map(match => match[1]);
        assert.equal(new Set(ids).size, ids.length, 'inline SVG IDs must be unique');
        assert.ok(rendered.bounds.width > 0 && rendered.bounds.height > 0);
      } finally { globalThis.fetch = originalFetch; }
    });
    assert.ok(requests >= 5, 'icons and both local font subsets should be loaded');
  });

  await check('U23 preflight rejects before any asset/font fetch; known resource failure does not silently omit icons', async () => {
    const tooLong = clone(doc); tooLong.semantic.nodes.users.label = 'x'.repeat(EXPORT_LIMITS.maxTextFieldCodeUnits + 1);
    let requests = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { requests++; return new Response('', { status: 404 }); }) as typeof fetch;
    try {
      await assert.rejects(() => renderDiagramSvg(tooLong), (error: unknown) => error instanceof DiagramExportError && error.code === 'DOCUMENT_RESOURCE_LIMIT');
      assert.equal(requests, 0);
    } finally { globalThis.fetch = originalFetch; }
    await withLocalAssetFetch(async () => {
      await assert.rejects(() => renderDiagramSvg(doc), (error: unknown) => error instanceof DiagramExportError && ['ASSET_LOAD_FAILED','FONT_LOAD_FAILED'].includes(error.code));
    }, '/assets/aws/edge/aws-cloudfront.svg');
  });

  await check('U24 PNG cap is checked before browser allocation; supported dimensions require browser decode', async () => {
    const tooLarge = { blob: new Blob(['<svg/>']), bounds: { x: 0, y: 0, width: 4097, height: 1000 }, entities: 1, byteLength: 6 };
    await assert.rejects(() => rasterizeDiagramPng(tooLarge, { scale: 2 }), (error: unknown) => error instanceof DiagramExportError && error.code === 'PNG_DIMENSION_LIMIT');
    const withinCaps = { ...tooLarge, bounds: { x: 0, y: 0, width: 100, height: 100 } };
    await assert.rejects(() => rasterizeDiagramPng(withinCaps, { scale: 2 }), (error: unknown) => error instanceof DiagramExportError && error.code === 'PNG_UNAVAILABLE');
  });

  await check('U24/U28 PNG decode, encode cancellation and late callbacks clean up browser resources', async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let width = 0; let height = 0; let encodeMode: 'success' | 'pending' = 'success';
    let encodeCallback: ((blob: Blob | null) => void) | undefined;
    const requestedSizes: Array<[number, number]> = [];
    let creates = 0; let revokes = 0;
    const canvas = {
      get width() { return width; }, set width(value: number) { width = value; if (value) requestedSizes.push([value, height]); },
      get height() { return height; }, set height(value: number) { height = value; if (value && requestedSizes.length) requestedSizes[requestedSizes.length - 1][1] = value; },
      getContext: () => ({ fillStyle: '', fillRect() {}, drawImage() {} }),
      toBlob(callback: (blob: Blob | null) => void) {
        encodeCallback = callback;
        if (encodeMode === 'success') callback(new Blob(['pixels'], { type: 'image/png' }));
        else setTimeout(() => encodeCallback?.(new Blob(['late pixels'], { type: 'image/png' })), 30);
      }
    } as unknown as HTMLCanvasElement;
    class FakeImage {
      onload: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      set src(value: string) { if (value) setTimeout(() => this.onload?.(new Event('load')), 0); }
    }
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
    URL.createObjectURL = (() => { creates++; return `blob:kora-test-${creates}`; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => { revokes++; }) as typeof URL.revokeObjectURL;
    try {
      const svg = { blob: new Blob(['<svg/>']), bounds: { x: 0, y: 0, width: 100, height: 70 }, entities: 1, byteLength: 6 };
      const png = await rasterizeDiagramPng(svg, { scale: 2 });
      assert.equal(png.type, 'image/png');
      assert.deepEqual(requestedSizes[0], [200, 140]);
      assert.equal(width, 0); assert.equal(height, 0);

      encodeMode = 'pending';
      const controller = new AbortController();
      const exportPromise = rasterizeDiagramPng(svg, { scale: 1, signal: controller.signal });
      setTimeout(() => controller.abort(), 5);
      await assert.rejects(exportPromise, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
      await new Promise(resolve => setTimeout(resolve, 40));
      assert.equal(width, 0); assert.equal(height, 0);
      assert.equal(creates, 2); assert.equal(revokes, 2);
    } finally {
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete (globalThis as { document?: Document }).document;
      if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage); else delete (globalThis as { Image?: typeof Image }).Image;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  await check('U28 cancelling while local fonts are pending removes every export abort listener', async () => {
    let listenersAdded = 0; let listenersRemoved = 0;
    class TrackedSignal {
      aborted = false;
      reason: unknown;
      private handlers = new Set<EventListenerOrEventListenerObject>();
      addEventListener(_type: string, listener: EventListenerOrEventListenerObject) { listenersAdded++; this.handlers.add(listener); }
      removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) { listenersRemoved++; this.handlers.delete(listener); }
      abort(reason: unknown) {
        this.aborted = true; this.reason = reason;
        for (const listener of [...this.handlers]) {
          if (typeof listener === 'function') listener.call(this as unknown as EventTarget, new Event('abort'));
          else listener.handleEvent(new Event('abort'));
        }
      }
    }
    class TrackedController {
      signal = new TrackedSignal();
      abort(reason: unknown = new DOMException('Export cancelled.', 'AbortError')) { this.signal.abort(reason); }
    }
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalAbortController = Object.getOwnPropertyDescriptor(globalThis, 'AbortController');
    let resolveFonts!: () => void;
    const fontsReady = new Promise<void>(resolve => { resolveFonts = resolve; });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { fonts: { ready: fontsReady, check: () => true } } });
    Object.defineProperty(globalThis, 'AbortController', { configurable: true, value: TrackedController });
    try {
      const controller = new TrackedController();
      const pending = renderDiagramSvg(doc, { signal: controller.signal as unknown as AbortSignal });
      controller.abort();
      await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
      resolveFonts();
      await Promise.resolve();
      assert.equal(listenersAdded, 2, 'the wrapper and font wait each register one abort listener');
      assert.equal(listenersRemoved, listenersAdded, 'both listeners are removed after cancellation');
    } finally {
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete (globalThis as { document?: Document }).document;
      if (originalAbortController) Object.defineProperty(globalThis, 'AbortController', originalAbortController); else delete (globalThis as { AbortController?: typeof AbortController }).AbortController;
    }
  });

  await check('U26 filenames remove path/control characters, normalize graphemes and keep correct extension', () => {
    const filename = safeExportFilename('..\\folder: bad\u0001 title. ', 'svg');
    assert.equal(filename.endsWith('.svg'), true);
    assert.equal(/[<>:"/\\|?*\u0000-\u001f]/u.test(filename), false);
    assert.ok(Array.from(filename.slice(0, -4)).length <= 80);
    assert.equal(safeExportFilename('', 'png'), 'architecture.png');
  });

  await check('U19 empty image refusal still leaves JSON validation available', () => {
    const empty = createEmptyDiagramDocument();
    assert.equal(validateDiagramDocument(empty).ok, true);
    assert.throws(() => preflightDiagram(empty), (error: unknown) => error instanceof DiagramExportError && error.code === 'NOTHING_TO_EXPORT');
  });

  process.stdout.write(`Diagram export harness: ${passed}/13 groups passed. Pixel fidelity remains browser-only.\n`);
}

void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
