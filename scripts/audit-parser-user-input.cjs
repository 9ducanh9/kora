// Diagnostic audit only. Offline by default; --live makes exactly one provider request.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => {
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true }
  }).outputText, filename);
};
const { validateArchitectureModel } = require('../src/core/ir/validator.ts');
const { DeepSeekArchitectureParser } = require('../src/core/ai/providers/deepseek.parser.ts');
const { prepareArchitectureModel } = require('../src/core/architecture/prepareModel.ts');
const { KORA_SYSTEM_PROMPT } = require('../src/core/ai/systemPrompt.ts');
const output = path.resolve('docs/audits/20261018-parser-user-input');
fs.mkdirSync(output, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n');
const base = () => ({ version: '1.0', nodes: [{ id: 'api', label: 'FastAPI', kind: 'generic' }], containers: [], connections: [] });

async function offline() {
  const findings = [];
  const record = (id, description, evidence) => findings.push({ id, description, evidence });
  const example = JSON.parse(KORA_SYSTEM_PROMPT.slice(KORA_SYSTEM_PROMPT.indexOf('{\n')));
  assert.equal(validateArchitectureModel(example).ok, true);
  record('system-example', 'The system prompt example is valid; incomplete guidance is not proof every output fails.', { valid: true });

  const large = base();
  large.nodes = Array.from({ length: 150 }, (_, i) => ({ id: `n${i}`, label: `Component ${i}`, kind: 'generic' }));
  large.connections = large.nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: large.nodes[i].id, target: n.id }));
  assert.equal(validateArchitectureModel(large).ok, true);
  record('size', 'The IR validator accepts 150 nodes and 149 edges; this does not prove provider or layout capacity.', { nodes: 150, connections: 149, valid: true });

  const shapes = [];
  for (const [name, mutate] of [
    ['numeric metadata', m => m.nodes[0].metadata = { maxSessions: 2 }],
    ['optional null', m => m.nodes[0].containerId = null],
    ['unknown explanation field', m => m.explanation = 'User requested prose'],
    ['protocol used as relationship', m => m.connections.push({ id: 'e', source: 'api', target: 'api', relationship: 'WebRTC' })]
  ]) {
    const m = base(); mutate(m);
    const result = validateArchitectureModel(m);
    assert.equal(result.ok, false);
    shapes.push({ name, issues: result.issues });
  }
  record('schema-shapes', 'Plausible model output variations are rejected. They are synthetic examples, not the historical failure.', shapes);

  let calls = 0;
  const invalid = base(); invalid.connections.push({ id: 'bad', source: 'api', target: 'missing' });
  const parser = new DeepSeekArchitectureParser('fake-key', 'fake-model', async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) }, finish_reason: 'stop' }] }), { status: 200 });
  });
  let caught;
  try { await parser.parse('ordinary user description'); } catch (error) { caught = error; }
  assert.equal(caught?.code, 'PROVIDER_INVALID_MODEL');
  assert.ok(caught.issues.some(i => i.code === 'IR_CONNECTION_TARGET_MISSING'));
  assert.equal(calls, 1);
  record('failure-diagnostics-and-retry', 'Parser preserves exact validation issues and stops after one attempt, without repair.', { calls, code: caught.code, issues: caught.issues });

  const alias = base(); alias.nodes[0] = { id: 'api', label: 'Application Load Balancer', kind: 'aws-resource', assetId: 'ALB' };
  const aliasResult = validateArchitectureModel(alias);
  assert.equal(aliasResult.ok, true);
  assert.equal(aliasResult.value.nodes[0].assetId, 'aws.elb.alb');
  const unknown = base(); unknown.nodes[0].assetId = 'vendor.unknown';
  const unknownResult = validateArchitectureModel(unknown);
  assert.equal(unknownResult.ok, true);
  assert.ok(unknownResult.issues.some(i => i.code === 'ASSET_FALLBACK'));
  record('existing-tolerance', 'Asset aliases already normalize; unknown assets already fall back without blocking.', { alias: aliasResult, unknown: unknownResult });

  const grouped = base();
  grouped.nodes = [
    { id: 'api', label: 'FastAPI', kind: 'aws-service', assetId: 'aws.ecs.fargate' },
    { id: 'audio', label: 'AudioWorklet', kind: 'generic', containerId: 'browser' }
  ];
  grouped.containers = [{ id: 'browser', label: 'Browser', type: 'generic-group' }];
  const prepared = prepareArchitectureModel(grouped);
  const browser = prepared.containers.find(c => c.id === 'browser');
  assert.equal(browser.parentId, 'cloud-aws');
  record('external-boundary', 'A Browser group containing a generic AudioWorklet is incorrectly attached to AWS Cloud during preparation.', { before: grouped, after: prepared });

  const forbidden = base(); forbidden.nodes = [{ id: 'cf', label: 'CloudFront', kind: 'aws-service', assetId: 'aws.cloudfront' }];
  const semanticParser = new DeepSeekArchitectureParser('fake-key', 'fake-model', async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(forbidden) }, finish_reason: 'stop' }] })));
  const accepted = await semanticParser.parse('Vercel hosts the frontend. Do not include CloudFront.');
  assert.equal(accepted.model.nodes[0].assetId, 'aws.cloudfront');
  record('semantic-constraints', 'The production parser accepts schema-valid output contradicting an explicit exclusion; this is a synthetic injected response.', { requestedExclusion: 'CloudFront', acceptedAsset: accepted.model.nodes[0].assetId });

  const empty = { version: '1.0', nodes: [], connections: [], containers: [] };
  assert.equal(validateArchitectureModel(empty).ok, true);
  const partial = new DeepSeekArchitectureParser('fake-key', 'fake-model', async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(base()) }, finish_reason: 'length' }] })));
  const partialResult = await partial.parse('A larger architecture');
  assert.equal(partialResult.observation.finishReason, 'length');
  record('completion-and-ambiguity', 'There is no completeness or clarification contract; even finish_reason=length with parseable valid JSON is accepted.', { emptyGraphAccepted: true, lengthFinishAccepted: true });
  save('offline-evidence.json', findings);
  console.log(`Offline audit: ${findings.length} findings verified. No provider requests.`);
}

async function live() {
  // Load configured credentials inside the process. Never print or persist environment values.
  require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  const promptPath = process.argv[process.argv.indexOf('--live') + 1];
  if (!promptPath || !fs.existsSync(promptPath)) throw new Error('Supply the local prompt file after --live.');
  const prompt = fs.readFileSync(promptPath, 'utf8');
  let requests = 0;
  let rawContent;
  const fetcher = async (...args) => {
    requests++;
    assert.equal(requests, 1, 'Only one provider request is allowed by this audit.');
    const response = await fetch(...args);
    try {
      const body = await response.clone().json();
      rawContent = body.choices?.[0]?.message?.content;
    } catch {}
    return response;
  };
  const parser = new DeepSeekArchitectureParser(process.env.DEEPSEEK_KEY || process.env.DEEPSEEK_API_KEY, undefined, fetcher);
  let observation;
  const result = { timestamp: new Date().toISOString(), promptLength: prompt.length, requests: 0, requestedModel: parser.getModelName() };
  try {
    const parsed = await parser.parse(prompt, undefined, { onObservation: value => { observation = value; } });
    result.status = 'VALID_IR';
    result.issues = parsed.issues;
    result.counts = { nodes: parsed.model.nodes.length, edges: parsed.model.connections.length, containers: parsed.model.containers.length };
    save('live-valid-ir.json', parsed.model);
  } catch (error) {
    result.status = 'FAILED';
    result.code = error.code || 'DIAGNOSTIC_FAILURE';
    result.issues = error.issues || [];
  }
  result.requests = requests;
  result.observation = observation;
  // Persist only architecture content, never headers, request payload credentials, or provider envelope.
  if (typeof rawContent === 'string') fs.writeFileSync(path.join(output, 'live-output.txt'), rawContent, 'utf8');
  save('live-diagnostic.json', result);
  console.log(JSON.stringify(result, null, 2));
}

function analyzeCapture() {
  const raw = JSON.parse(fs.readFileSync(path.join(output, 'live-output.txt'), 'utf8'));
  const originalValidation = validateArchitectureModel(raw);
  assert.equal(originalValidation.ok, false);
  const candidate = structuredClone(raw);
  const changes = [];
  for (const connection of candidate.connections) {
    if (connection.relationship === 'media' || connection.relationship === 'deploy') {
      changes.push({ id: connection.id, from: connection.relationship, to: 'data', label: connection.label });
      connection.relationship = 'data';
    }
  }
  const validation = validateArchitectureModel(candidate);
  assert.equal(changes.length, 2);
  assert.equal(validation.ok, true);
  const prepared = prepareArchitectureModel(validation.value);
  const result = {
    note: 'Counterfactual analysis of the saved rerun only. Original capture is unchanged. No provider request or app document update.',
    counts: { nodes: raw.nodes.length, connections: raw.connections.length, containers: raw.containers.length },
    originalIssues: originalValidation.issues,
    trialChanges: changes,
    passesAfterOnlyThoseChanges: validation.ok,
    nodeContainment: raw.nodes.map(n => ({ id: n.id, containerId: n.containerId || null })),
    boundaryPreparation: raw.containers.map(c => ({ id: c.id, label: c.label, members: raw.nodes.filter(n => n.containerId === c.id).map(n => n.id), beforeParent: c.parentId || null, afterParent: prepared.containers.find(p => p.id === c.id)?.parentId || null })),
    edges: raw.connections.map(c => ({ source: c.source, target: c.target, label: c.label }))
  };
  save('capture-analysis.json', result);
  console.log(JSON.stringify(result, null, 2));
}

(async () => {
  if (process.argv.includes('--live')) await live();
  else if (process.argv.includes('--analyze-capture')) analyzeCapture();
  else await offline();
})().catch(() => { console.error('Audit failed; no credentials or exception details were logged.'); process.exitCode = 1; });
