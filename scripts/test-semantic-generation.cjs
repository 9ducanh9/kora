const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true }
}).outputText, filename);
const { validateRequirements } = require('../src/core/ai/semantics/requirements.ts');
const { checkSemanticRequirements } = require('../src/core/ai/semantics/checkModel.ts');
const { VerifiedDeepSeekArchitectureParser } = require('../src/core/ai/providers/verifiedDeepseek.parser.ts');
const { validateArchitectureModel } = require('../src/core/ir/validator.ts');
const { prepareArchitectureModel } = require('../src/core/architecture/prepareModel.ts');
const { readParseResponse } = require('../src/core/ai/parseResponse.ts');
const { createEmptyDiagramDocument } = require('../src/core/diagram/types.ts');
const { validateDiagramDocument } = require('../src/core/diagram/validator.ts');
const prompt = fs.readFileSync('tests/fixtures/livecap-current.prompt.txt', 'utf8');
const requirements = JSON.parse(fs.readFileSync('tests/fixtures/livecap-semantic-requirements.json', 'utf8'));
const clone = value => structuredClone(value);
const assets = { alb:'aws.elb.alb', ecs:'aws.ecs.fargate', cognito:'aws.cognito', transcribe:'aws.transcribe', translate:'aws.translate', s3:'aws.s3' };
const good = {
  version:'1.0',
  nodes:requirements.entities.filter(e=>e.kind==='node').map(e=>({id:e.id,label:e.label,kind:assets[e.id]?'aws-service':e.provider==='external'?'external':'generic',assetId:assets[e.id]||(e.role==='host'||e.role==='viewer'?'external.user':'generic.component'),...(requirements.placements.find(p=>p.entity===e.id)?{containerId:requirements.placements.find(p=>p.entity===e.id).parent}:{})})),
  containers:requirements.entities.filter(e=>e.kind==='container').map(e=>({id:e.id,label:e.label,type:({aws:'cloud',vpc:'vpc','public-subnet':'subnet-public'})[e.id]||'generic-group',...(requirements.placements.find(p=>p.entity===e.id)?{parentId:requirements.placements.find(p=>p.entity===e.id).parent}:{})})),
  connections:requirements.flows.map((f,i)=>({id:`e${i}`,source:f.from,target:f.to,label:f.label,relationship:f.relationship}))
};
function fake(queue, onCall) {
  const requests=[];
  const fetcher=async (_url,init)=>{
    requests.push(JSON.parse(init.body));
    onCall?.(requests.length,init);
    assert.ok(queue.length,'Unexpected extra provider request');
    const value=queue.shift();
    if(value instanceof Response) return value;
    return new Response(JSON.stringify({model:'injected-test-model',usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15},choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
  };
  return {parser:new VerifiedDeepSeekArchitectureParser('fake-key','test-model',fetcher),requests};
}
let passed=0;
async function check(name, run){await run();passed++;console.log(`PASS ${name}`);}
function mutation(change, expectedCode){const model=clone(good);change(model);assert.ok(checkSemanticRequirements(model,requirements).some(i=>i.code===expectedCode));}
(async()=>{
  await check('grounded LiveCap oracle is consistent with the original prompt and valid IR',()=>{
    assert.ok(validateRequirements(requirements,prompt).requirements);
    assert.equal(validateArchitectureModel(good).ok,true);
    assert.deepEqual(checkSemanticRequirements(good,requirements),[]);
    assert.deepEqual(checkSemanticRequirements(prepareArchitectureModel(good),requirements),[]);
  });
  await check('the current bad UI graph fails semantic checks although its IR is valid',()=>{
    const d=JSON.parse(fs.readFileSync('docs/audits/20261018-parser-user-input/current-diagram.json','utf8'));
    const model={version:'1.0',nodes:Object.values(d.semantic.nodes),connections:Object.values(d.semantic.connections),containers:Object.values(d.semantic.containers)};
    assert.equal(validateArchitectureModel(model).ok,true);
    const codes=checkSemanticRequirements(model,requirements).map(i=>i.code);
    assert.ok(codes.includes('SEMANTIC_ENTITY_MISSING'));
    assert.ok(codes.includes('SEMANTIC_EXTERNAL_IN_AWS'));
    assert.ok(codes.includes('SEMANTIC_FLOW_MISSING'));
    assert.ok(codes.includes('SEMANTIC_UNSUPPORTED_HOSTING_FLOW'));
  });
  await check('static hosting cannot replace the browser-origin API path',()=>mutation(m=>m.connections.find(e=>e.source==='host'&&e.target==='alb').source='vercel','SEMANTIC_FLOW_MISSING'));
  await check('merged host/viewer or missing viewer delivery is rejected',()=>{
    mutation(m=>m.nodes=m.nodes.filter(n=>n.id!=='viewer'),'SEMANTIC_ENTITY_MISSING');
    mutation(m=>m.connections=m.connections.filter(e=>!(e.source==='livekit'&&e.target==='viewer')),'SEMANTIC_FLOW_MISSING');
  });
  await check('subtitle return, fan-out, login and presigned download are required',()=>{
    for(const [source,target] of [['alb','host'],['alb','viewer'],['translate','ecs'],['host','cognito'],['host','s3']]) mutation(m=>m.connections=m.connections.filter(e=>e.source!==source||e.target!==target),'SEMANTIC_FLOW_MISSING');
  });
  await check('explicit external AWS nesting, not just inferred placement, is rejected',()=>{
    mutation(m=>m.containers.find(c=>c.id==='vercel-boundary').parentId='aws','SEMANTIC_EXTERNAL_IN_AWS');
    mutation(m=>m.containers.find(c=>c.id==='livekit-boundary').parentId='vpc','SEMANTIC_EXTERNAL_IN_AWS');
  });
  await check('wrong public subnet membership fails; intended external groups survive preparation',()=>{
    mutation(m=>m.nodes.find(n=>n.id==='ecs').containerId='vpc','SEMANTIC_PLACEMENT');
    const prepared=prepareArchitectureModel(good);
    assert.equal(prepared.containers.find(c=>c.id==='vercel-boundary').parentId,undefined);
  });
  await check('forbidden service and generic label disguise fail without banning transcript S3',()=>{
    for(const node of [{id:'invented',label:'Edge cache',kind:'aws-service',assetId:'aws.cloudfront'},{id:'invented',label:'CloudFront distribution',kind:'generic',assetId:'generic.component'}]) mutation(m=>m.nodes.push(node),'SEMANTIC_FORBIDDEN_COMPONENT');
    assert.ok(!checkSemanticRequirements(good,requirements).some(i=>i.entityId==='s3'));
  });
  await check('DNS does not acquire an unsupported HTTPS redirect path',()=>mutation(m=>m.connections.push({id:'dns-runtime',source:'dns',target:'vercel',label:'HTTPS Redirect',relationship:'request'}),'SEMANTIC_UNSUPPORTED_HOSTING_FLOW'));
  await check('extraction rejects static hosting proxy and S3 as URL signing service',()=>{
    const proxy=clone(requirements);proxy.flows.find(f=>f.from==='host'&&f.to==='alb').from='vercel';proxy.entities.find(e=>e.id==='alb').role='backend';
    assert.ok(validateRequirements(proxy,prompt).issues.some(i=>i.code==='REQUIREMENT_HOSTING_PROXY'));
    const signing=clone(requirements);signing.flows.push({from:'s3',to:'ecs',label:'Return presigned URL',relationship:'data',evidence:signing.entities.find(e=>e.id==='s3').evidence});
    assert.ok(validateRequirements(signing,prompt).issues.some(i=>i.code==='REQUIREMENT_SIGNING_SOURCE'));
  });
  await check('excluded asset aliases and explanatory suffixes do not bypass bans',()=>{
    const r=clone(requirements);r.exclusions.find(e=>e.assetId==='aws.vpc.nat-gateway').assetId='aws.nat_gateway';r.exclusions.find(e=>e.assetId==='aws.nat_gateway').label='NAT Gateway (not active)';
    const model=clone(good);model.nodes.push({id:'invented-nat',label:'Egress appliance',kind:'aws-service',assetId:'aws.vpc.nat-gateway'});
    assert.ok(checkSemanticRequirements(model,r).some(i=>i.code==='SEMANTIC_FORBIDDEN_COMPONENT'&&i.entityId==='invented-nat'));
    const disguised=clone(good);disguised.nodes.push({id:'invented-cf',label:'CloudFront',kind:'generic'});r.exclusions[0].label='Amazon CloudFront (not active)';
    assert.ok(checkSemanticRequirements(disguised,r).some(i=>i.code==='SEMANTIC_FORBIDDEN_COMPONENT'&&i.entityId==='invented-cf'));
  });
  await check('fabricated evidence, duplicate identities and cyclic/unknown placements are rejected',()=>{
    for(const change of [r=>r.entities[0].evidence='This is invented evidence',r=>r.entities.push(clone(r.entities[0])),r=>r.placements.push({entity:'browser',parent:'browser',evidence:r.entities[0].evidence}),r=>r.flows[0].to='unknown']){
      const r=clone(requirements);change(r);assert.equal(validateRequirements(r,prompt).requirements,undefined);
    }
  });
  await check('successful generation uses two calls and persists original requirements and limits',async()=>{
    const f=fake([requirements,good]);let sent=0;
    const result=await f.parser.parse(prompt,undefined,{onRequestSent:()=>sent++});
    assert.equal(sent,2);assert.equal(f.requests.length,2);
    assert.deepEqual(result.review.requirements,requirements);
    assert.equal(result.review.generationAttempts,1);
    assert.equal(result.observation.usage.totalTokens,30);
    const client=readParseResponse({success:true,model:result.model,issues:result.issues,review:result.review});
    const doc=createEmptyDiagramDocument();
    doc.semantic={nodes:Object.fromEntries(good.nodes.map(n=>[n.id,n])),containers:Object.fromEntries(good.containers.map(c=>[c.id,c])),connections:Object.fromEntries(good.connections.map(c=>[c.id,c]))};
    doc.presentation.nodes=Object.fromEntries(good.nodes.map(n=>[n.id,{x:0,y:0}]));
    doc.presentation.containers=Object.fromEntries(good.containers.map(c=>[c.id,{x:0,y:0,width:300,height:300}]));
    doc.metadata.source={kind:'prompt',prompt,parser:{id:f.parser.id},generatedAt:new Date().toISOString(),semanticReview:client.review};
    assert.equal(validateDiagramDocument(JSON.parse(JSON.stringify(doc))).ok,true);
  });
  await check('one bounded repair receives exact findings and must pass the same checks',async()=>{
    const broken=clone(good);broken.connections=broken.connections.filter(e=>!(e.source==='livekit'&&e.target==='viewer'));
    const f=fake([requirements,broken,good]);const result=await f.parser.parse(prompt);
    assert.equal(f.requests.length,3);assert.equal(result.review.generationAttempts,2);
    const repair=JSON.parse(f.requests[2].messages[1].content).repair;
    assert.ok(repair.findings.some(i=>i.code==='SEMANTIC_FLOW_MISSING'));
    assert.ok(result.issues.some(i=>i.code==='SEMANTIC_REPAIR_APPLIED'));
  });
  await check('repair failure stops after three calls rather than accepting or retrying forever',async()=>{
    const bad=clone(good);bad.nodes=bad.nodes.filter(n=>n.id!=='viewer');
    const f=fake([requirements,bad,bad]);
    await assert.rejects(()=>f.parser.parse(prompt),e=>e.code==='SEMANTIC_REQUIREMENTS_NOT_MET');
    assert.equal(f.requests.length,3);
  });
  await check('ungrounded extraction fails after one repair, before any drawing request',async()=>{
    const r=clone(requirements);r.notes[0].evidence='Invented fact';const f=fake([r,r]);
    await assert.rejects(()=>f.parser.parse(prompt),e=>e.code==='REQUIREMENT_EXTRACTION_FAILED');
    assert.equal(f.requests.length,2);
  });
  await check('extraction repair and graph share the same three-request budget',async()=>{
    const r=clone(requirements);r.placements[0].parent='undeclared';const f=fake([r,requirements,good]);
    const result=await f.parser.parse(prompt);assert.equal(f.requests.length,3);assert.equal(result.review.extractionAttempts,2);assert.equal(result.review.generationAttempts,1);
    const bad=clone(good);bad.nodes=bad.nodes.filter(n=>n.id!=='viewer');const f2=fake([r,requirements,bad]);
    await assert.rejects(()=>f2.parser.parse(prompt),e=>e.code==='SEMANTIC_REQUIREMENTS_NOT_MET');assert.equal(f2.requests.length,3);
  });
  await check('multiple declared ancestor constraints are valid and all checked',()=>{
    const r=clone(requirements);r.placements.push({entity:'ecs',parent:'vpc',evidence:r.placements.find(p=>p.entity==='ecs').evidence});
    assert.ok(validateRequirements(r,prompt).requirements);assert.deepEqual(checkSemanticRequirements(good,r),[]);
  });
  await check('checks are independent of LiveCap IDs and allow an explicitly modeled server backend',()=>{
    const r=clone(requirements), m=clone(good), rename=id=>`case-${id}`;
    r.entities.forEach(e=>e.id=rename(e.id));r.flows.forEach(f=>{f.from=rename(f.from);f.to=rename(f.to);});r.placements.forEach(p=>{p.entity=rename(p.entity);p.parent=rename(p.parent);});
    m.nodes.forEach(n=>{n.id=rename(n.id);if(n.containerId)n.containerId=rename(n.containerId);});m.containers.forEach(c=>{c.id=rename(c.id);if(c.parentId)c.parentId=rename(c.parentId);});m.connections.forEach(e=>{e.source=rename(e.source);e.target=rename(e.target);});
    assert.deepEqual(checkSemanticRequirements(m,r),[]);
    const proxy=clone(requirements);proxy.entities.find(e=>e.id==='vercel').role='backend';proxy.flows.push({from:'vercel',to:'ecs',label:'Explicit server proxy',relationship:'request',evidence:proxy.entities[0].evidence});
    assert.ok(!validateRequirements(proxy,prompt).issues.some(i=>i.code==='REQUIREMENT_HOSTING_PROXY'));
  });
  await check('whitespace-only evidence is rejected while source line endings normalize',()=>{
    const r=clone(requirements);r.entities[0].evidence='   ';
    assert.ok(validateRequirements(r,prompt).issues.some(i=>i.code==='REQUIREMENT_UNGROUNDED'));
    assert.ok(validateRequirements(requirements,prompt.replace(/\n/g,'\r\n')).requirements);
  });
  await check('authentication/rate failure never triggers semantic repair',async()=>{
    const f=fake([requirements,new Response('{}',{status:429})]);
    await assert.rejects(()=>f.parser.parse(prompt),e=>e.code==='PROVIDER_REQUEST_FAILED');assert.equal(f.requests.length,2);
  });
  await check('cancellation between extraction and graph prevents a second billable call',async()=>{
    const controller=new AbortController();const f=fake([requirements],()=>controller.abort());
    await assert.rejects(()=>f.parser.parse(prompt,undefined,{signal:controller.signal}),e=>e.name==='AbortError');assert.equal(f.requests.length,1);
  });
  await check('shared deadline covers extraction and does not reset for generation',async()=>{
    const f=fake([requirements],()=>{const start=Date.now();while(Date.now()-start<8){}});
    await assert.rejects(()=>f.parser.parse(prompt,undefined,{timeoutMs:2}),e=>e.code==='PROVIDER_TIMEOUT');assert.equal(f.requests.length,1);
  });
  console.log(`Semantic generation: ${passed}/23 groups passed; all provider calls injected.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
