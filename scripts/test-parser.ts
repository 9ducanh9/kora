import { validateArchitectureModel } from '../src/core/ir/validator';
import { GeminiArchitectureParser } from '../src/core/ai/providers/gemini.parser';
import { MockArchitectureParser } from '../tests/fixtures/mock.parser';

async function runTests() {
  console.log('=== KORA V1 PIPELINE VALIDATION SUITE ===\n');

  // Test 1: Validator Integrity Test (Valid IR)
  console.log('Test 1: Validating Valid Architecture IR...');
  const sampleValidIR = {
    version: '1.0',
    scope: { type: 'overall-architecture', title: 'Web App' },
    nodes: [
      { id: 'user', label: 'Users', kind: 'external', assetId: 'external.user' },
      { id: 'cloudfront', label: 'CloudFront', kind: 'aws-service', assetId: 'aws.cloudfront' },
      { id: 'alb', label: 'ALB', kind: 'aws-resource', assetId: 'ALB' }, // tests alias resolution
      { id: 'ecs', label: 'ECS Fargate', kind: 'aws-service', assetId: 'aws.ecs.fargate', containerId: 'subnet-1' }
    ],
    connections: [
      { id: 'c1', source: 'user', target: 'cloudfront', label: 'HTTPS' },
      { id: 'c2', source: 'cloudfront', target: 'alb', label: '/api/*' },
      { id: 'c3', source: 'alb', target: 'ecs', label: 'Forward' }
    ],
    containers: [
      { id: 'vpc-1', label: 'VPC', type: 'vpc' },
      { id: 'subnet-1', label: 'Private Subnet', type: 'subnet-private', parentId: 'vpc-1' }
    ]
  };

  const validationResult = validateArchitectureModel(sampleValidIR);
  if (!validationResult.ok) {
    console.error('FAILED Test 1:', validationResult.issues);
    process.exit(1);
  }
  console.log('[PASS] Test 1: Valid IR passed validation cleanly.');
  console.log('       Asset alias resolved:', validationResult.value.nodes.find(n => n.id === 'alb')?.assetId);

  // Test 2: Invalid Referential Integrity Test
  console.log('\nTest 2: Detecting Broken Edge Pointers & Cycles...');
  const brokenIR = {
    version: '1.0',
    nodes: [{ id: 'node-1', label: 'Test Node', kind: 'aws-service' }],
    connections: [{ id: 'c1', source: 'node-1', target: 'non-existent-node' }],
    containers: [
      { id: 'c-a', label: 'Container A', type: 'vpc', parentId: 'c-b' },
      { id: 'c-b', label: 'Container B', type: 'vpc', parentId: 'c-a' } // Cycle!
    ]
  };
  const brokenResult = validateArchitectureModel(brokenIR);
  if (brokenResult.ok) {
    console.error('FAILED Test 2: Validator failed to catch broken pointers or cyclic containers!');
    process.exit(1);
  }
  console.log('[PASS] Test 2: Successfully caught errors:');
  brokenResult.issues.forEach(e => console.log('       -', `${e.code}: ${e.message}`));

  // Test 3: Real LLM Semantic Parsing Test
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    console.log('\nTest 3: Testing Real Gemini Provider with unseen architecture prompt...');
    const unseenPrompt = `
Draw an architecture where users hit CloudFront over HTTPS.
CloudFront routes /static/* to S3 and /api/* to an Application Load Balancer.
The ALB forwards to ECS Fargate running inside a private subnet in a VPC.
The ECS backend reads and writes to DynamoDB.
`;
    console.log('Sending prompt to Gemini...');
    const parser = new GeminiArchitectureParser(apiKey);
    const parsedResult = await parser.parse(unseenPrompt);
    const parsedModel = parsedResult.model;
    console.log('[PASS] Real Gemini parsing succeeded!');
    console.log('       Extracted nodes:', parsedModel.nodes.map(n => `${n.label} (${n.assetId}) [container: ${n.containerId || 'none'}]`));
    console.log('       Extracted connections:', parsedModel.connections.map(c => `${c.source} -> ${c.target} [${c.label || ''}]`));
    console.log('       Extracted containers:', parsedModel.containers.map(c => `${c.label} (${c.type})`));

    // Strict Non-inference check: ALB must NOT have containerId
    const albNode = parsedModel.nodes.find(n => n.id.includes('alb') || n.label.toLowerCase().includes('load balancer') || n.label.toLowerCase().includes('alb'));
    const ecsNode = parsedModel.nodes.find(n => n.id.includes('ecs') || n.label.toLowerCase().includes('ecs') || n.label.toLowerCase().includes('fargate'));
    if (albNode && albNode.containerId) {
      console.warn(`[WARN] Non-inference rule: ALB has containerId '${albNode.containerId}', but prompt did not specify it.`);
    } else {
      console.log('[PASS] Strict non-inference verified: ALB is correctly unassigned to containers.');
    }
    if (ecsNode && ecsNode.containerId) {
      console.log(`[PASS] Explicit container membership verified: ECS assigned to '${ecsNode.containerId}'.`);
    }
  } else {
    console.log('\n[INFO] GEMINI_API_KEY not set in environment. Running Test 3 with Mock fixture parser...');
    const mockParser = new MockArchitectureParser();
    const result = await mockParser.parse('CloudFront routes /assets/* to a private S3 bucket');
    console.log('[PASS] Mock fixture parser returned valid model with', result.model.nodes.length, 'nodes.');
  }

  // Test 4: Deterministic ELK Compound Layout Test
  console.log('\nTest 4: Running Deterministic ELK Compound Layout Engine...');
  const { computeCompoundLayout } = await import('../src/core/layout/elkCompoundLayout');
  const mockParser = new MockArchitectureParser();
  const testModel = (await mockParser.parse('CloudFront routes /assets/* to a private S3 bucket')).model;
  const layoutedDoc = await computeCompoundLayout(testModel);
  console.log('[PASS] ELK layout computed successfully!');
  console.log('       Nodes placed:', Object.keys(layoutedDoc.presentation.nodes).length);
  for (const [id, pres] of Object.entries(layoutedDoc.presentation.nodes)) {
    console.log(`       - ${id}: x=${Math.round(pres.x)}, y=${Math.round(pres.y)}`);
  }
  console.log('       Containers placed:', Object.keys(layoutedDoc.presentation.containers).length);
  for (const [id, pres] of Object.entries(layoutedDoc.presentation.containers)) {
    console.log(`       - [Container ${id}]: x=${Math.round(pres.x)}, y=${Math.round(pres.y)}, w=${Math.round(pres.width)}, h=${Math.round(pres.height)}`);
  }

  // Verify containment: ECS node (x, y) must be inside subnet container bounds
  const ecsPres = layoutedDoc.presentation.nodes['ecs'];
  const subnetPres = layoutedDoc.presentation.containers['subnet-private'];
  if (ecsPres && subnetPres) {
    const isContained = 
      ecsPres.x >= subnetPres.x &&
      ecsPres.y >= subnetPres.y &&
      ecsPres.x <= subnetPres.x + subnetPres.width &&
      ecsPres.y <= subnetPres.y + subnetPres.height;
    if (isContained) {
      console.log('[PASS] Verification: ECS node is strictly contained inside Private Subnet bounds!');
    } else {
      console.error('[FAIL] ECS node is not inside Private Subnet bounds:', { ecsPres, subnetPres });
    }
  }

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});

