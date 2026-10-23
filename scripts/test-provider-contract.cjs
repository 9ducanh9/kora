// Runs without esbuild/native binaries. All provider responses are injected; no credentials or network.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true }
}).outputText, filename);
const { validateArchitectureModel } = require('../src/core/ir/validator.ts');
const { validateProviderArchitectureModel } = require('../src/core/ai/providerModel.ts');
const { ARCHITECTURE_OUTPUT_CONTRACT } = require('../src/core/ai/outputContract.ts');
const { KORA_SYSTEM_PROMPT } = require('../src/core/ai/systemPrompt.ts');
const { DeepSeekArchitectureParser } = require('../src/core/ai/providers/deepseek.parser.ts');
const { readParseResponse, ParserResponseError } = require('../src/core/ai/parseResponse.ts');
const { prepareArchitectureModel } = require('../src/core/architecture/prepareModel.ts');
const captured = JSON.parse(fs.readFileSync('tests/fixtures/livecap-provider-invalid-relationships.json', 'utf8'));
const clone = value => structuredClone(value);
const base = () => ({ version: '1.0', nodes: [{ id: 'a', label: 'A', kind: 'generic' }], connections: [], containers: [] });
const fakeParser = (model, finishReason = 'stop') => {
  let calls = 0;
  return {
    parser: new DeepSeekArchitectureParser('fake-key', 'test-model', async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(model) }, finish_reason: finishReason }] }));
    }),
    count: () => calls
  };
};
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`); };

(async () => {
  await check('live captured failure is recovered without losing entities, labels or raw evidence', async () => {
    const before = JSON.stringify(captured);
    assert.equal(validateArchitectureModel(captured).ok, false, 'Strict importer must still reject provider aliases.');
    const adapter = fakeParser(captured);
    const result = await adapter.parser.parse('The supplied LiveCap description');
    assert.equal(adapter.count(), 1);
    assert.equal(result.model.nodes.length, 15);
    assert.equal(result.model.connections.length, 16);
    assert.equal(result.model.containers.length, 5);
    assert.equal(result.issues.filter(i => i.code === 'PROVIDER_RELATIONSHIP_NORMALIZED').length, 2);
    const expected = clone(captured);
    expected.connections[14].relationship = 'data';
    expected.connections[15].relationship = 'data';
    assert.deepEqual(result.model, expected);
    assert.equal(JSON.stringify(captured), before);
  });
  await check('normalization is idempotent', () => {
    const first = validateProviderArchitectureModel(captured);
    const second = validateProviderArchitectureModel(first.value);
    assert.equal(second.ok, true);
    assert.deepEqual(second.value, first.value);
    assert.equal(second.issues.filter(i => i.code === 'PROVIDER_RELATIONSHIP_NORMALIZED').length, 0);
  });
  await check('arbitrary deployment actions and unknown relationships remain invalid', () => {
    for (const relationship of ['deploy', 'teleport', 'control', null]) {
      const model = base();
      model.connections.push({ id: 'e', source: 'a', target: 'a', relationship, label: 'Start a production deployment' });
      assert.equal(validateProviderArchitectureModel(model).ok, false);
    }
  });
  await check('dangling references, duplicate IDs, cycles, unknown fields and wrong metadata are never repaired away', () => {
    for (const mutate of [
      m => m.connections.push({ id: 'bad', source: 'a', target: 'missing', relationship: 'media' }),
      m => m.nodes.push(clone(m.nodes[0])),
      m => m.containers.push({ id: 'c', label: 'Cycle', type: 'generic-group', parentId: 'c' }),
      m => m.geometry = { x: 10 },
      m => m.nodes[0].metadata = { count: 2 },
      m => m.nodes[0].containerId = null
    ]) {
      const model = base(); mutate(model);
      assert.equal(validateProviderArchitectureModel(model).ok, false);
    }
  });
  await check('empty or malformed provider values do not crash adaptation', () => {
    for (const value of [null, [], {}, { connections: [null, 3, []] }]) assert.equal(validateProviderArchitectureModel(value).ok, false);
  });
  await check('schema guidance includes the actual strict enum and metadata contract', () => {
    const edge = ARCHITECTURE_OUTPUT_CONTRACT.properties.connections.items;
    assert.deepEqual(edge.properties.relationship.enum, ['request', 'data', 'event', 'auth', 'association']);
    assert.equal(edge.additionalProperties, false);
    assert.ok(!edge.required.includes('relationship'));
    assert.deepEqual(edge.required, ['id', 'source', 'target']);
    const node = ARCHITECTURE_OUTPUT_CONTRACT.properties.nodes.items;
    assert.deepEqual(node.properties.metadata.additionalProperties, { type: 'string' });
    assert.ok(KORA_SYSTEM_PROMPT.includes(JSON.stringify(ARCHITECTURE_OUTPUT_CONTRACT)));
    assert.equal(ARCHITECTURE_OUTPUT_CONTRACT.properties.version.const, '1.0');
  });
  await check('the prompt example is valid independently of appended generated schema', () => {
    const exampleText = KORA_SYSTEM_PROMPT.split('6. JSON OUTPUT FORMAT:')[1].split('7. AUTHORITATIVE OUTPUT SCHEMA:')[0];
    assert.equal(validateArchitectureModel(JSON.parse(exampleText.slice(exampleText.indexOf('{')))).ok, true);
  });
  await check('valid JSON with truncated completion is rejected without retry', async () => {
    const adapter = fakeParser(base(), 'length');
    await assert.rejects(() => adapter.parser.parse('A system'), error => error.code === 'PROVIDER_TRUNCATED_RESPONSE');
    assert.equal(adapter.count(), 1);
  });
  await check('unrecoverable schema errors retain exact diagnostics through the client boundary', async () => {
    const bad = base(); bad.connections.push({ id: 'bad', source: 'a', target: 'missing' });
    const adapter = fakeParser(bad);
    let error;
    try { await adapter.parser.parse('A system'); } catch (caught) { error = caught; }
    assert.equal(error.code, 'PROVIDER_INVALID_MODEL');
    assert.equal(adapter.count(), 1);
    assert.throws(() => readParseResponse({ success: false, error: error.publicMessage, code: error.code, issues: error.issues }), caught => {
      assert.ok(caught instanceof ParserResponseError);
      assert.equal(caught.code, error.code);
      assert.deepEqual(caught.issues, error.issues);
      assert.ok(caught.issues.some(i => i.code === 'IR_CONNECTION_TARGET_MISSING'));
      return true;
    });
  });
  await check('client rejects malformed envelopes and preserves success warnings', () => {
    for (const raw of [null, { success: true }, { success: false, issues: [{ message: 'invalid issue' }] }]) {
      assert.throws(() => readParseResponse(raw), ParserResponseError);
    }
    const result = validateProviderArchitectureModel(captured);
    const response = readParseResponse({ success: true, model: result.value, issues: result.issues });
    assert.deepEqual(response.issues, result.issues);
    assert.deepEqual(response.model, result.value);
  });
  await check('empty Vercel/LiveKit boundaries from the capture stay outside AWS', () => {
    const model = validateProviderArchitectureModel(captured).value;
    const prepared = prepareArchitectureModel(model);
    for (const id of ['group-vercel', 'group-livekit-cloud']) assert.equal(prepared.containers.find(c => c.id === id).parentId, undefined);
    assert.equal(prepared.nodes.find(n => n.id === 'ecs').containerId, 'subnet-pub-1');
    assert.equal(prepared.containers.find(c => c.id === 'subnet-pub-1').parentId, 'vpc-default');
  });
  await check('generic Browser with nested AudioWorklet stays outside AWS', () => {
    const model = base();
    model.nodes = [
      { id: 'audio', label: 'AudioWorklet', kind: 'generic', containerId: 'capture' },
      { id: 'ecs', label: 'Backend', kind: 'aws-service', assetId: 'aws.ecs.fargate' }
    ];
    model.containers = [
      { id: 'browser', label: 'Browser', type: 'generic-group' },
      { id: 'capture', label: 'Local Capture', type: 'generic-group', parentId: 'browser' }
    ];
    const prepared = prepareArchitectureModel(model);
    assert.equal(prepared.containers.find(c => c.id === 'browser').parentId, undefined);
    assert.equal(prepared.containers.find(c => c.id === 'capture').parentId, 'browser');
    assert.equal(prepared.nodes.find(n => n.id === 'ecs').containerId, 'cloud-aws');
  });
  await check('AWS descendants give a group positive AWS ownership; explicit nesting is preserved', () => {
    const model = base();
    model.nodes = [{ id: 'ecs', label: 'Backend', kind: 'aws-service', containerId: 'inner' }];
    model.containers = [
      { id: 'outer', label: 'AWS Application', type: 'generic-group' },
      { id: 'inner', label: 'Worker', type: 'generic-group', parentId: 'outer' },
      { id: 'notes', label: 'Explicit AWS Notes', type: 'generic-group', parentId: 'cloud-aws' }
    ];
    const prepared = prepareArchitectureModel(model);
    assert.equal(prepared.containers.find(c => c.id === 'outer').parentId, 'cloud-aws');
    assert.equal(prepared.containers.find(c => c.id === 'inner').parentId, 'outer');
    assert.equal(prepared.containers.find(c => c.id === 'notes').parentId, 'cloud-aws');
    assert.equal(validateArchitectureModel(prepared).ok, true);
  });
  await check('mixed-provider root group is not labeled as AWS; normalization does not mutate input', () => {
    const model = base();
    model.nodes = [
      { id: 'ecs', label: 'Backend', kind: 'aws-service', containerId: 'system' },
      { id: 'vercel', label: 'Vercel', kind: 'external', containerId: 'system' }
    ];
    model.containers = [{ id: 'system', label: 'System', type: 'generic-group' }];
    const original = JSON.stringify(model);
    const prepared = prepareArchitectureModel(model);
    assert.equal(prepared.containers.find(c => c.id === 'system').parentId, undefined);
    assert.equal(JSON.stringify(model), original);
    assert.equal(JSON.stringify(prepareArchitectureModel(prepared)), JSON.stringify(prepared));
  });
  console.log(`Provider contract regression: ${passed}/14 checks passed; no network requests.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
