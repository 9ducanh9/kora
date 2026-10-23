import { ensureAwsCloudHierarchy, isAwsNode, isAwsContainer } from '../src/core/architecture/prepareModel';
import { getContainerVisualConfig } from '../src/core/containers/registry';
import { computeCompoundLayout } from '../src/core/layout/elkCompoundLayout';
import { KoraArchitectureModel } from '../src/core/ir/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
  console.log(`[PASS] ${message}`);
}

async function runContainerTests() {
  console.log('=== CONTAINER VISUAL GRAMMAR V2 & AWS CLOUD ENCLOSURE VERIFICATION ===\n');

  // Test 1: Container Visual Registry Lookup & Hierarchy Sizing
  console.log('--- Test 1: Container Visual Registry ---');
  const cloudConfig = getContainerVisualConfig('cloud');
  assert(cloudConfig.badgePath === '/assets/aws/groups/aws-cloud.svg', 'Cloud badge icon points to official SVG');
  assert(cloudConfig.badgeSize === 28, 'Cloud badge size is 28px (top hierarchy)');
  assert(cloudConfig.borderStyle === 'solid', 'Cloud border is solid');

  const vpcConfig = getContainerVisualConfig('vpc');
  assert(vpcConfig.badgePath === '/assets/aws/groups/aws-vpc.svg', 'VPC badge icon points to official SVG');
  assert(vpcConfig.badgeSize === 22, 'VPC badge size is 22px');
  assert(vpcConfig.borderStyle === 'solid', 'VPC border is solid');

  const subnetConfig = getContainerVisualConfig('subnet-private');
  assert(subnetConfig.badgePath === '/assets/aws/groups/aws-subnet-private.svg', 'Subnet badge icon points to official SVG');
  assert(subnetConfig.badgeSize === 20, 'Subnet badge size is 20px');

  const asgConfig = getContainerVisualConfig('auto-scaling-group');
  assert(asgConfig.borderStyle === 'dashed', 'Auto Scaling Group border is dashed');

  const cdcConfig = getContainerVisualConfig('corporate-data-center');
  assert(cdcConfig.badgePath === '/assets/aws/groups/aws-corporate-data-center.svg', 'Corporate Data Center badge points to official SVG');

  // Test 2: Positive AWS Identity Checks
  console.log('\n--- Test 2: Positive AWS Identity Tests ---');
  assert(isAwsNode({ kind: 'aws-service' }) === true, 'kind: aws-service is positively AWS');
  assert(isAwsNode({ kind: 'aws-resource' }) === true, 'kind: aws-resource is positively AWS');
  assert(isAwsNode({ kind: 'generic', assetId: 'generic.component' }) === false, 'kind: generic is NOT AWS');
  assert(isAwsNode({ kind: 'external', assetId: 'external.user' }) === false, 'kind: external is NOT AWS');
  assert(isAwsNode({ kind: 'actor' }) === false, 'kind: actor is NOT AWS');
  assert(isAwsContainer({ type: 'vpc' }) === true, 'type: vpc is AWS container');
  assert(isAwsContainer({ type: 'subnet-public' }) === true, 'type: subnet-public is AWS container');
  assert(isAwsContainer({ type: 'corporate-data-center' }) === false, 'type: corporate-data-center is NOT AWS container');

  // Test 3: Normalization Invariants (Absent Cloud, Generic Nodes, Unassigned CloudFront, VPC Hierarchy)
  console.log('\n--- Test 3: Normalization Invariants (Absent Cloud) ---');
  const rawModel: KoraArchitectureModel = {
    version: '1.0',
    nodes: [
      { id: 'user', label: 'Users', kind: 'external', assetId: 'external.user' },
      { id: 'legacy-api', label: 'Legacy Core', kind: 'generic', assetId: 'generic.component' },
      { id: 'cloudfront', label: 'CloudFront', kind: 'aws-service', assetId: 'aws.cloudfront' },
      { id: 's3', label: 'S3 Bucket', kind: 'aws-service', assetId: 'aws.s3' },
      { id: 'alb', label: 'ALB', kind: 'aws-resource', assetId: 'aws.elb.alb' },
      { id: 'ecs', label: 'ECS Fargate', kind: 'aws-service', assetId: 'aws.ecs.fargate', containerId: 'subnet-priv' },
      { id: 'dynamodb', label: 'DynamoDB', kind: 'aws-service', assetId: 'aws.dynamodb' }
    ],
    connections: [
      { id: 'c1', source: 'user', target: 'cloudfront', label: 'HTTPS' },
      { id: 'c2', source: 'cloudfront', target: 's3', label: '/assets/*' },
      { id: 'c3', source: 'cloudfront', target: 'alb', label: '/api/*' },
      { id: 'c4', source: 'alb', target: 'ecs', label: 'Forward' },
      { id: 'c5', source: 'ecs', target: 'dynamodb', label: 'State' }
    ],
    containers: [
      { id: 'vpc', label: 'VPC', type: 'vpc' },
      { id: 'subnet-priv', label: 'Private Subnet', type: 'subnet-private', parentId: 'vpc' },
      { id: 'dc', label: 'Corporate Data Center', type: 'corporate-data-center' }
    ]
  };

  const normalized = ensureAwsCloudHierarchy(rawModel);

  // Assert cloud container created with origin: 'system'
  const cloudContainer = normalized.containers.find(c => c.type === 'cloud');
  assert(Boolean(cloudContainer), 'AWS Cloud container was automatically created');
  assert(cloudContainer?.id === 'cloud-aws', 'AWS Cloud container has id "cloud-aws"');
  assert(cloudContainer?.origin === 'system', 'AWS Cloud container origin is marked "system"');

  // Generic / External nodes MUST remain outside AWS Cloud
  const genericNode = normalized.nodes.find(n => n.id === 'legacy-api');
  assert(genericNode?.containerId === undefined, 'Generic node "Legacy Core" is strictly outside AWS Cloud');

  const userNode = normalized.nodes.find(n => n.id === 'user');
  assert(userNode?.containerId === undefined, 'External entity "Users" is strictly outside AWS Cloud');

  const dcContainer = normalized.containers.find(c => c.id === 'dc');
  assert(dcContainer?.parentId === undefined, 'Corporate Data Center is strictly outside AWS Cloud');

  // Unassigned CloudFront enclosed by AWS Cloud, NOT inferred into VPC
  const cfNode = normalized.nodes.find(n => n.id === 'cloudfront');
  assert(cfNode?.containerId === 'cloud-aws', 'CloudFront is enclosed by AWS Cloud');
  assert(cfNode?.containerId !== 'vpc', 'CloudFront is NOT inferred into VPC');

  // Existing VPC -> Subnet -> ECS hierarchy remains unchanged
  const vpcContainer = normalized.containers.find(c => c.id === 'vpc');
  assert(vpcContainer?.parentId === 'cloud-aws', 'VPC attached to cloud-aws');

  const subnetContainer = normalized.containers.find(c => c.id === 'subnet-priv');
  assert(subnetContainer?.parentId === 'vpc', 'Subnet strictly preserves parentId="vpc"');

  const ecsNode = normalized.nodes.find(n => n.id === 'ecs');
  assert(ecsNode?.containerId === 'subnet-priv', 'ECS node strictly preserves containerId="subnet-priv"');

  // Test 4: Existing Explicit AWS Cloud Root
  console.log('\n--- Test 4: Existing Explicit AWS Cloud Root ---');
  const existingCloudModel: KoraArchitectureModel = {
    version: '1.0',
    nodes: [
      { id: 's3', label: 'S3', kind: 'aws-service', assetId: 'aws.s3' }
    ],
    connections: [],
    containers: [
      { id: 'my-custom-cloud', label: 'Production AWS Cloud', type: 'cloud', origin: 'explicit' }
    ]
  };
  const normalizedExisting = ensureAwsCloudHierarchy(existingCloudModel);
  const existingClouds = normalizedExisting.containers.filter(c => c.type === 'cloud');
  assert(existingClouds.length === 1, 'Exactly one AWS Cloud root exists');
  assert(existingClouds[0].id === 'my-custom-cloud', 'Existing AWS Cloud id preserved');
  assert(existingClouds[0].label === 'Production AWS Cloud', 'Existing AWS Cloud label preserved');
  assert(existingClouds[0].origin === 'explicit', 'Origin preserved as "explicit"');
  assert(normalizedExisting.nodes[0].containerId === 'my-custom-cloud', 'S3 attached to existing custom cloud');

  // Test 5: Duplicate AWS Cloud Roots Canonicalization & Reference Remapping
  console.log('\n--- Test 5: Duplicate AWS Cloud Containers Canonicalization ---');
  const duplicateCloudModel: KoraArchitectureModel = {
    version: '1.0',
    nodes: [
      { id: 'n1', label: 'Node 1', kind: 'aws-service', containerId: 'cloud-primary' },
      { id: 'n2', label: 'Node 2', kind: 'aws-service', containerId: 'cloud-secondary' }
    ],
    connections: [],
    containers: [
      { id: 'cloud-primary', label: 'AWS Cloud 1', type: 'cloud' },
      { id: 'cloud-secondary', label: 'AWS Cloud 2', type: 'cloud' },
      { id: 'vpc-sub', label: 'VPC', type: 'vpc', parentId: 'cloud-secondary' }
    ]
  };
  const normalizedDuplicates = ensureAwsCloudHierarchy(duplicateCloudModel);
  const remainingClouds = normalizedDuplicates.containers.filter(c => c.type === 'cloud');
  assert(remainingClouds.length === 1, 'Duplicate cloud containers collapsed to exactly one root');
  assert(remainingClouds[0].id === 'cloud-primary', 'Primary cloud id used as canonical root');

  const remappedNode2 = normalizedDuplicates.nodes.find(n => n.id === 'n2');
  assert(remappedNode2?.containerId === 'cloud-primary', 'Node 2 safely remapped from duplicate cloud to primary cloud');

  const remappedVpc = normalizedDuplicates.containers.find(c => c.id === 'vpc-sub');
  assert(remappedVpc?.parentId === 'cloud-primary', 'VPC parent safely remapped from duplicate cloud to primary cloud');

  // Test 6: Compound ELK Layout with Complete Containment Chain
  console.log('\n--- Test 6: Multi-Tier Compound ELK Layout Containment ---');
  const layoutedDoc = await computeCompoundLayout(normalized);
  const cloudPres = layoutedDoc.presentation.containers['cloud-aws'];
  const vpcPres = layoutedDoc.presentation.containers['vpc'];
  const subnetPres = layoutedDoc.presentation.containers['subnet-priv'];
  const ecsPres = layoutedDoc.presentation.nodes['ecs'];
  const userPres = layoutedDoc.presentation.nodes['user'];
  const genericPres = layoutedDoc.presentation.nodes['legacy-api'];

  // Containment verification
  const ecsInSubnet = ecsPres.x >= subnetPres.x && ecsPres.y >= subnetPres.y &&
    ecsPres.x <= subnetPres.x + subnetPres.width && ecsPres.y <= subnetPres.y + subnetPres.height;
  assert(ecsInSubnet, 'ECS is strictly contained inside Subnet bounds');

  const subnetInVpc = subnetPres.x >= vpcPres.x && subnetPres.y >= vpcPres.y &&
    subnetPres.x + subnetPres.width <= vpcPres.x + vpcPres.width &&
    subnetPres.y + subnetPres.height <= vpcPres.y + vpcPres.height;
  assert(subnetInVpc, 'Subnet is strictly contained inside VPC bounds');

  const vpcInCloud = vpcPres.x >= cloudPres.x && vpcPres.y >= cloudPres.y &&
    vpcPres.x + vpcPres.width <= cloudPres.x + cloudPres.width &&
    vpcPres.y + vpcPres.height <= cloudPres.y + cloudPres.height;
  assert(vpcInCloud, 'VPC is strictly contained inside AWS Cloud bounds');

  assert(userPres.x < cloudPres.x, 'External entity "Users" is strictly outside AWS Cloud');
  assert(genericPres.x < cloudPres.x, 'Generic entity "Legacy Core" is strictly outside AWS Cloud');

  console.log('\n=== ALL CONTAINER TESTS PASSED SUCCESSFULLY ===');
}

runContainerTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
