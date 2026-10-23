import { KoraArchitectureModel, IRNode, IRConnection } from '../../../src/core/ir/types';

const node = (id: string, assetId: string, containerId?: string): IRNode => ({ id, label: id, assetId, kind: assetId.startsWith('aws.') ? 'aws-service' : 'generic', ...(containerId ? { containerId } : {}) });
const edge = (source: string, target: string, relationship: IRConnection['relationship'] = 'request', label = `${source} → ${target}`): IRConnection => ({ id: `${source}-${target}`, source, target, relationship, label });
const cloud = [{ id: 'platform', label: 'AWS Cloud', type: 'cloud' as const }];

/** Independent families: none derives from the LiveCap prompt, IDs or captured output. */
export const TOPOLOGY_LAYOUT_CASES: Array<{ id: string; model: KoraArchitectureModel; spine: string[] }> = [
  {
    id: 'multi-az-web', spine: ['visitor', 'load-balancer', 'service-a', 'database'],
    model: { version: '1.0', nodes: [node('visitor', 'external.user'), node('load-balancer', 'aws.elb.alb', 'public'), node('service-a', 'aws.ecs.fargate', 'private-a'), node('service-b', 'aws.ecs.fargate', 'private-b'), node('database', 'aws.dynamodb', 'platform')],
      containers: [...cloud, { id: 'network', label: 'VPC', type: 'vpc', parentId: 'platform' }, { id: 'public', label: 'Public subnets', type: 'subnet-public', parentId: 'network' }, { id: 'zone-a', label: 'Availability Zone A', type: 'availability-zone', parentId: 'network' }, { id: 'zone-b', label: 'Availability Zone B', type: 'availability-zone', parentId: 'network' }, { id: 'private-a', label: 'Private subnet A', type: 'subnet-private', parentId: 'zone-a' }, { id: 'private-b', label: 'Private subnet B', type: 'subnet-private', parentId: 'zone-b' }],
      connections: [edge('visitor', 'load-balancer'), edge('load-balancer', 'service-a'), edge('load-balancer', 'service-b'), edge('service-a', 'database', 'data'), edge('service-b', 'database', 'data')] }
  },
  {
    id: 'serverless-api', spine: ['client', 'gateway', 'function', 'table'],
    model: { version: '1.0', nodes: [node('client', 'external.user'), node('gateway', 'aws.apigateway', 'platform'), node('function', 'aws.lambda', 'platform'), node('table', 'aws.dynamodb', 'platform'), node('logs', 'aws.cloudwatch', 'platform')], containers: cloud,
      connections: [edge('client', 'gateway'), edge('gateway', 'function'), edge('function', 'gateway', 'data', 'JSON response'), edge('gateway', 'client', 'data', 'HTTPS response'), edge('function', 'table', 'data'), edge('function', 'logs', 'data')] }
  },
  {
    id: 'event-consumers', spine: ['bus', 'queue', 'consumer', 'result'],
    model: { version: '1.0', nodes: [node('bus', 'aws.eventbridge', 'platform'), node('queue', 'aws.sqs', 'platform'), node('consumer', 'aws.lambda', 'platform'), node('result', 'aws.s3', 'platform')], containers: cloud,
      connections: [edge('bus', 'queue', 'event'), edge('queue', 'consumer', 'event'), edge('consumer', 'result', 'data')] }
  },
  {
    id: 'data-ingestion', spine: ['input', 'extract', 'buffer', 'transform', 'warehouse'],
    model: { version: '1.0', nodes: [node('input', 'aws.s3', 'platform'), node('extract', 'aws.lambda', 'platform'), node('buffer', 'aws.sqs', 'platform'), node('transform', 'aws.lambda', 'platform'), node('warehouse', 'aws.dynamodb', 'platform'), node('log-sink', 'aws.cloudwatch', 'platform')], containers: cloud,
      connections: [edge('input', 'extract', 'event'), edge('extract', 'buffer', 'event'), edge('buffer', 'transform', 'event'), edge('transform', 'warehouse', 'data'), edge('transform', 'log-sink', 'data')] }
  },
  {
    id: 'microservices', spine: ['person', 'entry', 'orders', 'payments', 'records'],
    model: { version: '1.0', nodes: [node('person', 'external.user'), node('entry', 'aws.elb.alb', 'platform'), node('orders', 'aws.ecs.fargate', 'platform'), node('payments', 'aws.ecs.fargate', 'platform'), node('records', 'aws.rds', 'platform')], containers: cloud,
      connections: [edge('person', 'entry'), edge('entry', 'orders'), edge('orders', 'payments'), edge('payments', 'orders', 'data', 'Receipt'), edge('payments', 'records', 'data')] }
  },
  {
    id: 'generic-pipeline', spine: ['source', 'process', 'destination'],
    model: { version: '1.0', nodes: [node('source', 'generic.component'), node('process', 'generic.component'), node('destination', 'generic.component')], containers: [], connections: [edge('source', 'process', 'data'), edge('process', 'destination', 'data')] }
  },
  {
    id: 'cycle-with-exit', spine: [],
    model: { version: '1.0', nodes: [node('a', 'generic.component'), node('b', 'generic.component'), node('output', 'generic.component')], containers: [], connections: [edge('a', 'b', 'event'), edge('b', 'a', 'event'), edge('b', 'output', 'data')] }
  },
  {
    id: 'disconnected-and-reserved', spine: ['origin', 'sink'],
    model: { version: '1.0', nodes: [node('origin', 'generic.component'), node('sink', 'generic.component'), node('unconnected', 'external.third-party')], containers: [{ id: 'reserved', type: 'generic-group', label: 'Explicitly empty group' }], connections: [edge('origin', 'sink')] }
  }
];
