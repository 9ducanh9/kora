const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8').replaceAll('import.meta.url',"require('node:url').pathToFileURL(__filename).href"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText,file);
const {TOPOLOGY_LAYOUT_CASES}=require('../tests/fixtures/layout/topologies.ts');
const {BASELINE_CASES}=require('../tests/fixtures/baseline/cases.ts');
const {SERVICEGREMLIN_GOLDEN_MODEL}=require('../tests/fixtures/servicegremlin.golden.ts');
const {prepareArchitectureModel}=require('../src/core/architecture/prepareModel.ts');
const {computeBestCompoundLayoutInWorker}=require('../src/core/layout/layoutWorkerClient.ts');
const {computeCompoundLayoutDetailed}=require('../src/core/layout/elkCompoundLayout.ts');
const {validateDiagramDocument}=require('../src/core/diagram/validator.ts');
const {topologyRanks}=require('../src/core/layout/topologyComposition.ts');
const {createStressLayoutModel}=require('../tests/fixtures/layout/models.ts');
const {executeArchitecturePipeline}=require('../src/core/pipeline/generationPipeline.ts');
const semantic=m=>({...(m.scope?{scope:m.scope}:{}),nodes:Object.fromEntries(m.nodes.map(n=>[n.id,n])),containers:Object.fromEntries(m.containers.map(c=>[c.id,c])),connections:Object.fromEntries(m.connections.map(c=>[c.id,c]))});
(async()=>{
 const results=[];
 for(const c of [...BASELINE_CASES.map(c=>({id:c.id,model:c.model,spine:[]})),...TOPOLOGY_LAYOUT_CASES,{id:'servicegremlin',model:SERVICEGREMLIN_GOLDEN_MODEL,spine:[]}]){
   const model=prepareArchitectureModel(c.model),first=await computeCompoundLayoutDetailed(model,{composition:'architecture'}),best=await computeBestCompoundLayoutInWorker(model);
   assert.equal(validateDiagramDocument(best.document).ok,true,c.id+' document');assert.deepEqual(best.document.semantic,semantic(model),c.id+' semantic preservation');
   const blocking=best.findings.filter(f=>f.severity==='blocking');assert.deepEqual(blocking,[],c.id+' blocking findings');
   if(c.spine.length&&best.composition==='architecture')for(let i=1;i<c.spine.length;i++)assert.ok(best.document.presentation.nodes[c.spine[i]].x>best.document.presentation.nodes[c.spine[i-1]].x,c.id+' primary order');
   if(TOPOLOGY_LAYOUT_CASES.some(f=>f.id===c.id))assert.equal(first.composition,'architecture',c.id+' shared composition candidate');
   if(['serverless-api','microservices','generic-pipeline'].includes(c.id)){
     const generated=await executeArchitecturePipeline(c.model,{parserId:'offline-fixture',parserName:'Injected fixture',promptLength:0});
     assert.deepEqual(generated.document.presentation,best.document.presentation,c.id+' Generate and Auto Layout share the same policy');
     assert.deepEqual(generated.diagnostics.layout.findings,[]);
   }
   results.push({id:c.id,first:first.composition,firstBlocking:first.findings.filter(f=>f.severity==='blocking').length,selected:best.composition,blocking:blocking.length});console.log('PASS '+c.id+' '+JSON.stringify(results.at(-1)));
 }
 const ranks=topologyRanks(['x','y','z'],[{id:'xy',source:'x',target:'y'},{id:'yx',source:'y',target:'x'},{id:'yz',source:'y',target:'z'}]);assert.equal(ranks.get('x'),ranks.get('y'));assert.ok(ranks.get('z')>ranks.get('x'));console.log('PASS cycles collapse before DAG ranking');
 const large=prepareArchitectureModel(createStressLayoutModel()),started=Date.now(),largeResult=await computeBestCompoundLayoutInWorker(large,{timeoutMs:10000});assert.equal(largeResult.composition,'layered');assert.deepEqual(largeResult.document.semantic,semantic(large));assert.deepEqual(largeResult.findings,[]);assert.ok(Date.now()-started<10000);results.push({id:'large-compound-100',selected:largeResult.composition,blocking:0});console.log('PASS large imported graph uses bounded compound ELK strategy without semantic loss');
 fs.mkdirSync('docs/audits/20261018-shared-layout',{recursive:true});fs.writeFileSync('docs/audits/20261018-shared-layout/results.json',JSON.stringify(results,null,2)+'\n');console.log(`Shared Kora layout: ${results.length} independent architectures passed; no AI calls.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
