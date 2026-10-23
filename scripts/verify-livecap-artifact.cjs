// Independent, prompt-specific acceptance checks for a saved real LiveCap result; no AI/network.
const fs=require('node:fs'), assert=require('node:assert/strict'), ts=require('typescript');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText,file);
const {validateDiagramDocument}=require('../src/core/diagram/validator.ts');
const {validateRequirements,normalizedText}=require('../src/core/ai/semantics/requirements.ts');
const {checkSemanticRequirements}=require('../src/core/ai/semantics/checkModel.ts');
const artifact=process.argv[2]||'docs/audits/20261018-parser-user-input/semantic-generation-final.json';
const d=JSON.parse(fs.readFileSync(artifact,'utf8')), source=d.metadata.source;
assert.equal(validateDiagramDocument(d).ok,true);
assert.equal(normalizedText(source.prompt),normalizedText(fs.readFileSync('tests/fixtures/livecap-current.prompt.txt','utf8')));
const r=source.semanticReview.requirements;
assert.ok(validateRequirements(r,source.prompt).requirements);
const model={version:'1.0',nodes:Object.values(d.semantic.nodes),connections:Object.values(d.semantic.connections),containers:Object.values(d.semantic.containers)};
assert.deepEqual(checkSemanticRequirements(model,r),[]);
const nodes=d.semantic.nodes, containers=d.semantic.containers, edges=model.connections;
const role=type=>r.entities.find(e=>e.kind==='node'&&e.role===type)?.id;
const asset=id=>model.nodes.find(n=>n.assetId===id)?.id;
const host=role('host'),viewer=role('viewer'),hosting=role('frontend-hosting'),relay=role('media-relay'),backend=role('backend'),dns=role('dns');
const alb=asset('aws.elb.alb'),s3=asset('aws.s3'),identity=asset('aws.cognito');
assert.ok(host&&viewer&&hosting&&relay&&backend&&dns&&alb&&s3&&identity);
const flow=(from,to,pattern)=>edges.some(e=>e.source===from&&e.target===to&&(!pattern||pattern.test(e.label||'')));
const ancestors=id=>{const chain=[];let parent=nodes[id]?.containerId??containers[id]?.parentId;while(parent&&!chain.includes(parent)){chain.push(parent);parent=containers[parent]?.parentId;}return chain;};
const checks={
  browser_origin:flow(host,alb,/WSS/i)&&!flow(hosting,alb),
  distinct_host_viewer:host!==viewer,
  webRTC_delivery:flow(host,relay,/WebRTC/i)&&flow(relay,viewer,/WebRTC/i),
  separate_media_control:flow(backend,relay,/room|token/i)&&!edges.some(e=>(e.source===alb||e.source===backend)&&/WebRTC.*(media|video|audio)/i.test(e.label||'')),
  subtitle_return:flow(backend,host,/subtitle|phụ đề/i)&&flow(backend,viewer,/subtitle|phụ đề/i),
  external_boundaries:[host,viewer,hosting,relay].every(id=>!ancestors(id).some(parent=>containers[parent]?.type==='cloud')),
  public_subnet:ancestors(backend).some(id=>containers[id]?.type==='subnet-public')&&ancestors(backend).some(id=>containers[id]?.type==='vpc'),
  dns_not_http_proxy:!edges.some(e=>(e.source===dns||e.target===dns)&&/HTTPS|Redirect/i.test(e.label||'')),
  host_login_only:flow(host,identity)&&!flow(viewer,identity),
  transcript_write:flow(backend,s3,/write|store|lưu/i),
  presigned_URL_to_browser:flow(backend,host,/presigned/i)&&flow(host,s3,/presigned/i)&&!flow(s3,backend,/presigned/i),
  prohibited_services_absent:!model.nodes.some(n=>['aws.cloudfront','aws.vpc.nat-gateway','aws.lambda','aws.waf','aws.polly','aws.comprehend','aws.ivs','aws.bedrock'].includes(n.assetId)),
  notes_keep_limits_and_dates:/300/.test(r.notes.map(n=>n.text).join(' '))&&/MAX_CONCURRENT_SESSIONS\s*2/.test(r.notes.map(n=>n.text).join(' '))&&/16\/10\/2026/.test(r.notes.map(n=>n.text).join(' '))
};
for(const [name,passed] of Object.entries(checks))assert.equal(passed,true,`LiveCap acceptance failed: ${name}`);
const evidence={artifact,counts:{nodes:model.nodes.length,containers:model.containers.length,connections:edges.length},extractionAttempts:source.semanticReview.extractionAttempts,generationAttempts:source.semanticReview.generationAttempts,checks,limits:'Checks the listed LiveCap acceptance criteria only; not a proof of complete extraction or live AWS state.'};
fs.writeFileSync('docs/audits/20261018-parser-user-input/semantic-generation-acceptance.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
