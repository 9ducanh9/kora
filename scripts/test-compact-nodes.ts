import { resolveNodeDisplay, getAssetShortName } from '../src/core/assets/registry';
import { getNodeDimensions, isTwoLineLabel, COMPACT_NODE_WIDTH } from '../src/core/layout/nodeDimensions';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
  console.log(`[PASS] ${message}`);
}

console.log('=== COMPACT AWS NODE RENDERER V1 VERIFICATION ===\n');

// 1. Canonical Name Resolution (No startsWith heuristics, exact matches only)
console.log('--- Test 1: Canonical Name Resolution ---');
const cloudfront = resolveNodeDisplay('Amazon CloudFront', undefined, 'aws.cloudfront');
assert(cloudfront.primaryLabel === 'CloudFront', 'Amazon CloudFront resolves to canonical shortName "CloudFront"');
assert(cloudfront.subtitle === undefined, 'Amazon CloudFront has no subtitle when explicit subtitle is undefined');
assert(cloudfront.isCanonicalLabel === true, 'Amazon CloudFront marked as canonical label');

const dynamodb = resolveNodeDisplay('Amazon DynamoDB', undefined, 'aws.dynamodb');
assert(dynamodb.primaryLabel === 'DynamoDB', 'Amazon DynamoDB resolves to canonical shortName "DynamoDB"');

// 2. Custom Semantic Labels (Must be preserved verbatim)
console.log('\n--- Test 2: Custom Semantic Label Preservation ---');
const privateS3 = resolveNodeDisplay('Private S3 Bucket', undefined, 'aws.s3');
assert(privateS3.primaryLabel === 'Private S3 Bucket', 'Custom label "Private S3 Bucket" preserved verbatim');
assert(privateS3.isCanonicalLabel === false, 'Private S3 Bucket not marked as canonical');
assert(privateS3.subtitle === 'S3', 'Derived presentation subtitle "S3" generated for custom label without explicit subtitle');

// 3. Derived Subtitles are Presentation-Only
console.log('\n--- Test 3: Presentation-Only Derived Subtitle ---');
const backendApi = resolveNodeDisplay('Backend API', undefined, 'aws.ecs.fargate');
assert(backendApi.primaryLabel === 'Backend API', 'Custom role "Backend API" preserved as primary label');
assert(backendApi.subtitle === 'ECS Fargate', 'Derived presentation-only subtitle is "ECS Fargate"');

// Explicit subtitle takes precedence
const customSubtitle = resolveNodeDisplay('Backend API', 'Custom Fargate v2', 'aws.ecs.fargate');
assert(customSubtitle.subtitle === 'Custom Fargate v2', 'Explicit subtitle takes precedence over derived subtitle');

// Explicit empty string clears subtitle
const clearedSubtitle = resolveNodeDisplay('Backend API', '', 'aws.ecs.fargate');
assert(clearedSubtitle.subtitle === undefined, 'Explicit empty subtitle takes precedence and clears subtitle');

// 4. External Node Resolution
console.log('\n--- Test 4: External / Generic Entities ---');
const users = resolveNodeDisplay('Users', undefined, 'external.user');
assert(users.primaryLabel === 'Users', 'Users entity resolves cleanly');
assert(users.asset.category === 'external', 'External asset has category external');

// 5. Shared Node-Size Resolver Geometry Parity
console.log('\n--- Test 5: Shared Node Dimensions Resolver ---');
const dimSingleNoSub = getNodeDimensions({ label: 'CloudFront', assetId: 'aws.cloudfront' });
assert(dimSingleNoSub.width === COMPACT_NODE_WIDTH, `Node width is strictly ${COMPACT_NODE_WIDTH}px`);
assert(dimSingleNoSub.height === 78, `1-line label without subtitle follows shared text metrics (got ${dimSingleNoSub.height})`);
assert(dimSingleNoSub.isTwoLineLabel === false, 'CloudFront is single-line label');

const dimTwoLineNoSub = getNodeDimensions({ label: 'Private S3 Bucket', subtitle: '', assetId: 'aws.s3' });
assert(dimTwoLineNoSub.isTwoLineLabel === true, 'Private S3 Bucket wraps to 2 lines');
assert(dimTwoLineNoSub.height === 92, `wrapped label without subtitle has measured height 92px (got ${dimTwoLineNoSub.height})`);

const dimSingleWithSub = getNodeDimensions({ label: 'Backend API', assetId: 'aws.ecs.fargate' });
assert(dimSingleWithSub.hasSubtitle === true, 'Backend API has derived subtitle');
assert(dimSingleWithSub.height === 92, `1-line label with subtitle has measured height 92px (got ${dimSingleWithSub.height})`);

const dimAlbCanonical = getNodeDimensions({ label: 'Application Load Balancer', assetId: 'aws.elb.alb' });
assert(dimAlbCanonical.resolvedPrimaryLabel === 'ALB', 'Application Load Balancer resolves to ALB canonical shortName');
assert(dimAlbCanonical.isTwoLineLabel === false, 'ALB is 1-line label');

const dimTwoLineWithSub = getNodeDimensions({ label: 'Ingress Gateway Server', subtitle: 'Public Ingress', assetId: 'aws.elb.alb' });
assert(dimTwoLineWithSub.isTwoLineLabel === true, 'Ingress Gateway Server wraps to 2 lines');
assert(dimTwoLineWithSub.hasSubtitle === true, 'Has subtitle');
assert(dimTwoLineWithSub.height === 105, `wrapped label with subtitle has measured height 105px (got ${dimTwoLineWithSub.height})`);

console.log('\n=== ALL COMPACT NODE TESTS PASSED SUCCESSFULLY ===');
