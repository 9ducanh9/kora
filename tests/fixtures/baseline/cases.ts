import { KoraArchitectureModel } from '../../../src/core/ir/types';

export interface BaselineCase {
  id: 'B1' | 'B2' | 'B3' | 'B3-empty';
  prompt: string;
  model: KoraArchitectureModel;
  expected: {
    nodeIds: string[];
    connections: Array<{ id: string; source: string; target: string; label?: string }>;
    containers: Array<{ id: string; type: string; parentId?: string }>;
    memberships: Record<string, string | undefined>;
  };
}

const b1: BaselineCase = {
  id: 'B1',
  prompt: 'Draw this AWS architecture: Users access CloudFront over HTTPS. CloudFront serves static content from an S3 bucket using /assets/*. Do not add a VPC or subnet.',
  model: {
    version: '1.0',
    scope: { type: 'overall-architecture', title: 'B1 Simple AWS Architecture' },
    nodes: [
      { id: 'users', label: 'Users', kind: 'external', assetId: 'external.user' },
      { id: 'cloudfront', label: 'Amazon CloudFront', kind: 'aws-service', assetId: 'aws.cloudfront' },
      { id: 's3', label: 'Amazon S3', kind: 'aws-service', assetId: 'aws.s3' }
    ],
    connections: [
      { id: 'b1-users-cloudfront', source: 'users', target: 'cloudfront', relationship: 'request', label: 'HTTPS' },
      { id: 'b1-cloudfront-s3', source: 'cloudfront', target: 's3', relationship: 'request', label: '/assets/*' }
    ],
    containers: []
  },
  expected: {
    nodeIds: ['cloudfront', 's3', 'users'],
    connections: [
      { id: 'b1-users-cloudfront', source: 'users', target: 'cloudfront', label: 'HTTPS' },
      { id: 'b1-cloudfront-s3', source: 'cloudfront', target: 's3', label: '/assets/*' }
    ],
    containers: [{ id: 'cloud-aws', type: 'cloud' }],
    memberships: { users: undefined, cloudfront: 'cloud-aws', s3: 'cloud-aws' }
  }
};

const b2: BaselineCase = {
  id: 'B2',
  prompt: `Draw this AWS architecture:
Users access CloudFront over HTTPS.
CloudFront routes /assets/* to a private S3 bucket.
CloudFront routes /api/* to an Application Load Balancer.
The ALB forwards traffic to ECS Fargate.
ECS runs inside a private subnet in a VPC.
ECS stores application state in DynamoDB.`,
  model: {
    version: '1.0',
    scope: { type: 'overall-architecture', title: 'Web Architecture' },
    nodes: [
      { id: 'user', label: 'Users', kind: 'external', assetId: 'external.user' },
      { id: 'cloudfront', label: 'Amazon CloudFront', kind: 'aws-service', assetId: 'aws.cloudfront' },
      { id: 's3', label: 'Private S3 Bucket', kind: 'aws-service', assetId: 'aws.s3' },
      { id: 'alb', label: 'Application Load Balancer', kind: 'aws-resource', assetId: 'aws.elb.alb' },
      { id: 'ecs', label: 'ECS Fargate', kind: 'aws-service', assetId: 'aws.ecs.fargate', containerId: 'subnet-private' },
      { id: 'dynamodb', label: 'Amazon DynamoDB', kind: 'aws-service', assetId: 'aws.dynamodb' }
    ],
    connections: [
      { id: 'b2-users-cloudfront', source: 'user', target: 'cloudfront', relationship: 'request', label: 'HTTPS' },
      { id: 'b2-cloudfront-s3', source: 'cloudfront', target: 's3', relationship: 'request', label: '/assets/*' },
      { id: 'b2-cloudfront-alb', source: 'cloudfront', target: 'alb', relationship: 'request', label: '/api/*' },
      { id: 'b2-alb-ecs', source: 'alb', target: 'ecs', relationship: 'request', label: 'Forward' },
      { id: 'b2-ecs-dynamodb', source: 'ecs', target: 'dynamodb', relationship: 'data', label: 'State' }
    ],
    containers: [
      { id: 'vpc', label: 'VPC', type: 'vpc' },
      { id: 'subnet-private', label: 'Private Subnet', type: 'subnet-private', parentId: 'vpc' }
    ]
  },
  expected: {
    nodeIds: ['alb', 'cloudfront', 'dynamodb', 'ecs', 's3', 'user'],
    connections: [
      { id: 'b2-users-cloudfront', source: 'user', target: 'cloudfront', label: 'HTTPS' },
      { id: 'b2-cloudfront-s3', source: 'cloudfront', target: 's3', label: '/assets/*' },
      { id: 'b2-cloudfront-alb', source: 'cloudfront', target: 'alb', label: '/api/*' },
      { id: 'b2-alb-ecs', source: 'alb', target: 'ecs', label: 'Forward' },
      { id: 'b2-ecs-dynamodb', source: 'ecs', target: 'dynamodb', label: 'State' }
    ],
    containers: [
      { id: 'cloud-aws', type: 'cloud' },
      { id: 'vpc', type: 'vpc', parentId: 'cloud-aws' },
      { id: 'subnet-private', type: 'subnet-private', parentId: 'vpc' }
    ],
    memberships: { user: undefined, cloudfront: 'cloud-aws', s3: 'cloud-aws', alb: 'cloud-aws', ecs: 'subnet-private', dynamodb: 'cloud-aws' }
  }
};

const b3: BaselineCase = {
  id: 'B3',
  prompt: `Draw this AWS architecture:
Users access CloudFront over HTTPS.
CloudFront routes /assets/* to a private S3 bucket and /api/* to an ALB.
The ALB forwards to two separate ECS Fargate services: Backend A and Backend B.
VPC Main contains Private Subnet A and Private Subnet B.
Backend A belongs to Private Subnet A; Backend B belongs to Private Subnet B.
Both backends store application state in the same DynamoDB table.
CloudFront, S3, ALB and DynamoDB are in AWS Cloud, outside VPC Main.
Users are outside AWS Cloud. Do not add Regions or Availability Zones.`,
  model: {
    version: '1.0',
    scope: { type: 'overall-architecture', title: 'B3 Two Private Subnets' },
    nodes: [
      { id: 'users', label: 'Users', kind: 'external', assetId: 'external.user' },
      { id: 'cloudfront', label: 'Amazon CloudFront', kind: 'aws-service', assetId: 'aws.cloudfront' },
      { id: 's3', label: 'Private S3 Bucket', kind: 'aws-service', assetId: 'aws.s3' },
      { id: 'alb', label: 'Application Load Balancer', kind: 'aws-resource', assetId: 'aws.elb.alb' },
      { id: 'backend-a', label: 'Backend A', kind: 'aws-service', assetId: 'aws.ecs.fargate', containerId: 'subnet-private-a' },
      { id: 'backend-b', label: 'Backend B', kind: 'aws-service', assetId: 'aws.ecs.fargate', containerId: 'subnet-private-b' },
      { id: 'dynamodb', label: 'Amazon DynamoDB', kind: 'aws-service', assetId: 'aws.dynamodb' }
    ],
    connections: [
      { id: 'b3-users-cloudfront', source: 'users', target: 'cloudfront', relationship: 'request', label: 'HTTPS' },
      { id: 'b3-cloudfront-s3', source: 'cloudfront', target: 's3', relationship: 'request', label: '/assets/*' },
      { id: 'b3-cloudfront-alb', source: 'cloudfront', target: 'alb', relationship: 'request', label: '/api/*' },
      { id: 'b3-alb-backend-a', source: 'alb', target: 'backend-a', relationship: 'request', label: 'Forward A' },
      { id: 'b3-alb-backend-b', source: 'alb', target: 'backend-b', relationship: 'request', label: 'Forward B' },
      { id: 'b3-backend-a-dynamodb', source: 'backend-a', target: 'dynamodb', relationship: 'data', label: 'State A' },
      { id: 'b3-backend-b-dynamodb', source: 'backend-b', target: 'dynamodb', relationship: 'data', label: 'State B' }
    ],
    containers: [
      { id: 'vpc-main', label: 'VPC Main', type: 'vpc' },
      { id: 'subnet-private-a', label: 'Private Subnet A', type: 'subnet-private', parentId: 'vpc-main' },
      { id: 'subnet-private-b', label: 'Private Subnet B', type: 'subnet-private', parentId: 'vpc-main' }
    ]
  },
  expected: {
    nodeIds: ['alb', 'backend-a', 'backend-b', 'cloudfront', 'dynamodb', 's3', 'users'],
    connections: [
      { id: 'b3-users-cloudfront', source: 'users', target: 'cloudfront', label: 'HTTPS' },
      { id: 'b3-cloudfront-s3', source: 'cloudfront', target: 's3', label: '/assets/*' },
      { id: 'b3-cloudfront-alb', source: 'cloudfront', target: 'alb', label: '/api/*' },
      { id: 'b3-alb-backend-a', source: 'alb', target: 'backend-a', label: 'Forward A' },
      { id: 'b3-alb-backend-b', source: 'alb', target: 'backend-b', label: 'Forward B' },
      { id: 'b3-backend-a-dynamodb', source: 'backend-a', target: 'dynamodb', label: 'State A' },
      { id: 'b3-backend-b-dynamodb', source: 'backend-b', target: 'dynamodb', label: 'State B' }
    ],
    containers: [
      { id: 'cloud-aws', type: 'cloud' },
      { id: 'vpc-main', type: 'vpc', parentId: 'cloud-aws' },
      { id: 'subnet-private-a', type: 'subnet-private', parentId: 'vpc-main' },
      { id: 'subnet-private-b', type: 'subnet-private', parentId: 'vpc-main' }
    ],
    memberships: { users: undefined, cloudfront: 'cloud-aws', s3: 'cloud-aws', alb: 'cloud-aws', 'backend-a': 'subnet-private-a', 'backend-b': 'subnet-private-b', dynamodb: 'cloud-aws' }
  }
};

const b3Empty: BaselineCase = {
  ...b3,
  id: 'B3-empty',
  prompt: `${b3.prompt}\nVPC Main also contains an empty private subnet named Reserved Private Subnet. Do not put any component inside it.`,
  model: {
    ...b3.model,
    containers: [...b3.model.containers, { id: 'subnet-private-empty', label: 'Reserved Private Subnet', type: 'subnet-private', parentId: 'vpc-main' }]
  },
  expected: {
    ...b3.expected,
    containers: [...b3.expected.containers, { id: 'subnet-private-empty', type: 'subnet-private', parentId: 'vpc-main' }]
  }
};

export const BASELINE_CASES: BaselineCase[] = [b1, b2, b3, b3Empty];
