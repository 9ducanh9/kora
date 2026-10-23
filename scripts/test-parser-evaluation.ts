import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DeepSeekArchitectureParser } from '../src/core/ai/providers/deepseek.parser';
import { PARSER_EVALUATION_CASES } from '../src/core/ai/evaluation/corpus';
import { runLiveEvaluation } from '../src/core/ai/evaluation/liveRunner';
import { assertReplayOutputIsolated, runReplayEvaluation } from '../src/core/ai/evaluation/replayRunner';
import { compareEvaluationCohorts, EvaluationCohortIdentity } from '../src/core/ai/evaluation/comparison';
import { evaluateParserOutput, PARSER_MATCHER_VERSION } from '../src/core/ai/evaluation/matcher';
import { ArchitectureParseError, ArchitectureParser } from '../src/core/ai/parser.interface';
import { KoraArchitectureModel } from '../src/core/ir/types';
import { validateArchitectureModel } from '../src/core/ir/validator';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
let passed = 0;
const check = (name: string, run: () => void | Promise<void>) => Promise.resolve().then(run).then(() => { passed++; process.stdout.write(`PASS ${name}\n`); });
const p01 = PARSER_EVALUATION_CASES[0];
const p02 = PARSER_EVALUATION_CASES[1];
const p03 = PARSER_EVALUATION_CASES[2];
const p05 = PARSER_EVALUATION_CASES[4];
const p10 = PARSER_EVALUATION_CASES[9];
const p13 = PARSER_EVALUATION_CASES[12];
const p15 = PARSER_EVALUATION_CASES[14];
const p16 = PARSER_EVALUATION_CASES[15];

function assertFailure(testCase: typeof p01, model: KoraArchitectureModel, expectedCode?: string) {
  const result = evaluateParserOutput(testCase, model);
  assert.equal(result.verdict, 'SEMANTIC_FAIL');
  if (expectedCode) assert.ok(result.diffs.some(diff => diff.code === expectedCode), `Expected ${expectedCode}, got ${result.diffs.map(diff => diff.code).join(', ')}`);
  return result;
}

async function main() {
  const tasks: Array<Promise<void>> = [];
  tasks.push(check('A01 provider IDs and array order do not affect verdict', () => {
    const baseline = evaluateParserOutput(p15,clone(p15.expected));
    const model = clone(p15.expected);
    const idMap = new Map<string, string>();
    model.nodes.forEach((node, index) => idMap.set(node.id, `renamed-node-${model.nodes.length - index}`));
    const containerMap = new Map<string, string>();
    model.containers.forEach((container, index) => containerMap.set(container.id, `renamed-container-${model.containers.length - index}`));
    model.nodes = model.nodes.map(node => ({ ...node, id: idMap.get(node.id)!, ...(node.containerId ? { containerId: containerMap.get(node.containerId)! } : {}) })).reverse();
    model.containers = model.containers.map(container => ({ ...container, id: containerMap.get(container.id)!, ...(container.parentId ? { parentId: containerMap.get(container.parentId)! } : {}) })).reverse();
    model.connections = model.connections.map((edge, index) => ({ ...edge, id: `renamed-edge-${index}`, source: idMap.get(edge.source)!, target: idMap.get(edge.target)! })).reverse();
    const renamed = evaluateParserOutput(p15, model);
    assert.equal(renamed.verdict, 'PASS');
    assert.deepEqual({nodes:renamed.nodes,containers:renamed.containers,topology:renamed.topology,connections:renamed.connections,fields:renamed.fields}, {nodes:baseline.nodes,containers:baseline.containers,topology:baseline.topology,connections:baseline.connections,fields:baseline.fields});
  }));
  tasks.push(check('A02 canonical asset aliases pass while wrong service asset fails', () => {
    const model = clone(p02.expected);
    const ecs = model.nodes.find(node => node.id === 'ecs')!;
    ecs.assetId = 'aws.fargate';
    const validated = validateArchitectureModel(model);
    assert.equal(validated.ok, true);
    if (validated.ok) assert.equal(evaluateParserOutput(p02, validated.value).verdict, 'PASS');
    ecs.assetId = 'aws.ecs';
    assertFailure(p02, model, 'WRONG_ASSET');
    const wording = clone(PARSER_EVALUATION_CASES[11].expected);
    wording.nodes.find(node => node.id === 'cloudfront')!.label = 'CloudFront';
    assert.equal(evaluateParserOutput(PARSER_EVALUATION_CASES[11], wording).verdict,'PASS');
  }));
  tasks.push(check('A03 missing, duplicated, and merged same-asset nodes fail', () => {
    const model = clone(p03.expected);
    model.nodes = model.nodes.filter(node => node.id !== 'backend-b');
    model.connections = model.connections.filter(edge => !edge.source.includes('backend-b') && !edge.target.includes('backend-b'));
    assertFailure(p03, model, 'NODE_MISSING');
    const duplicate = clone(p03.expected);
    duplicate.nodes.push({ ...duplicate.nodes.find(node => node.id === 'backend-a')!, id: 'duplicate-backend' });
    assertFailure(p03, duplicate, 'NODE_EXTRA');
  }));
  tasks.push(check('A04 wrong asset and generic fallback are reported independently of labels', () => {
    const model = clone(p01.expected);
    model.nodes.find(node => node.id === 'assets')!.assetId = 'generic.component';
    assertFailure(p01, model, 'WRONG_ASSET');
    const wrongKind = clone(p01.expected);
    wrongKind.nodes.find(node => node.id === 'assets')!.kind = 'generic';
    assertFailure(p01, wrongKind, 'WRONG_KIND');
  }));
  tasks.push(check('A05 reversed edge endpoints fail even when counts match', () => {
    const model = clone(p01.expected);
    model.connections[0] = { ...model.connections[0], source: 'cdn', target: 'users' };
    assertFailure(p01, model, 'EDGE_MISSING');
  }));
  tasks.push(check('A06 duplicate parallel edge and missing self-loop fail', () => {
    const p05Model = clone(p05.expected);
    p05Model.connections.splice(4, 1);
    assertFailure(p05, p05Model, 'EDGE_MISSING');
    const loopModel = clone(p13.expected);
    loopModel.connections = loopModel.connections.filter(edge => edge.source !== edge.target);
    assertFailure(p13, loopModel, 'EDGE_MISSING');
  }));
  tasks.push(check('A07 route path and case changes are strict label failures', () => {
    const model = clone(p05.expected);
    model.connections.find(edge => edge.source === 'cdn' && edge.target === 'alb' && edge.label === '/api/*')!.label = '/api/wake';
    assertFailure(p05, model, 'EDGE_LABEL_MISMATCH');
  }));
  tasks.push(check('A08 invented VPC membership and wrong parent fail', () => {
    const model = clone(p03.expected);
    model.nodes.find(node => node.id === 'alb')!.containerId = 'vpc';
    model.containers.find(container => container.id === 'subnet-a')!.parentId = 'cloud';
    const result = assertFailure(p03, model);
    assert.ok(result.diffs.some(diff => diff.code === 'NODE_MEMBERSHIP_MISMATCH'));
    assert.ok(result.diffs.some(diff => diff.code === 'CONTAINER_PARENT_MISMATCH'));
    const wrongContainerType = clone(p03.expected);
    wrongContainerType.containers.find(item => item.id === 'vpc')!.type = 'region';
    assertFailure(p03, wrongContainerType, 'WRONG_CONTAINER_TYPE');
  }));
  tasks.push(check('A09 duplicate labels stay distinct by named group', () => {
    const model = clone(p10.expected);
    model.nodes.reverse(); model.containers.reverse(); model.connections.reverse();
    assert.equal(evaluateParserOutput(p10, model).verdict, 'PASS');
    model.nodes.find(node => node.id === 'ingest-worker')!.containerId = 'export';
    assertFailure(p10, model, 'NODE_MEMBERSHIP_MISMATCH');
  }));
  tasks.push(check('A10 duplicate API Gateway roles in P15 map through containment', () => {
    const model = clone(p15.expected);
    model.nodes.find(node => node.id === 'api-client')!.id = 'provider-client-api';
    model.nodes.find(node => node.id === 'api-discovery')!.id = 'provider-cloud-api';
    for (const edge of model.connections) {
      if (edge.source === 'api-client') edge.source = 'provider-client-api';
      if (edge.target === 'api-client') edge.target = 'provider-client-api';
      if (edge.source === 'api-discovery') edge.source = 'provider-cloud-api';
      if (edge.target === 'api-discovery') edge.target = 'provider-cloud-api';
    }
    assert.equal(evaluateParserOutput(p15, model).verdict, 'PASS');
  }));
  tasks.push(check('A11 extra forbidden services and generic disguises fail', () => {
    const model = clone(PARSER_EVALUATION_CASES[7].expected);
    model.nodes.push({ id: 'fake-sqs', label: 'Archived worker', assetId: 'aws.sqs', kind: 'aws-service' });
    assertFailure(PARSER_EVALUATION_CASES[7], model, 'NODE_EXTRA');
  }));
  tasks.push(check('A12 empty graph rates use zero precision and null recall', () => {
    assert.equal(evaluateParserOutput(p16, clone(p16.expected)).verdict, 'PASS');
    const model = clone(p16.expected);
    model.nodes.push({ id: 'extra', label: 'Unexpected', assetId: 'generic.component', kind: 'generic' });
    const result = assertFailure(p16, model, 'NODE_EXTRA');
    assert.equal(result.nodes.precision, 0);
    assert.equal(result.nodes.recall, null);
  }));
  tasks.push(check('A13 strict IR validation rejects fields, references, cycles, and duplicate IDs', () => {
    const unknownField = clone(p01.expected) as KoraArchitectureModel & { unsafe?: string };
    (unknownField.nodes[0] as unknown as Record<string, unknown>).unexpected = true;
    assert.equal(validateArchitectureModel(unknownField).ok, false);
    const brokenReference = clone(p01.expected); brokenReference.connections[0].target = 'missing';
    assert.equal(validateArchitectureModel(brokenReference).ok, false);
    const cycle = clone(p03.expected); cycle.containers.find(item => item.id === 'vpc')!.parentId = 'subnet-a';
    assert.equal(validateArchitectureModel(cycle).ok, false);
    const duplicate = clone(p01.expected); duplicate.nodes[1].id = duplicate.nodes[0].id;
    assert.equal(validateArchitectureModel(duplicate).ok, false);
  }));
  tasks.push(check('A14 fake provider transport classifies valid, empty, invalid JSON, and HTTP failures', async () => {
    let response = new Response(JSON.stringify({ model:'test-model', system_fingerprint:'fp-test-123', choices:[{finish_reason:'stop',message:{content:JSON.stringify(p01.expected)}}], usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3} }), {status:200});
    const parser = new DeepSeekArchitectureParser('fake-key', 'test-model', async () => response);
    const success = await parser.parse(p01.prompt);
    assert.equal(success.observation?.returnedModel, 'test-model');
    assert.equal(success.observation?.returnedFingerprint, 'fp-test-123');
    assert.equal(success.observation?.finishReason, 'stop');
    response = new Response(JSON.stringify({ choices:[{finish_reason:'stop',message:{content:JSON.stringify(p01.expected)}}] }), {status:200});
    const unreportedMetadata = await parser.parse(p01.prompt);
    assert.equal(unreportedMetadata.observation?.returnedModel, undefined);
    assert.equal(unreportedMetadata.observation?.returnedFingerprint, undefined);
    response = new Response(JSON.stringify({ choices:[{message:{content:''}}] }), {status:200});
    await assert.rejects(() => parser.parse(p01.prompt), error => (error as {code?:string}).code === 'PROVIDER_EMPTY_RESPONSE');
    response = new Response('not-json', {status:200});
    await assert.rejects(() => parser.parse(p01.prompt), error => (error as {code?:string}).code === 'PROVIDER_INVALID_JSON');
    response = new Response('{}', {status:429});
    let observedHttpStatus: number | undefined;
    await assert.rejects(() => parser.parse(p01.prompt,undefined,{onObservation:observation => { observedHttpStatus=observation.httpStatus; }}), error => (error as {code?:string}).code === 'PROVIDER_REQUEST_FAILED');
    assert.equal(observedHttpStatus,429);
    response = new Response(JSON.stringify({ choices:[{message:{content:JSON.stringify({version:'1.0',nodes:[],connections:[],unknown:true})}}] }), {status:200});
    await assert.rejects(() => parser.parse(p01.prompt), error => (error as {code?:string}).code === 'PROVIDER_INVALID_MODEL');

    const rateLimitDirectory=await mkdtemp(join(tmpdir(),'kora-live-rate-limit-'));
    let requestCount=0;
    let parserCalls=0;
    const rateLimitParser: ArchitectureParser={
      id:'rate-limit-fake',name:'Rate limit test fake',
      async parse(_prompt,_context,options) {
        parserCalls++;
        options?.onRequestSent?.();
        options?.onObservation?.({requestedModel:'test-model',httpStatus:429,durationMs:1});
        throw new ArchitectureParseError('PROVIDER_REQUEST_FAILED','Provider throttled the request.');
      }
    };
    try {
      const stopped=await runLiveEvaluation({repetitions:1,maxRequests:4,timeoutMs:1000},[{...p01},{...PARSER_EVALUATION_CASES[1]}],rateLimitDirectory,{parser:rateLimitParser,hasCredential:true,requestedModel:'test-model'});
      requestCount=stopped.requestCount;
      assert.equal(requestCount,1);
      assert.equal(parserCalls,1);
      assert.equal(stopped.results.length,2);
      assert.equal(stopped.results[0].status,'PROVIDER_ERROR');
      assert.equal(stopped.results[0].httpStatus,429);
      assert.equal(stopped.results[1].status,'NOT_RUN');
      assert.ok(stopped.results[1].reason?.includes('HTTP 429'));
    } finally { await rm(rateLimitDirectory,{recursive:true,force:true}); }
  }));
  tasks.push(check('A15 AbortSignal stops the actual provider fetch', async () => {
    const controller = new AbortController(); let sends = 0;
    const abortingFetch: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted','AbortError')), { once:true });
    });
    const promise = new DeepSeekArchitectureParser('fake-key','test-model',abortingFetch).parse(p01.prompt, undefined, { signal:controller.signal, onRequestSent:() => sends++ });
    controller.abort();
    await assert.rejects(promise, error => (error as Error).name === 'AbortError');
    assert.equal(sends,1);
    const timeoutFetch: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('deadline','AbortError')), { once:true });
    });
    await assert.rejects(
      () => new DeepSeekArchitectureParser('fake-key','test-model',timeoutFetch).parse(p01.prompt,undefined,{timeoutMs:5}),
      error => (error as {code?:string}).code === 'PROVIDER_TIMEOUT' && (error as Error).message.includes('5 millisecond')
    );

    const runnerCases = PARSER_EVALUATION_CASES.map(testCase => ({ ...testCase, prompt:testCase.prompt || `offline:${testCase.id}` }));
    let callCount = 0;
    const budgetParser: ArchitectureParser = {
      id:'budget-fake',name:'Budget test fake',
      async parse(_prompt,_context,options) {
        const scheduledCase = runnerCases[callCount++];
        options?.onRequestSent?.();
        return {model:clone(scheduledCase.expected),issues:[]};
      }
    };
    const budgetDirectory = await mkdtemp(join(tmpdir(),'kora-live-budget-'));
    try {
      const budgetRun = await runLiveEvaluation({repetitions:3,maxRequests:2,timeoutMs:1000},runnerCases,budgetDirectory,{parser:budgetParser,hasCredential:true,requestedModel:'fake-model'});
      assert.equal(budgetRun.requestCount,2);
      assert.equal(callCount,2);
      assert.equal(budgetRun.results.length,48);
      assert.deepEqual(budgetRun.results.slice(0,2).map(result=>result.status),['PASS','PASS']);
      assert.ok(budgetRun.results.slice(2).every(result=>result.status==='NOT_RUN'));
      assert.equal(budgetRun.results[0].returnedModel,'unknown');
      const budgetLedger=await Promise.all(runnerCases.flatMap(testCase=>[1,2,3].map(trial=>readFile(join(budgetDirectory,'trials',testCase.id,`t${trial}`,'observation.json'),'utf8').then(value=>JSON.parse(value) as {status?:string;requestSent?:boolean}))));
      assert.equal(budgetLedger.length,48);
      assert.equal(budgetLedger.filter(row=>row.requestSent).length,2);
      assert.equal(budgetLedger.filter(row=>row.status==='NOT_RUN').length,46);
      const firstObservation=JSON.parse(await readFile(join(budgetDirectory,'trials','P01','t1','observation.json'),'utf8')) as {requestSent?:boolean;returnedFingerprint?:string};
      assert.equal(firstObservation.requestSent,true);
      assert.equal(firstObservation.returnedFingerprint,'unknown');
      const unsentObservation=JSON.parse(await readFile(join(budgetDirectory,'trials','P03','t1','observation.json'),'utf8')) as {requestSent?:boolean;status?:string};
      assert.equal(unsentObservation.requestSent,undefined);
      assert.equal(unsentObservation.status,'NOT_RUN');
    } finally { await rm(budgetDirectory,{recursive:true,force:true}); }

    let interruptCallCount=0;
    let markStarted!:()=>void;
    const started=new Promise<void>(resolveStarted=>{markStarted=resolveStarted;});
    const slowParser: ArchitectureParser = {
      id:'interrupt-fake',name:'Interrupt test fake',
      async parse(_prompt,_context,options) {
        interruptCallCount++;
        options?.onRequestSent?.();
        markStarted();
        return new Promise((_resolve,reject)=>{
          const abort=()=>reject(new DOMException('aborted','AbortError'));
          if(options?.signal?.aborted) abort();
          else options?.signal?.addEventListener('abort',abort,{once:true});
        });
      }
    };
    const interruptDirectory=await mkdtemp(join(tmpdir(),'kora-live-interrupt-'));
    const interruptController=new AbortController();
    try {
      const interruptedRunPromise=runLiveEvaluation({repetitions:3,maxRequests:48,timeoutMs:5000},runnerCases,interruptDirectory,{parser:slowParser,hasCredential:true,requestedModel:'fake-model',interruptionSignal:interruptController.signal});
      await started;
      interruptController.abort();
      const interruptedRun=await interruptedRunPromise;
      assert.equal(interruptedRun.requestCount,1);
      assert.equal(interruptCallCount,1);
      assert.equal(interruptedRun.results.length,48);
      assert.equal(interruptedRun.results[0].code,'RUN_INTERRUPTED');
      assert.ok(interruptedRun.results.slice(1).every(result=>result.status==='NOT_RUN'));
      const interruptionLedger=await Promise.all(runnerCases.flatMap(testCase=>[1,2,3].map(trial=>readFile(join(interruptDirectory,'trials',testCase.id,`t${trial}`,'observation.json'),'utf8').then(value=>JSON.parse(value) as {status?:string;requestSent?:boolean}))));
      assert.equal(interruptionLedger.length,48);
      assert.equal(interruptionLedger.filter(row=>row.requestSent).length,1);
      assert.equal(interruptionLedger.filter(row=>row.status==='NOT_RUN').length,47);
    } finally { await rm(interruptDirectory,{recursive:true,force:true}); }
  }));
  tasks.push(check('A16 offline corpus has no provider dependency and all source prompts are materialized', async () => {
    assert.equal(PARSER_EVALUATION_CASES.length,16);
    const materialized = new Map<string,string>();
    for (const testCase of PARSER_EVALUATION_CASES) {
      if (testCase.promptFile) {
        assert.equal(testCase.prompt,'',`${testCase.id} duplicates its prompt inline`);
        const prompt = await readFile(resolve(process.cwd(),testCase.promptFile),'utf8');
        assert.ok(prompt.trim().length > 0,`${testCase.id} prompt fixture is empty`);
        materialized.set(testCase.id,prompt.replace(/\r\n/g,'\n').trim());
      } else assert.ok(testCase.prompt.trim().length > 0,`${testCase.id} has no prompt`);
    }
    assert.deepEqual([...PARSER_EVALUATION_CASES.filter(item => item.promptFile).map(item => item.id)].sort(),['P02','P03','P14','P15']);

    const baseline = (await readFile(resolve(process.cwd(),'docs/specs/step-1-v1-baseline.md'),'utf8')).replace(/\r\n/g,'\n');
    const promptBlock = (heading: string) => {
      const match = baseline.match(new RegExp('### '+heading+'[^\\n]*\\n[\\s\\S]*?```text\\n([\\s\\S]*?)\\n```'));
      assert.ok(match,`Could not find ${heading} prompt in Step 1 baseline`);
      return match[1].replace(/\r\n/g,'\n').trim();
    };
    const p02Source = promptBlock('B2');
    const p03Source = promptBlock('B3');
    assert.equal(materialized.get('P02'),p02Source);
    const clarification = 'VPC Main is directly inside AWS Cloud.';
    assert.equal(materialized.get('P03'),`${p03Source}\n${clarification}`);
    const sentences = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean).sort();
    assert.deepEqual(sentences(materialized.get('P14')!),sentences(materialized.get('P03')!));

    const serviceGremlin = await readFile(resolve(process.cwd(),'tests/fixtures/servicegremlin.prompt.txt'),'utf8');
    const p15 = materialized.get('P15')!;
    assert.ok(p15.startsWith(serviceGremlin.replace(/\r\n/g,'\n').trim()));
    assert.ok(p15.includes('The two API Gateway occurrences labeled ServiceGremlin API are two distinct instances.'));

    const noCredentialDirectory=await mkdtemp(join(tmpdir(),'kora-live-no-credential-'));
    let providerCalls=0;
    const mustNotRunParser: ArchitectureParser={
      id:'no-credential-fake',name:'Must not run without a credential',
      async parse(){providerCalls++;throw new Error('Parser must not be called without credentials.');}
    };
    try {
      const unavailable=await runLiveEvaluation({repetitions:3,maxRequests:48,timeoutMs:1000},PARSER_EVALUATION_CASES.map(item=>({...item})),noCredentialDirectory,{parser:mustNotRunParser,hasCredential:false,requestedModel:'fake-model'});
      assert.equal(unavailable.requestCount,0);
      assert.equal(providerCalls,0);
      assert.equal(unavailable.results.length,48);
      assert.ok(unavailable.results.every(result=>result.status==='NOT_RUN'&&result.reason?.includes('Missing DEEPSEEK_API_KEY')));
      const noCredentialLedger=await Promise.all(PARSER_EVALUATION_CASES.flatMap(item=>[1,2,3].map(trial=>readFile(resolve(noCredentialDirectory,'trials',item.id,`t${trial}`,'observation.json'),'utf8').then(value=>JSON.parse(value) as {status?:string;requestSent?:boolean}))));
      assert.equal(noCredentialLedger.length,48);
      assert.ok(noCredentialLedger.every(row=>row.status==='NOT_RUN'&&!row.requestSent));
      const firstObservation=JSON.parse(await readFile(resolve(noCredentialDirectory,'trials','P01','t1','observation.json'),'utf8')) as {status?:string;returnedModel?:string};
      assert.equal(firstObservation.status,'NOT_RUN');
      assert.equal(firstObservation.returnedModel,'unknown');
    } finally { await rm(noCredentialDirectory,{recursive:true,force:true}); }
  }));
  tasks.push(check('A17 ambiguous oracle roles are a harness error', () => {
    const expected = clone(p01.expected);
    expected.nodes = [
      { id:'one',label:'same',assetId:'generic.component',kind:'generic' },
      { id:'two',label:'same',assetId:'generic.component',kind:'generic' }
    ];
    const ambiguousCase = { ...p01, expected, strictNodeLabels: { one:'same', two:'same' } };
    const actual = clone(expected); actual.nodes[0].id='actual-a'; actual.nodes[1].id='actual-b';
    const result = evaluateParserOutput(ambiguousCase, actual);
    assert.equal(result.verdict,'HARNESS_ERROR');
    assert.ok(result.diffs.some(diff => diff.code === 'ORACLE_AMBIGUOUS'));
  }));
  tasks.push(check('A18 cohort comparison refuses changed suite and provider configuration', () => {
    const identity: EvaluationCohortIdentity = { suiteVersion:'1',suiteSha256:'a',systemPromptSha256:'b',matcherVersion:PARSER_MATCHER_VERSION,provider:'deepseek',requestedModel:'deepseek-chat',generationOptions:{temperature:0.1} };
    assert.equal(compareEvaluationCohorts(identity,clone(identity)).comparable,true);
    const promptVariant = clone(identity); promptVariant.systemPromptSha256 = 'candidate-prompt';
    assert.equal(compareEvaluationCohorts(identity,promptVariant).comparable,true);
    assert.deepEqual(compareEvaluationCohorts(identity,promptVariant).variableDifferences,['systemPromptSha256']);
    const changed = clone(identity); changed.suiteSha256='different';
    assert.deepEqual(compareEvaluationCohorts(identity,changed).differences,['suiteSha256']);
  }));
  tasks.push(check('A19 replay detects a captured mutation without modifying its source artifact', async () => {
    const root=await mkdtemp(join(tmpdir(),'kora-replay-mutation-'));
    const sourceDirectory=join(root,'source');
    const outputDirectory=join(root,'replay');
    const sourceTrialDirectory=join(sourceDirectory,'trials','P01','t1');
    await mkdir(sourceTrialDirectory,{recursive:true});
    const mutated=clone(p01.expected);
    mutated.nodes.find(node=>node.id==='assets')!.label='Wrong label';
    const capturedBytes=JSON.stringify(mutated,null,2)+'\n';
    const sourceResults=JSON.stringify({results:[{caseId:'P01',trial:1,status:'PASS',requestSent:true,requestedModel:'captured-model'}]},null,2)+'\n';
    await writeFile(join(sourceTrialDirectory,'parser-ir.json'),capturedBytes,'utf8');
    await writeFile(join(sourceDirectory,'results.json'),sourceResults,'utf8');
    try {
      assertReplayOutputIsolated(sourceDirectory,outputDirectory);
      assert.throws(()=>assertReplayOutputIsolated(sourceDirectory,join(sourceDirectory,'nested-replay')),/separate, non-overlapping/);
      const replay=await runReplayEvaluation(sourceDirectory,outputDirectory,[{...p01}]);
      assert.equal(replay.length,1);
      assert.equal(replay[0].status,'SEMANTIC_FAIL');
      assert.ok(replay[0].semantic?.diffs.some(diff=>diff.code==='NODE_LABEL_MISMATCH'));
      assert.equal(replay[0].requestedModel,'captured-model');
      assert.equal(replay[0].reason,'Replay; no provider request was made.');
      assert.equal(await readFile(join(sourceTrialDirectory,'parser-ir.json'),'utf8'),capturedBytes);
      assert.equal(await readFile(join(sourceDirectory,'results.json'),'utf8'),sourceResults);
      const replayIr=JSON.parse(await readFile(join(outputDirectory,'trials','P01','t1','parser-ir.json'),'utf8')) as KoraArchitectureModel;
      assert.equal(replayIr.nodes.find(node=>node.id==='assets')?.label,'Wrong label');
      const malformedBytes='not-json\n';
      await writeFile(join(sourceTrialDirectory,'parser-ir.json'),malformedBytes,'utf8');
      const malformedReplay=await runReplayEvaluation(sourceDirectory,join(root,'malformed-replay'),[{...p01}]);
      assert.equal(malformedReplay[0].status,'INVALID_JSON');
      assert.equal(malformedReplay[0].code,'REPLAY_INVALID_JSON');
      assert.equal(await readFile(join(sourceTrialDirectory,'parser-ir.json'),'utf8'),malformedBytes);
    } finally { await rm(root,{recursive:true,force:true}); }
  }));
  tasks.push(check('A20 provider exception text is reduced to a safe public error', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => { throw new Error('secret-token-should-not-escape'); };
      await assert.rejects(() => new DeepSeekArchitectureParser('fake-key').parse(p01.prompt), error => {
        const safe = `${(error as Error).message} ${(error as {publicMessage?:string}).publicMessage ?? ''}`;
        assert.ok(!safe.includes('secret-token-should-not-escape'));
        return (error as {code?:string}).code === 'PROVIDER_REQUEST_FAILED';
      });
    } finally { globalThis.fetch=originalFetch; }
  }));
  tasks.push(check('A21 named roles can become ambiguous in parser output', () => {
    const expected = clone(p01.expected);
    expected.nodes = [
      { id:'worker-a',label:'Worker A',assetId:'aws.lambda',kind:'aws-service' },
      { id:'worker-b',label:'Worker B',assetId:'aws.lambda',kind:'aws-service' }
    ];
    const ambiguousCase = { ...p01, expected, strictNodeLabels:{'worker-a':'Worker A','worker-b':'Worker B'}, nodeAliases:{'worker-a':['Worker'],'worker-b':['Worker']} };
    const actual = clone(expected);
    actual.nodes = expected.nodes.map((node, index) => ({ ...node, id:`actual-${index}`, label:'Worker', assetId:'generic.component', kind:'generic' }));
    const result = evaluateParserOutput(ambiguousCase, actual);
    assert.equal(result.verdict,'SEMANTIC_FAIL');
    assert.ok(result.diffs.some(diff => diff.code === 'UNRESOLVED_IDENTITY' && Array.isArray((diff.actual as {candidates?:unknown[]}).candidates)));
  }));
  tasks.push(check('A22 text rules normalize NFC and whitespace but preserve case', () => {
    const model = clone(PARSER_EVALUATION_CASES[10].expected);
    model.nodes.find(node => node.id === 'audio')!.label = 'Bo\u0323\u0302   ghe\u0301p a\u0302m thanh';
    assert.equal(evaluateParserOutput(PARSER_EVALUATION_CASES[10], model).verdict,'PASS');
    const wrongCase = clone(p01.expected);
    wrongCase.nodes.find(node => node.id === 'assets')!.label = 'frontend assets';
    assertFailure(p01, wrongCase, 'NODE_LABEL_MISMATCH');
  }));
  tasks.push(check('A23 ANY scope and placement differ from exact ABSENT assertions', () => {
    const p12 = PARSER_EVALUATION_CASES[11];
    const model = clone(p12.expected);
    model.scope = { type:'network' };
    model.nodes.find(node => node.id === 'cloudfront')!.containerId = 'vpc';
    assert.equal(evaluateParserOutput(p12, model).verdict,'PASS');
    const absentPlacement = clone(p01.expected);
    absentPlacement.nodes.find(node => node.id === 'cdn')!.containerId = 'unmatched-boundary';
    assertFailure(p01, absentPlacement, 'NODE_MEMBERSHIP_MISMATCH');
  }));
  tasks.push(check('A24 frozen corpus protects prompts and rules from mutation', () => {
    assert.equal(Object.isFrozen(PARSER_EVALUATION_CASES),true);
    assert.equal(Object.isFrozen(p01),true);
    assert.equal(Object.isFrozen(p01.expected.nodes),true);
    assert.equal(Object.isFrozen(p01.assertions),true);
  }));
  tasks.push(check('A25 parallel-edge matching preserves exact match metrics', () => {
    const model = clone(p05.expected);
    const routeEdges = model.connections.filter(edge => edge.source === 'cdn' && edge.target === 'alb');
    routeEdges[0].label = '/ws/*';
    routeEdges[1].label = '/wrong';
    const result = assertFailure(p05, model, 'EDGE_LABEL_MISMATCH');
    assert.equal(result.topology.tp,6);
    assert.equal(result.connections.tp,5);
  }));
  tasks.push(check('A26 forbidden role labels catch generic disguises', () => {
    const p08 = PARSER_EVALUATION_CASES[7];
    const model = clone(p08.expected);
    model.nodes.push({ id:'generic-sqs',label:'SQS',assetId:'generic.component',kind:'generic' });
    const result = assertFailure(p08, model, 'FORBIDDEN_LABEL');
    assert.ok(result.diffs.some(diff => diff.code === 'NODE_EXTRA'));
  }));
  tasks.push(check('A27 explicit ABSENT text and scope rules reject present values', () => {
    const absentLabelCase = { ...p01, assertions:clone(p01.assertions!) };
    absentLabelCase.assertions.connections!['oracle-edge-1'].label = { mode:'absent' };
    const absentLabelModel = clone(p01.expected);
    delete absentLabelModel.connections[0].label;
    assert.equal(evaluateParserOutput(absentLabelCase,absentLabelModel).verdict,'PASS');
    absentLabelModel.connections[0].label = 'HTTPS';
    assertFailure(absentLabelCase,absentLabelModel,'EDGE_LABEL_MISMATCH');
    const absentScopeCase = { ...p01, assertions:{ ...clone(p01.assertions!), scope:{ mode:'absent' as const } } };
    const absentScopeModel = clone(p01.expected);
    delete absentScopeModel.scope;
    assert.equal(evaluateParserOutput(absentScopeCase,absentScopeModel).verdict,'PASS');
    assertFailure(absentScopeCase,clone(p01.expected),'SCOPE_MISMATCH');
  }));
  tasks.push(check('A28 declared interchangeable roles may permute without false ambiguity', () => {
    const expected = clone(p01.expected);
    expected.nodes = [
      { id:'one',label:'Worker',assetId:'aws.lambda',kind:'aws-service' },
      { id:'two',label:'Worker',assetId:'aws.lambda',kind:'aws-service' }
    ];
    expected.connections = [];
    const interchangeableCase = { ...p01, expected, strictNodeLabels:undefined, interchangeableNodeRoles:[['one','two']] };
    const actual = clone(expected);
    actual.nodes[0].id='provider-a'; actual.nodes[1].id='provider-b';
    assert.equal(evaluateParserOutput(interchangeableCase,actual).verdict,'PASS');
  }));
  tasks.push(check('A29 all frozen oracle fixtures satisfy their own assertions', () => {
    for (const testCase of PARSER_EVALUATION_CASES) {
      const result = evaluateParserOutput(testCase,clone(testCase.expected));
      assert.equal(result.verdict,'PASS',`${testCase.id}: ${result.diffs.map(diff => diff.code).join(', ')}`);
    }
  }));
  tasks.push(check('A30 container identity uses named parent paths when labels repeat', () => {
    const expected: KoraArchitectureModel = {
      version:'1.0', scope:{type:'overall-architecture'}, nodes:[], connections:[],
      containers:[
        {id:'root-a',label:'Group A',type:'generic-group'},
        {id:'root-b',label:'Group B',type:'generic-group'},
        {id:'child-a',label:'Component',type:'generic-group',parentId:'root-a'},
        {id:'child-b',label:'Component',type:'generic-group',parentId:'root-b'}
      ]
    };
    const testCase = { ...p01, expected, assertions:{scope:{mode:'any' as const}} };
    const actual = clone(expected);
    const ids = new Map([['root-a','provider-a'],['root-b','provider-b'],['child-a','provider-child-a'],['child-b','provider-child-b']]);
    actual.containers = actual.containers.map(item => ({...item,id:ids.get(item.id)!,...(item.parentId?{parentId:ids.get(item.parentId)!}:{})})).reverse();
    assert.equal(evaluateParserOutput(testCase,actual).verdict,'PASS');
  }));
  await Promise.all(tasks);
  process.stdout.write(`Parser evaluation harness: ${passed}/${tasks.length} mutation and adapter groups passed.\n`);
}

void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode=1; });
