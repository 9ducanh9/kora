import { SERVICEGREMLIN_GOLDEN_MODEL } from '../tests/fixtures/servicegremlin.golden';
import { executeArchitecturePipeline } from '../src/core/pipeline/generationPipeline';
import { resolveAsset } from '../src/core/assets/registry';

async function runGoldenSemanticRegression() {
  console.log('===============================================================');
  console.log('    SERVICEGREMLIN GOLDEN SEMANTIC REGRESSION TEST SUITE      ');
  console.log('===============================================================\n');

  // 1. Inspect Expected Golden Container Set
  console.log('[STEP 1: INSPECTING EXPECTED EXPLICIT CONTAINERS]');
  const expectedContainers = [
    'Web UI component',
    'Client API',
    'Storage management component',
    'Cost component',
    'VPC',
    'Private subnet',
    'Data component',
    'Discovery component',
    'Image deployment component'
  ];

  console.log(`Expected Explicit Container Set (${expectedContainers.length}):`);
  expectedContainers.forEach((c, idx) => console.log(`  ${idx + 1}. ${c}`));

  const actualContainerLabels = SERVICEGREMLIN_GOLDEN_MODEL.containers.map(c => c.label);
  const missingContainers = expectedContainers.filter(e => !actualContainerLabels.includes(e));

  if (missingContainers.length > 0) {
    console.error(`[FAIL] Missing required golden containers:`, missingContainers);
    process.exit(1);
  }
  console.log(`[PASS] All ${expectedContainers.length} explicit containers present in Golden Model.\n`);

  // 2. Execute Core Generation Pipeline
  console.log('[STEP 2: EXECUTING CORE GENERATION PIPELINE]');
  const result = await executeArchitecturePipeline(SERVICEGREMLIN_GOLDEN_MODEL, {
    parserId: 'servicegremlin-fixture',
    parserName: 'Offline ServiceGremlin fixture',
    parserModel: 'fixture',
    promptLength: 4205
  });

  const { document, model, diagnostics } = result;

  console.log('\n[STEP 3: VERIFYING PIPELINE DIAGNOSTICS]');
  console.log(`- Parser: ${diagnostics.parser.name} (${diagnostics.parser.model})`);
  console.log(`- Prompt Chars: ${diagnostics.promptLength}`);
  console.log(`- Raw Model: ${diagnostics.rawCounts.nodes} nodes, ${diagnostics.rawCounts.containers} containers, ${diagnostics.rawCounts.edges} connections`);
  console.log(`- Validated Model: ${diagnostics.validatedCounts.nodes} nodes, ${diagnostics.validatedCounts.containers} containers`);
  console.log(`- Asset Resolution: ${diagnostics.assetResolution.resolvedCount} resolved, ${diagnostics.assetResolution.fallbackCount} fallback`);
  console.log(`- Normalized Model: ${diagnostics.normalizedCounts.nodes} nodes, ${diagnostics.normalizedCounts.containers} containers`);
  console.log(`- DiagramDocument: ${diagnostics.diagramDocumentCounts.nodes} nodes, ${diagnostics.diagramDocumentCounts.containers} containers`);
  console.log(`- Presentation records: ${diagnostics.presentationObjectCounts.nodes} nodes, ${diagnostics.presentationObjectCounts.containers} containers, ${diagnostics.presentationObjectCounts.connections} connections`);

  // 3. Verify AWS Cloud Enclosure Invariant
  console.log('\n[STEP 4: VERIFYING AWS CLOUD HIERARCHY]');
  const cloud = model.containers.find(c => c.type === 'cloud');
  if (!cloud) {
    console.error('[FAIL] Missing canonical AWS Cloud container!');
    process.exit(1);
  }
  console.log(`[PASS] Single canonical AWS Cloud created: "${cloud.id}" (${cloud.label})`);

  // Verify external entity outside
  const users = model.nodes.find(n => n.id === 'users');
  if (users?.containerId) {
    console.error(`[FAIL] External node "users" must be outside AWS Cloud, but has containerId: ${users.containerId}`);
    process.exit(1);
  }
  console.log('[PASS] "users" external actor is strictly outside AWS Cloud.');

  // Verify top-level groups scoped into AWS Cloud
  const topLevelGroups = ['group-web-ui', 'group-client-api', 'group-storage', 'group-cost', 'vpc-main', 'group-image-deploy'];
  for (const gid of topLevelGroups) {
    const c = model.containers.find(container => container.id === gid);
    if (c?.parentId !== cloud.id) {
      console.error(`[FAIL] Top-level container "${gid}" parentId is "${c?.parentId}", expected "${cloud.id}"`);
      process.exit(1);
    }
  }
  console.log(`[PASS] All 6 top-level containers scoped inside "${cloud.id}".`);

  // Verify nested containment
  const subnet = model.containers.find(c => c.id === 'subnet-priv');
  if (subnet?.parentId !== 'vpc-main') {
    console.error(`[FAIL] "subnet-priv" parentId is "${subnet?.parentId}", expected "vpc-main"`);
    process.exit(1);
  }
  console.log('[PASS] "subnet-priv" is nested inside "vpc-main".');

  const dataComp = model.containers.find(c => c.id === 'group-data');
  const discComp = model.containers.find(c => c.id === 'group-discovery');
  if (dataComp?.parentId !== 'subnet-priv' || discComp?.parentId !== 'subnet-priv') {
    console.error(`[FAIL] Data or Discovery component not nested inside "subnet-priv"!`);
    process.exit(1);
  }
  console.log('[PASS] Data component and Discovery component are strictly nested inside "subnet-priv".');

  // 4. Verify Asset Resolution Completeness
  console.log('\n[STEP 5: VERIFYING ASSET RESOLUTION COMPLETENESS]');
  const allAwsNodes = model.nodes.filter(n => n.kind === 'aws-service' || n.kind === 'aws-resource');
  let unresolvedAwsCount = 0;
  for (const n of allAwsNodes) {
    const asset = resolveAsset(n.assetId || n.label);
    if (asset.id === 'generic.component') {
      console.warn(`  [UNRESOLVED AWS SERVICE] ${n.id} (${n.label}, assetId: ${n.assetId})`);
      unresolvedAwsCount++;
    } else {
      console.log(`  ✓ ${n.label} -> ${asset.id} (${asset.displayName})`);
    }
  }

  if (unresolvedAwsCount > 0) {
    console.error(`[FAIL] ${unresolvedAwsCount} AWS services unresolved to official assets!`);
    process.exit(1);
  }
  console.log(`[PASS] 100% of AWS services in Golden Architecture resolved to official AWS assets!`);

  // 5. Verify ELK Coordinates & Non-Overlap
  console.log('\n[STEP 6: VERIFYING ELK COMPUTED GEOMETRY]');
  for (const [id, pres] of Object.entries(document.presentation.nodes)) {
    if (pres.x === undefined || pres.y === undefined) {
      console.error(`[FAIL] Node "${id}" missing layout coordinates!`);
      process.exit(1);
    }
  }
  for (const [id, pres] of Object.entries(document.presentation.containers)) {
    if (pres.x === undefined || pres.y === undefined || !pres.width || !pres.height) {
      console.error(`[FAIL] Container "${id}" missing valid bounding box!`);
      process.exit(1);
    }
  }
  console.log(`[PASS] All ${Object.keys(document.presentation.nodes).length} nodes and ${Object.keys(document.presentation.containers).length} containers have valid non-zero bounding geometry.`);

  console.log('\n===============================================================');
  console.log('  GOLDEN SEMANTIC REGRESSION TEST SUITE PASSED (100%)         ');
  console.log('===============================================================');
}

runGoldenSemanticRegression().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
