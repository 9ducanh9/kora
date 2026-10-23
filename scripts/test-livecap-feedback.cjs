const fs=require('node:fs'), assert=require('node:assert/strict'),ts=require('typescript');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8').replaceAll('import.meta.url',"require('node:url').pathToFileURL(__filename).href"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText,file);
const {validateRequirements}=require('../src/core/ai/semantics/requirements.ts');
const {checkSemanticRequirements}=require('../src/core/ai/semantics/checkModel.ts');
const {validateArchitectureModel}=require('../src/core/ir/validator.ts');
const {prepareArchitectureModel}=require('../src/core/architecture/prepareModel.ts');
const {stageLayoutPriorities}=require('../src/core/layout/stagePriorities.ts');
const {LIVECAP_CURRENT_PROMPT}=require('../src/core/ai/examples/livecap.ts');
const {sourceEvidence}=require('../src/core/ai/semantics/sourceEvidence.ts');
const requirements=JSON.parse(fs.readFileSync('tests/fixtures/livecap-feedback-requirements.json','utf8'));
const good=JSON.parse(fs.readFileSync('tests/fixtures/livecap-feedback-model.json','utf8'));
const prompt=fs.readFileSync('tests/fixtures/livecap-feedback.prompt.txt','utf8');
let passed=0;
const check=(name,fn)=>{fn();passed++;console.log(`PASS ${name}`);};
const mutation=(change,code)=>{const m=structuredClone(good);change(m);assert.ok(checkSemanticRequirements(m,requirements).some(i=>i.code===code));};
check('LiveCap example matches the corrected feedback fixture and grounding',()=>{
 assert.equal(LIVECAP_CURRENT_PROMPT,prompt);
 const result=validateRequirements(requirements,prompt);
 assert.ok(result.requirements,JSON.stringify(result.issues));
 assert.equal(validateArchitectureModel(good).ok,true);
 assert.deepEqual(checkSemanticRequirements(good,requirements),[]);
 assert.deepEqual(checkSemanticRequirements(prepareArchitectureModel(good),requirements),[]);
});
check('ALB outside Default VPC/public subnet is rejected',()=>{
 mutation(m=>m.nodes.find(n=>n.id==='alb').containerId='aws','SEMANTIC_PLACEMENT');
 mutation(m=>m.nodes.find(n=>n.id==='alb').containerId='default_vpc','SEMANTIC_PLACEMENT');
});
check('subtitle, URL and JWT response cannot bypass ALB even if correct paths also exist',()=>{
 mutation(m=>m.connections.push({id:'shortcut',source:'fastapi',target:'host',relationship:'data',label:'Presigned URL response'}),'SEMANTIC_FORBIDDEN_FLOW');
 mutation(m=>m.connections=m.connections.filter(e=>!(e.source==='alb'&&e.target==='viewer')),'SEMANTIC_FLOW_MISSING');
});
check('local SDK signing stays distinct from remote room management',()=>{
 mutation(m=>m.connections=m.connections.filter(e=>e.source!=='fastapi'||e.target!=='fastapi'),'SEMANTIC_FLOW_MISSING');
 mutation(m=>m.connections.push({id:'remote-token',source:'fastapi',target:'livekit_sfu',label:'Issue participant token',relationship:'request'}),'SEMANTIC_FORBIDDEN_FLOW');
});
check('startup injection cannot become a runtime FastAPI fetch',()=>{
 mutation(m=>m.connections.push({id:'fetch-secret',source:'fastapi',target:'secrets',label:'Get secrets',relationship:'request'}),'SEMANTIC_FORBIDDEN_FLOW');
 mutation(m=>m.connections.find(e=>e.source==='secrets'&&e.target==='fastapi').description='stage=runtime','SEMANTIC_FLOW_STAGE');
});
check('via references and new prohibitions must still be grounded and declared',()=>{
 const bad=structuredClone(requirements);bad.flows.find(f=>f.via).via=['undeclared'];assert.ok(validateRequirements(bad,prompt).issues.some(i=>i.code==='REQUIREMENT_VIA_REFERENCE'));
 const ungrounded=structuredClone(requirements);ungrounded.forbiddenFlows[0].evidence='Invented prohibition';assert.ok(validateRequirements(ungrounded,prompt).issues.some(i=>i.code==='REQUIREMENT_UNGROUNDED'));
});
check('project-specific facts are not inferred for an unrelated standalone backend',()=>{
 const source='A browser calls an isolated backend directly. The backend fetches secrets at runtime.';
 const r={entities:[{id:'client',label:'Browser',kind:'node',provider:'external',role:'browser',evidence:'A browser calls an isolated backend directly.'},{id:'api',label:'Backend',kind:'node',provider:'unspecified',role:'backend',evidence:'A browser calls an isolated backend directly.'},{id:'secrets',label:'Secrets',kind:'node',provider:'unspecified',role:'other',evidence:'The backend fetches secrets at runtime.'}],flows:[{from:'client',to:'api',label:'HTTP',relationship:'request',evidence:'A browser calls an isolated backend directly.'},{from:'api',to:'secrets',label:'Runtime secret fetch',relationship:'request',stage:'runtime',evidence:'The backend fetches secrets at runtime.'}],placements:[],exclusions:[],notes:[]};
 const m={version:'1.0',nodes:r.entities.map(e=>({id:e.id,label:e.label,kind:e.provider==='external'?'external':'generic'})),containers:[],connections:r.flows.map((f,i)=>({id:`e${i}`,source:f.from,target:f.to,label:f.label,relationship:f.relationship,...(f.stage?{description:`stage=${f.stage}`}:{})}))};
 assert.ok(validateRequirements(r,source).requirements);assert.deepEqual(checkSemanticRequirements(m,r),[]);
});
check('layout preferences only act on explicit stages and do not reverse semantic edges',()=>{
 assert.equal(stageLayoutPriorities(undefined),undefined);
 assert.equal(stageLayoutPriorities('unclassified legacy edge'),undefined);
 assert.equal(stageLayoutPriorities('stage=runtime')['elk.layered.priority.direction'],'100');
 assert.equal(stageLayoutPriorities('stage=delivery')['elk.layered.priority.shortness'],'100');
 assert.equal(stageLayoutPriorities('stage=startup')['elk.layered.priority.direction'],'0');
});
(async()=>{
 const {VerifiedDeepSeekArchitectureParser}=require('../src/core/ai/providers/verifiedDeepseek.parser.ts');
 const make=queue=>{let calls=0;return {parser:new VerifiedDeepSeekArchitectureParser('fake-key','test-model',async()=>{calls++;assert.ok(queue.length);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(queue.shift())},finish_reason:'stop'}]}));}),calls:()=>calls};};
 const first=make([requirements,good]);const accepted=await first.parser.parse(prompt);assert.equal(first.calls(),2);assert.deepEqual(checkSemanticRequirements(accepted.model,requirements),[]);passed++;console.log('PASS verified generation accepts grounded via paths and startup stages');
 const broken=structuredClone(good);broken.connections.push({id:'invented-shortcut',source:'fastapi',target:'host',relationship:'data',label:'JWT directly'});
 const repaired=make([requirements,broken,good]);const result=await repaired.parser.parse(prompt);assert.equal(repaired.calls(),3);assert.equal(result.review.generationAttempts,2);passed++;console.log('PASS bounded repair must remove a bypass rather than merely adding the correct route');
 const relation={from:'terraform',to:'aws',label:'Manage infrastructure',relationship:'association',stage:'deployment',evidence:'Terraform quản lý hạ tầng AWS Aurel; frontend Vercel và LiveKit Cloud là các phần triển khai riêng.'};
 const boundaryFlow=structuredClone(requirements);boundaryFlow.flows.push(relation);
 const boundaryAnnotation=make([boundaryFlow,good]);const fixed=await boundaryAnnotation.parser.parse(prompt);assert.equal(boundaryAnnotation.calls(),2);assert.equal(fixed.review.extractionAttempts,1);assert.deepEqual(fixed.review.requirements.contextRelations,[relation]);assert.ok(fixed.issues.some(i=>i.code==='REQUIREMENT_CONTEXT_ANNOTATED'));assert.ok(!fixed.model.connections.some(e=>e.source==='terraform'&&e.target==='aws'));assert.deepEqual(validateRequirements(fixed.review.requirements,prompt).requirements,fixed.review.requirements);
 for(const change of [{stage:'runtime'},{relationship:'request'},{evidence:'Fabricated deployment evidence'}]){const invalid=structuredClone(boundaryFlow);Object.assign(invalid.flows.at(-1),change);assert.ok(!validateRequirements(invalid,prompt).requirements);}
 assert.ok(!boundaryFlow.contextRelations);assert.equal(boundaryFlow.flows.at(-1).to,'aws');passed++;console.log('PASS grounded deployment-boundary association is preserved as annotation; runtime and fabricated flows still fail');
 const sources=sourceEvidence(prompt),referenced=structuredClone(requirements);
 for(const section of ['entities','flows','forbiddenFlows','placements','exclusions','notes']) for(const row of referenced[section]??[]){const source=sources.find(s=>s.text.includes(row.evidence));assert.ok(source,row.evidence);row.evidence=source.id;}
 const byReference=make([referenced,good]);const cited=await byReference.parser.parse(prompt);assert.equal(byReference.calls(),2);assert.ok(cited.review.requirements.notes.every(n=>sources.some(s=>s.text===n.evidence)));assert.deepEqual(checkSemanticRequirements(cited.model,cited.review.requirements),[]);
 const unknown=structuredClone(referenced);unknown.entities[0].evidence='@source:999999';assert.ok(!validateRequirements(unknown,prompt).requirements);assert.ok(referenced.entities[0].evidence.startsWith('@source:'));
 const longSource='Dữ kiện '+('x😀'.repeat(500));assert.ok(sourceEvidence(longSource).every(s=>s.text.length<=600&&longSource.includes(s.text)));passed++;console.log('PASS source IDs resolve to original evidence; unknown refs fail and long Unicode sources stay lossless');
 console.log(`LiveCap feedback: ${passed}/12 groups passed; all provider calls injected.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
