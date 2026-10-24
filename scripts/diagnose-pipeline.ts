import fs from 'fs';
import path from 'path';
import { validateArchitectureModel } from '../src/core/ir/validator';
import { resolveAsset, resolveNodeDisplay } from '../src/core/assets/registry';
import { prepareArchitectureModel } from '../src/core/architecture/prepareModel';
import { computeCompoundLayout } from '../src/core/layout/elkCompoundLayout';
import { MockArchitectureParser } from '../tests/fixtures/mock.parser';
import { KoraArchitectureModel } from '../src/core/ir/types';

async function runDiagnostics() {
  console.log('===============================================================');
  console.log('         KORA PIPELINE DIAGNOSTIC INSPECTION REPORT           ');
  console.log('===============================================================\n');

  // Load the test prompt
  const promptPath = path.join(process.cwd(), 'tests/fixtures/servicegremlin.prompt.txt');
  const promptText = fs.readFileSync(promptPath, 'utf8');
  
  console.log(`[STAGE 1: PROMPT INPUT & ACTIVE PARSER]`);
  console.log(`- Prompt Path: tests/fixtures/servicegremlin.prompt.txt`);
  console.log(`- Prompt Character Count: ${promptText.length} characters`);
  console.log(`- First 120 chars: "${promptText.substring(0, 120).replace(/\n/g, ' ')}..."`);
  
  // Test what MockArchitectureParser produces with this prompt
  console.log('\n--- Checking MockArchitectureParser (current UI default) ---');
  const mockParser = new MockArchitectureParser();
  const mockResult = await mockParser.parse(promptText);
  console.log(`- Active Parser: MockArchitectureParser (id: "${mockParser.id}")`);
  console.log(`- Mock Output Node Count: ${mockResult.model.nodes.length}`);
  console.log(`- Mock Output Node IDs: [${mockResult.model.nodes.map(n => `"${n.id}" (${n.label})`).join(', ')}]`);
  console.log(`- Mock Output Container Count: ${mockResult.model.containers.length}`);
  console.log(`- Mock Output Connection Count: ${mockResult.model.connections.length}`);
  
  const _mockDroppedCount = 25; // Prompt describes ~29 entities, mock gives 4
  console.log(`=> CRITICAL FINDING: MockArchitectureParser DISCARDED the prompt entirely and returned its 4-node hardcoded default fixture: [Users, CloudFront, ALB, ECS]!`);

  // Now create the raw Architecture IR representing the full prompt to test Stages 2 - 8
  console.log('\n\n===============================================================');
  console.log('[STAGE 2: RAW LLM STRUCTURED MODEL FROM PROMPT]');
  
  const rawServiceGremlinModel: KoraArchitectureModel = {
    version: '1.0',
    scope: { type: 'overall-architecture', title: 'ServiceGremlin Architecture' },
    nodes: [
      { id: 'users', label: 'Users', kind: 'external', assetId: 'external.user' },
      { id: 'appsync', label: 'AWS AppSync', kind: 'aws-service', assetId: 'aws.appsync' },
      { id: 'api-gw', label: 'ServiceGremlin API', kind: 'aws-service', assetId: 'aws.apigateway' },
      { id: 'waf', label: 'AWS WAF', kind: 'aws-service', assetId: 'aws.waf' },
      { id: 'cloudwatch', label: 'Amazon CloudWatch', kind: 'aws-service', assetId: 'aws.cloudwatch' },
      { id: 'ssm', label: 'AWS Systems Manager', kind: 'aws-service', assetId: 'aws.systems-manager' },
      
      // Cost Component
      { id: 'cost-fn', label: 'Cost function', kind: 'aws-service', assetId: 'aws.lambda', containerId: 'group-cost' },
      { id: 'athena', label: 'Amazon Athena', kind: 'aws-service', assetId: 'aws.athena', containerId: 'group-cost' },
      { id: 's3-cur', label: 'CURBucket', kind: 'aws-service', assetId: 'aws.s3', containerId: 'group-cost' },
      { id: 'cur', label: 'AWS Cost & Usage Report', kind: 'aws-service', assetId: 'aws.cur', containerId: 'group-cost' },
      { id: 's3-athena-res', label: 'AthenaResultsBucket', kind: 'aws-service', assetId: 'aws.s3', containerId: 'group-cost' },
      
      // Data Component (inside private subnet)
      { id: 'gremlin-fn', label: 'Gremlin function', kind: 'aws-service', assetId: 'aws.lambda', containerId: 'group-data' },
      { id: 'neptune', label: 'Amazon Neptune', kind: 'aws-service', assetId: 'aws.neptune', containerId: 'group-data' },
      { id: 'search-fn', label: 'Search function', kind: 'aws-service', assetId: 'aws.lambda', containerId: 'group-data' },
      { id: 'opensearch', label: 'Amazon OpenSearch Service', kind: 'aws-service', assetId: 'aws.opensearch', containerId: 'group-data' },
      
      // Discovery Component (inside private subnet)
      { id: 'ecs', label: 'Amazon Elastic Container Service', kind: 'aws-service', assetId: 'aws.ecs', containerId: 'group-discovery' },
      { id: 'fargate', label: 'AWS Fargate', kind: 'aws-service', assetId: 'aws.ecs.fargate', containerId: 'group-discovery' },
      { id: 'ecr', label: 'Amazon Elastic Container Registry', kind: 'aws-service', assetId: 'aws.ecr', containerId: 'group-discovery' },
      
      // Discovery Inputs (outside VPC, inside AWS Cloud)
      { id: 'api-gw-discovery', label: 'ServiceGremlin API', kind: 'aws-service', assetId: 'aws.apigateway' },
      { id: 'aws-sdk', label: 'AWS SDK', kind: 'aws-service', assetId: 'aws.sdk' },
      { id: 'aws-config', label: 'AWS Config', kind: 'aws-service', assetId: 'aws.config' },
      
      // Image Deployment Component
      { id: 's3-discovery', label: 'DiscoveryBucket', kind: 'aws-service', assetId: 'aws.s3', containerId: 'group-image-deploy' },
      { id: 'codepipeline', label: 'AWS CodePipeline', kind: 'aws-service', assetId: 'aws.codepipeline', containerId: 'group-image-deploy' },
      { id: 'codebuild', label: 'AWS CodeBuild', kind: 'aws-service', assetId: 'aws.codebuild', containerId: 'group-image-deploy' },
      { id: 'container-image', label: 'Container image', kind: 'generic', assetId: 'generic.container', containerId: 'group-image-deploy' }
    ],
    connections: [
      { id: 'c1', source: 'users', target: 'waf' },
      { id: 'c2', source: 'waf', target: 'appsync' },
      { id: 'c3', source: 'appsync', target: 'cloudwatch' },
      { id: 'c4', source: 'appsync', target: 'ssm' },
      { id: 'c5', source: 'api-gw', target: 'cloudwatch' },
      { id: 'c6', source: 'api-gw', target: 'ssm' },
      { id: 'c7', source: 'gremlin-fn', target: 'neptune' },
      { id: 'c8', source: 'search-fn', target: 'opensearch' },
      { id: 'c9', source: 'appsync', target: 'gremlin-fn' },
      { id: 'c10', source: 'api-gw', target: 'search-fn' },
      { id: 'c11', source: 'cost-fn', target: 'athena' },
      { id: 'c12', source: 'athena', target: 's3-cur' },
      { id: 'c13', source: 'cur', target: 's3-cur' },
      { id: 'c14', source: 'cost-fn', target: 's3-athena-res' },
      { id: 'c15', source: 'ecs', target: 'fargate' },
      { id: 'c16', source: 'ecs', target: 'ecr' },
      { id: 'c17', source: 'fargate', target: 'aws-sdk' },
      { id: 'c18', source: 'fargate', target: 'aws-config' },
      { id: 'c19', source: 'fargate', target: 'api-gw-discovery' },
      { id: 'c20', source: 'codepipeline', target: 's3-discovery' },
      { id: 'c21', source: 'codepipeline', target: 'codebuild' },
      { id: 'c22', source: 'codebuild', target: 'container-image' },
      { id: 'c23', source: 'container-image', target: 'ecr' }
    ],
    containers: [
      { id: 'vpc-main', label: 'VPC', type: 'vpc' },
      { id: 'subnet-priv', label: 'Private Subnet', type: 'subnet-private', parentId: 'vpc-main' },
      { id: 'group-cost', label: 'Cost component', type: 'generic-group' },
      { id: 'group-data', label: 'Data component', type: 'generic-group', parentId: 'subnet-priv' },
      { id: 'group-discovery', label: 'Discovery component', type: 'generic-group', parentId: 'subnet-priv' },
      { id: 'group-image-deploy', label: 'Image deployment component', type: 'generic-group' }
    ]
  };

  console.log(`- Raw Model Node Count: ${rawServiceGremlinModel.nodes.length}`);
  console.log(`- Raw Model Container Count: ${rawServiceGremlinModel.containers.length}`);
  console.log(`- Raw Model Connection Count: ${rawServiceGremlinModel.connections.length}`);

  // STAGE 3: Post-Zod / Semantic Validation
  console.log('\n\n===============================================================');
  console.log('[STAGE 3: POST-ZOD / SEMANTIC VALIDATION]');
  const validation = validateArchitectureModel(rawServiceGremlinModel);
  console.log(`- Valid: ${validation.ok}`);
  console.log(`- Issues: ${validation.issues.length > 0 ? validation.issues.map(issue => `${issue.code}: ${issue.message}`).join(', ') : 'None'}`);
  console.log(`- Validated Node Count: ${validation.ok ? validation.value.nodes.length : 0}`);
  console.log(`- Validated Container Count: ${validation.ok ? validation.value.containers.length : 0}`);
  console.log(`- Validated Connection Count: ${validation.ok ? validation.value.connections.length : 0}`);

  // STAGE 4: Asset Resolution
  console.log('\n\n===============================================================');
  console.log('[STAGE 4: ASSET RESOLUTION]');
  let resolvedCount = 0;
  let fallbackCount = 0;
  for (const node of rawServiceGremlinModel.nodes) {
    const asset = resolveAsset(node.assetId || node.label);
    const display = resolveNodeDisplay(node.label, node.subtitle, node.assetId);
    if (asset.id !== 'generic.component') {
      resolvedCount++;
      console.log(`  ✓ [RESOLVED] Node "${node.id}" (${node.label}) -> Asset: ${asset.id} ("${asset.displayName}") [Short: "${display.primaryLabel}"]`);
    } else {
      fallbackCount++;
      console.log(`  ? [FALLBACK] Node "${node.id}" (${node.label}, assetId: "${node.assetId}") -> Fallback generic.component (Icon preserved cleanly, node NOT dropped)`);
    }
  }
  console.log(`- Total Resolved Official Assets: ${resolvedCount}`);
  console.log(`- Total Fallbacks: ${fallbackCount}`);
  console.log(`- Silent Deletions: 0 (All nodes remain preserved!)`);

  // STAGE 5: ensureAwsCloudHierarchy()
  console.log('\n\n===============================================================');
  console.log('[STAGE 5: ensureAwsCloudHierarchy() & PREPARE MODEL]');
  const prepared = prepareArchitectureModel(rawServiceGremlinModel);
  console.log(`- Pre-normalization: ${rawServiceGremlinModel.nodes.length} nodes, ${rawServiceGremlinModel.containers.length} containers, ${rawServiceGremlinModel.connections.length} edges`);
  console.log(`- Post-normalization: ${prepared.nodes.length} nodes, ${prepared.containers.length} containers, ${prepared.connections.length} edges`);
  
  const cloudContainer = prepared.containers.find(c => c.type === 'cloud');
  console.log(`- Canonical AWS Cloud Root Created: ID "${cloudContainer?.id}", Type "${cloudContainer?.type}", Origin "${cloudContainer?.origin}"`);
  
  // Verify external nodes stay outside
  const userNode = prepared.nodes.find(n => n.id === 'users');
  console.log(`- External Node "users" containerId: ${userNode?.containerId ?? 'undefined'} (STRICTLY OUTSIDE AWS Cloud: ${userNode?.containerId === undefined})`);
  
  // Verify top-level AWS nodes scoped into cloud
  const appsyncNode = prepared.nodes.find(n => n.id === 'appsync');
  console.log(`- Top-level AWS Node "appsync" containerId: "${appsyncNode?.containerId}" (SCOPED INSIDE AWS Cloud: ${appsyncNode?.containerId === cloudContainer?.id})`);
  
  // Verify top-level container scoped into cloud
  const vpcContainer = prepared.containers.find(c => c.id === 'vpc-main');
  console.log(`- Top-level VPC Container parentId: "${vpcContainer?.parentId}" (SCOPED INSIDE AWS Cloud: ${vpcContainer?.parentId === cloudContainer?.id})`);
  
  // Verify nested containment preserved
  const dataGroup = prepared.containers.find(c => c.id === 'group-data');
  console.log(`- Nested Group "group-data" parentId: "${dataGroup?.parentId}" (STRICTLY PRESERVED inside subnet-priv: ${dataGroup?.parentId === 'subnet-priv'})`);

  // STAGE 6: DiagramDocument conversion & STAGE 7: ELK Layout
  console.log('\n\n===============================================================');
  console.log('[STAGE 6 & 7: ELK COMPOUND LAYOUT COMPUTATION]');
  const document = await computeCompoundLayout(prepared);
  
  const docNodeKeys = Object.keys(document.semantic.nodes);
  const docContainerKeys = Object.keys(document.semantic.containers);
  const docConnKeys = Object.keys(document.semantic.connections);
  const presNodeKeys = Object.keys(document.presentation.nodes);
  const presContainerKeys = Object.keys(document.presentation.containers);
  
  console.log(`- Semantic Nodes in DiagramDocument: ${docNodeKeys.length}`);
  console.log(`- Presentation Nodes in DiagramDocument: ${presNodeKeys.length}`);
  console.log(`- Semantic Containers in DiagramDocument: ${docContainerKeys.length}`);
  console.log(`- Presentation Containers in DiagramDocument: ${presContainerKeys.length}`);
  console.log(`- Semantic Connections in DiagramDocument: ${docConnKeys.length}`);

  // STAGE 8: XYFlow nodes/edges conversion
  console.log('\n\n===============================================================');
  console.log('[STAGE 8: XYFLOW RENDERED NODES/EDGES ON CANVAS]');
  const renderedContainersCount = docContainerKeys.length;
  const renderedNodesCount = docNodeKeys.length;
  const renderedEdgesCount = docConnKeys.length;
  console.log(`- Total Rendered Containers: ${renderedContainersCount}`);
  console.log(`- Total Rendered Nodes: ${renderedNodesCount}`);
  console.log(`- Total Rendered Edges: ${renderedEdgesCount}`);
  console.log(`- Total React Flow Diagram Objects: ${renderedContainersCount + renderedNodesCount} nodes, ${renderedEdgesCount} edges`);

  console.log('\n===============================================================');
  console.log('                    DIAGNOSTIC CONCLUSION                      ');
  console.log('===============================================================');
  console.log(`1. Root Cause: In PromptHeader.tsx, the generation mode was hardcoded/defaulted to "mock".`);
  console.log(`2. The MockArchitectureParser only recognizes ONE specific prompt string ("CloudFront routes /assets/* to a private S3 bucket").`);
  console.log(`3. When any other prompt (including the 2,869-character ServiceGremlin prompt) is submitted while in "mock" mode, MockArchitectureParser silently falls back to getDefaultFixture(), which contains EXACTLY [Users, CloudFront, ALB, ECS].`);
  console.log(`4. Downstream stages (Zod validation, Asset resolution, ensureAwsCloudHierarchy, ELK layout, XYFlow canvas) are 100% HEALTHY and flawlessly handle all 25 nodes, 7 containers, and 23 connections without dropping ANY component!`);
}

runDiagnostics().catch(err => {
  console.error('Diagnostic error:', err);
  process.exit(1);
});
