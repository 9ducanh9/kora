import { KoraArchitectureModel, NodeKind, ContainerType, ConnectionRelationship } from '../../ir/types';

export type FieldRule<T> =
  | { mode: 'any' }
  | { mode: 'absent' }
  | { mode: 'value'; value: T };

export type TextRule =
  | { mode: 'any' }
  | { mode: 'absent' }
  | { mode: 'text'; anyOf: string[]; caseSensitive?: boolean }
  | { mode: 'token'; value: string };

export interface EvaluationAssertions {
  scope?: FieldRule<NonNullable<KoraArchitectureModel['scope']>['type']>;
  nodes?: Record<string, {
    label?: TextRule;
    assetId?: FieldRule<string>;
    kind?: FieldRule<NodeKind>;
    containerId?: FieldRule<string>;
  }>;
  containers?: Record<string, {
    label?: TextRule;
    type?: FieldRule<ContainerType>;
    parentId?: FieldRule<string>;
  }>;
  connections?: Record<string, {
    label?: TextRule;
    relationship?: FieldRule<ConnectionRelationship>;
  }>;
}

export interface EvaluationCase {
  id: string;
  title: string;
  prompt: string;
  promptFile?: string;
  context?: { scope?: string };
  critical: boolean;
  expected: KoraArchitectureModel;
  strictNodeLabels?: Record<string, string>;
  /** Frozen role aliases used only to identify an entity, not to relax its label assertion. */
  nodeAliases?: Record<string, string[]>;
  /** Roles listed together may be permuted without an identity error. */
  interchangeableNodeRoles?: string[][];
  assertions?: EvaluationAssertions;
  forbiddenAssets?: string[];
  forbiddenNodeLabels?: string[];
}

type NodeRow = [id: string, label: string, assetId: string, kind?: NodeKind, containerId?: string];
type ContainerRow = [id: string, label: string, type: ContainerType, parentId?: string];
type EdgeRow = [source: string, target: string, label?: string, relationship?: ConnectionRelationship];

function graph(nodes: NodeRow[], containers: ContainerRow[], edges: EdgeRow[], scope: KoraArchitectureModel['scope'] = { type: 'overall-architecture' }): KoraArchitectureModel {
  return {
    version: '1.0',
    scope,
    nodes: nodes.map(([id, label, assetId, kind, containerId]) => ({ id, label, assetId, kind: kind ?? (assetId.startsWith('external.') ? 'external' : assetId.startsWith('generic.') ? 'generic' : 'aws-service'), ...(containerId ? { containerId } : {}) })),
    containers: containers.map(([id, label, type, parentId]) => ({ id, label, type, ...(parentId ? { parentId } : {}) })),
    connections: edges.map(([source, target, label, relationship], index) => ({ id: `oracle-edge-${index + 1}`, source, target, ...(label !== undefined ? { label } : {}), ...(relationship ? { relationship } : {}) }))
  };
}

const p04 = `Vẽ kiến trúc tổng thể gồm Users ở ngoài AWS Cloud. CloudFront, S3 bucket, ALB và một DynamoDB table nằm trực tiếp trong AWS Cloud, ngoài VPC Main. VPC Main cũng nằm trực tiếp trong AWS Cloud. Users truy cập CloudFront bằng HTTPS. CloudFront chuyển /assets/* đến S3 và /api/* đến ALB. VPC Main chứa Private Subnet A và Private Subnet B. Có hai service ECS Fargate riêng biệt, giữ tên Backend A và Backend B: A thuộc subnet A, B thuộc subnet B. ALB chuyển yêu cầu đến cả hai backend; mỗi backend dùng chung DynamoDB table đó. Không thêm Region hoặc Availability Zone.`;

const p05 = `Draw Users, CloudFront, S3 named Frontend Assets, Lambda named Wake Function, one ALB named Backend ALB, and ECS Fargate named Backend. Use separate connections with exactly these labels: Users to CloudFront: HTTPS; CloudFront to Frontend Assets: /assets/*; CloudFront to Wake Function: /api/wake; CloudFront to Backend ALB: /api/*; CloudFront to the same Backend ALB: /ws/* (WebSocket); Backend ALB to Backend: Forward. Wake Function is invoked through a Lambda Function URL, not API Gateway. Do not add boundaries or other components.`;

const cases: EvaluationCase[] = [
  {
    id: 'P01', title: 'Static delivery, EN', critical: false,
    prompt: 'Draw an overall architecture with only these components: Users, CloudFront, and one S3 bucket named Frontend Assets. Users access CloudFront over HTTPS. CloudFront routes /assets/* to Frontend Assets. Do not add any boundaries or other services.',
    expected: graph([
      ['users','Users','external.user'], ['cdn','CloudFront','aws.cloudfront'], ['assets','Frontend Assets','aws.s3']
    ], [], [['users','cdn','HTTPS'],['cdn','assets','/assets/*']]) ,
    strictNodeLabels: { assets: 'Frontend Assets' }
  },
  {
    id: 'P02', title: 'First end-to-end architecture, EN', critical: true, prompt: '', promptFile: 'tests/fixtures/parser-evaluation/P02-branching.prompt.txt',
    expected: graph([
      ['user','Users','external.user'], ['cloudfront','CloudFront','aws.cloudfront'], ['s3','S3','aws.s3'], ['alb','Application Load Balancer','aws.elb.alb'], ['ecs','ECS Fargate','aws.ecs.fargate','aws-service','subnet-private'], ['dynamodb','DynamoDB','aws.dynamodb']
    ], [['vpc','VPC','vpc'],['subnet-private','Private Subnet','subnet-private','vpc']], [
      ['user','cloudfront','HTTPS'],['cloudfront','s3','/assets/*'],['cloudfront','alb','/api/*'],['alb','ecs'],['ecs','dynamodb']
    ]),
    forbiddenAssets: ['aws.vpc.nat-gateway','aws.waf','aws.ec2.internet-gateway']
  },
  {
    id: 'P03', title: 'Two independent backends, EN', critical: true,
    prompt: '', promptFile: 'tests/fixtures/parser-evaluation/P03-two-backends.prompt.txt',
    expected: graph([
      ['users','Users','external.user'], ['cloudfront','CloudFront','aws.cloudfront','aws-service','cloud'], ['s3','S3','aws.s3','aws-service','cloud'], ['alb','ALB','aws.elb.alb','aws-service','cloud'],
      ['backend-a','Backend A','aws.ecs.fargate','aws-service','subnet-a'], ['backend-b','Backend B','aws.ecs.fargate','aws-service','subnet-b'], ['dynamodb','DynamoDB','aws.dynamodb','aws-service','cloud']
    ], [['cloud','AWS Cloud','cloud'],['vpc','VPC Main','vpc','cloud'],['subnet-a','Private Subnet A','subnet-private','vpc'],['subnet-b','Private Subnet B','subnet-private','vpc']], [
      ['users','cloudfront','HTTPS'],['cloudfront','s3','/assets/*'],['cloudfront','alb','/api/*'],['alb','backend-a','Forward A'],['alb','backend-b','Forward B'],['backend-a','dynamodb','State A'],['backend-b','dynamodb','State B']
    ]),
    strictNodeLabels: { 'backend-a':'Backend A', 'backend-b':'Backend B' }
  },
  {
    id: 'P04', title: 'Two independent backends, VI', critical: false, prompt: p04,
    expected: graph([
      ['users','Users','external.user'], ['cloudfront','CloudFront','aws.cloudfront','aws-service','cloud'], ['s3','S3 bucket','aws.s3','aws-service','cloud'], ['alb','ALB','aws.elb.alb','aws-service','cloud'],
      ['backend-a','Backend A','aws.ecs.fargate','aws-service','subnet-a'], ['backend-b','Backend B','aws.ecs.fargate','aws-service','subnet-b'], ['dynamodb','DynamoDB table','aws.dynamodb','aws-service','cloud']
    ], [['cloud','AWS Cloud','cloud'],['vpc','VPC Main','vpc','cloud'],['subnet-a','Private Subnet A','subnet-private','vpc'],['subnet-b','Private Subnet B','subnet-private','vpc']], [
      ['users','cloudfront'],['cloudfront','s3'],['cloudfront','alb'],['alb','backend-a'],['alb','backend-b'],['backend-a','dynamodb'],['backend-b','dynamodb']
    ]), strictNodeLabels: { 'backend-a':'Backend A', 'backend-b':'Backend B' }
  },
  {
    id: 'P05', title: 'Route paths and parallel edges, EN', critical: true, prompt: p05,
    expected: graph([
      ['users','Users','external.user'],['cdn','CloudFront','aws.cloudfront'],['assets','Frontend Assets','aws.s3'],['wake','Wake Function','aws.lambda'],['alb','Backend ALB','aws.elb.alb'],['backend','Backend','aws.ecs.fargate']
    ], [], [['users','cdn','HTTPS'],['cdn','assets','/assets/*'],['cdn','wake','/api/wake'],['cdn','alb','/api/*'],['cdn','alb','/ws/*'],['alb','backend','Forward']]),
    strictNodeLabels: { assets:'Frontend Assets', wake:'Wake Function', alb:'Backend ALB', backend:'Backend' }, forbiddenAssets: ['aws.apigateway']
  },
  {
    id: 'P06', title: 'Data-flow scope, VI', critical: true, context: { scope:'data-flow' },
    prompt: 'Hệ thống đầy đủ còn có CloudFront, ALB, S3 và WAF, nhưng lần này chỉ vẽ luồng live caption sau: Users gửi PCM Audio đến Backend chạy ECS Fargate. Backend gửi PCM Audio đến Transcribe; Transcribe trả Transcript về Backend. Backend gửi Text đến Translate; Translate trả Translation về Backend. Backend gửi Captions về Users. Chỉ giữ bốn thành phần trong luồng này, không vẽ các dịch vụ nền hoặc boundaries. Giữ các label đúng như các cụm tiếng Anh vừa nêu.',
    expected: graph([
      ['users','Users','external.user'],['backend','Backend','aws.ecs.fargate'],['transcribe','Transcribe','aws.transcribe'],['translate','Translate','aws.translate']
    ], [], [['users','backend','PCM Audio'],['backend','transcribe','PCM Audio'],['transcribe','backend','Transcript'],['backend','translate','Text'],['translate','backend','Translation'],['backend','users','Captions']], {type:'data-flow'}),
    strictNodeLabels: {backend:'Backend', transcribe:'Transcribe', translate:'Translate'}, forbiddenAssets: ['aws.cloudfront','aws.elb.alb','aws.s3','aws.waf','aws.dynamodb','aws.vpc.nat-gateway']
  },
  {
    id: 'P07', title: 'Cardinality and no best-practice additions, EN', critical: true,
    prompt: 'Draw VPC Main with Public Subnet and Private Subnet. Put exactly one NAT Gateway named Egress NAT in Public Subnet and exactly one EC2 instance named Worker in Private Subnet. Add only Worker to Egress NAT with label HTTPS. Do not add AWS Cloud, Region, Availability Zones, Internet Gateway, WAF, load balancers, endpoints, databases, or extra NAT Gateways.',
    expected: graph([
      ['nat','Egress NAT','aws.vpc.nat-gateway','aws-service','public'],['worker','Worker','aws.ec2','aws-service','private']
    ], [['vpc','VPC Main','vpc'],['public','Public Subnet','subnet-public','vpc'],['private','Private Subnet','subnet-private','vpc']], [['worker','nat','HTTPS']]),
    strictNodeLabels: {nat:'Egress NAT', worker:'Worker'}, forbiddenAssets: ['aws.ec2.internet-gateway','aws.waf','aws.elb.alb','aws.dynamodb']
  },
  {
    id: 'P08', title: 'Mentioned but excluded from scope, VI', critical: true,
    prompt: 'Chỉ vẽ bốn node: Users, API Gateway tên Public API, Lambda tên Request Handler và DynamoDB tên State Table. Nối Users → Public API với label HTTPS, Public API → Request Handler với label Invoke, Request Handler → State Table với label State. SQS đã tắt và không thuộc diagram; ECS, RDS và cache chỉ là phương án cũ, không được vẽ. Không thêm container.',
    expected: graph([
      ['users','Users','external.user'],['api','Public API','aws.apigateway'],['handler','Request Handler','aws.lambda'],['state','State Table','aws.dynamodb']
    ], [], [['users','api','HTTPS'],['api','handler','Invoke'],['handler','state','State']]),
    strictNodeLabels: {api:'Public API', handler:'Request Handler', state:'State Table'}, forbiddenAssets: ['aws.sqs','aws.ecs','aws.rds','aws.elasticache'], forbiddenNodeLabels: ['SQS','ECS','RDS','ElastiCache','cache']
  },
  {
    id: 'P09', title: 'Nested boundaries and empty subnet, VI', critical: false,
    prompt: 'Vẽ AWS Cloud chứa Region us-east-1. Region chứa VPC Main. VPC Main chứa AZ A và AZ B. AZ A chứa Private Subnet A; AZ B chứa Private Subnet B và Reserved Subnet. Worker A và Worker B là hai Lambda riêng: A thuộc Private Subnet A, B thuộc Private Subnet B. Reserved Subnet là private subnet rỗng. Chỉ nối Worker A → Worker B với label Job, relationship event. Không thêm service hoặc boundary khác.',
    expected: graph([
      ['worker-a','Worker A','aws.lambda','aws-service','subnet-a'],['worker-b','Worker B','aws.lambda','aws-service','subnet-b']
    ], [['cloud','AWS Cloud','cloud'],['region','us-east-1','region','cloud'],['vpc','VPC Main','vpc','region'],['az-a','AZ A','availability-zone','vpc'],['az-b','AZ B','availability-zone','vpc'],['subnet-a','Private Subnet A','subnet-private','az-a'],['subnet-b','Private Subnet B','subnet-private','az-b'],['reserved','Reserved Subnet','subnet-private','az-b']], [['worker-a','worker-b','Job','event']], {type:'network'}),
    strictNodeLabels: {'worker-a':'Worker A','worker-b':'Worker B'}
  },
  {
    id: 'P10', title: 'Same asset and label in distinct groups, EN', critical: true,
    prompt: 'Draw two separate logical groups named Ingest and Export. Each group contains one SQS queue labeled Work Queue and one Lambda labeled Worker. Inside each group, connect its Work Queue to its Worker with label Job and relationship event. Keep the same labels in both groups. The two queues and two workers are distinct instances. Add no cross-group connections, additional groups, infrastructure boundaries, or other services.',
    expected: graph([
      ['ingest-queue','Work Queue','aws.sqs','aws-service','ingest'],['ingest-worker','Worker','aws.lambda','aws-service','ingest'],['export-queue','Work Queue','aws.sqs','aws-service','export'],['export-worker','Worker','aws.lambda','aws-service','export']
    ], [['ingest','Ingest','generic-group'],['export','Export','generic-group']], [['ingest-queue','ingest-worker','Job','event'],['export-queue','export-worker','Job','event']]),
    strictNodeLabels: {'ingest-queue':'Work Queue','export-queue':'Work Queue','ingest-worker':'Worker','export-worker':'Worker'}
  },
  {
    id: 'P11', title: 'External and intentional generic components, VI', critical: false,
    prompt: 'Vẽ ba thành phần không có container: Stripe là external third-party payment provider; Billing API là ứng dụng nội bộ generic; Bộ ghép âm thanh là component generic tự viết, không phải dịch vụ AWS. Nối Stripe → Billing API với label Webhook; Billing API → Bộ ghép âm thanh với label Job. Giữ nguyên ba tên này, không thay các component tự viết bằng dịch vụ AWS.',
    expected: graph([
      ['stripe','Stripe','external.third-party','external'],['billing','Billing API','generic.component','generic'],['audio','Bộ ghép âm thanh','generic.component','generic']
    ], [], [['stripe','billing','Webhook'],['billing','audio','Job']]), strictNodeLabels: {stripe:'Stripe', billing:'Billing API', audio:'Bộ ghép âm thanh'}
  },
  {
    id: 'P12', title: 'Abbreviations and equivalent wording, VI', critical: false,
    prompt: 'Users truy cập Amazon CloudFront qua HTTPS. CloudFront chuyển /assets/* tới private S3 bucket và /api/* tới Application Load Balancer (ALB). ALB chuyển tới ECS chạy bằng Fargate. Chỉ ECS được đặt trong một private subnet thuộc một VPC; vị trí các service còn lại không được chỉ định. ECS ghi trạng thái ứng dụng vào DynamoDB. Không thêm service hoặc boundaries ngoài VPC và private subnet đã nêu.',
    expected: graph([
      ['user','Users','external.user'],['cloudfront','Amazon CloudFront','aws.cloudfront'],['s3','S3 bucket','aws.s3'],['alb','Application Load Balancer','aws.elb.alb'],['ecs','ECS Fargate','aws.ecs.fargate','aws-service','subnet'],['dynamo','DynamoDB','aws.dynamodb']
    ], [['vpc','VPC','vpc'],['subnet','Private Subnet','subnet-private','vpc']], [['user','cloudfront','HTTPS'],['cloudfront','s3','/assets/*'],['cloudfront','alb','/api/*'],['alb','ecs'],['ecs','dynamo']]),
    nodeAliases: { cloudfront:['CloudFront'], s3:['private S3 bucket','Amazon S3'], alb:['ALB'], ecs:['ECS'] },
    forbiddenAssets: ['aws.vpc.nat-gateway','aws.waf']
  },
  {
    id: 'P13', title: 'Self-loop and reciprocal edges, EN', critical: false,
    prompt: 'Draw Client as a generic application and Worker as a Lambda. Add exactly three directed connections: Client to Worker labeled Request with relationship request; Worker to Client labeled Response with relationship data; Worker to itself labeled Retry with relationship event. Do not add containers or other entities.',
    expected: graph([
      ['client','Client','generic.component','generic'],['worker','Worker','aws.lambda']
    ], [], [['client','worker','Request','request'],['worker','client','Response','data'],['worker','worker','Retry','event']]), strictNodeLabels:{client:'Client',worker:'Worker'}
  },
  {
    id: 'P14', title: 'Sentence-order variant, EN', critical: false,
    prompt: '', promptFile: 'tests/fixtures/parser-evaluation/P14-two-backends-reordered.prompt.txt',
    expected: graph([], [], []), strictNodeLabels: { 'backend-a':'Backend A', 'backend-b':'Backend B' }
  },
  {
    id: 'P15', title: 'ServiceGremlin, clarified duplicate API Gateway roles, EN', critical: false,
    prompt: '', promptFile: 'tests/fixtures/parser-evaluation/P15-servicegremlin.prompt.txt',
    expected: graph([
      ['users','Users','external.user'],['web-ui','Web UI','generic.component','generic','web-ui-group'],
      ['waf','AWS WAF','aws.waf','aws-service','client-api'],['appsync','AWS AppSync','aws.appsync','aws-service','client-api'],['api-client','ServiceGremlin API','aws.apigateway','aws-service','client-api'],['cloudwatch','Amazon CloudWatch','aws.cloudwatch','aws-service','client-api'],['ssm','AWS Systems Manager','aws.systems-manager','aws-service','client-api'],
      ['cost-fn','Cost function','aws.lambda','aws-service','cost-group'],['athena','Amazon Athena','aws.athena','aws-service','storage-group'],['s3-cur','CURBucket','aws.s3','aws-service','storage-group'],['cur','AWS Cost & Usage Report (CUR)','aws.cur','aws-service','storage-group'],['s3-results','AthenaResultsBucket','aws.s3','aws-service','storage-group'],
      ['gremlin','Gremlin function','aws.lambda','aws-service','data-group'],['neptune','Amazon Neptune','aws.neptune','aws-service','data-group'],['search','Search function','aws.lambda','aws-service','data-group'],['opensearch','Amazon OpenSearch Service','aws.opensearch','aws-service','data-group'],
      ['ecs','Amazon Elastic Container Service','aws.ecs','aws-service','discovery-group'],['fargate','AWS Fargate','aws.ecs.fargate','aws-service','discovery-group'],['ecr','Amazon Elastic Container Registry','aws.ecr','aws-service','discovery-group'],
      ['api-discovery','ServiceGremlin API','aws.apigateway','aws-service','cloud'],['sdk','AWS SDK','aws.sdk','aws-service','cloud'],['config','AWS Config','aws.config','aws-service','cloud'],
      ['s3-discovery','DiscoveryBucket','aws.s3','aws-service','image-group'],['codepipeline','AWS CodePipeline','aws.codepipeline','aws-service','image-group'],['codebuild','AWS CodeBuild','aws.codebuild','aws-service','image-group'],['container-image','Container image','generic.component','generic','image-group']
    ], [
      ['cloud','AWS Cloud','cloud'],['web-ui-group','Web UI component','generic-group','cloud'],['client-api','Client API','generic-group','cloud'],['storage-group','Storage management component','generic-group','cloud'],['cost-group','Cost component','generic-group','cloud'],['vpc','VPC','vpc','cloud'],['subnet','Private subnet','subnet-private','vpc'],['data-group','Data component','generic-group','subnet'],['discovery-group','Discovery component','generic-group','subnet'],['image-group','Image deployment component','generic-group','cloud']
    ], [
      ['users','web-ui'],['web-ui','waf'],['waf','appsync'],['appsync','cloudwatch'],['appsync','ssm'],['api-client','cloudwatch'],['api-client','ssm'],['appsync','gremlin'],['api-discovery','search'],['gremlin','neptune'],['search','opensearch'],['cost-fn','athena'],['athena','s3-cur'],['cur','s3-cur'],['cost-fn','s3-results'],['ecs','fargate'],['ecs','ecr'],['fargate','sdk'],['fargate','config'],['fargate','api-discovery'],['codepipeline','s3-discovery'],['codepipeline','codebuild'],['codebuild','container-image'],['container-image','ecr']
    ]),
    strictNodeLabels: {
      'web-ui':'Web UI', 'api-client':'ServiceGremlin API', 'cost-fn':'Cost function', 's3-cur':'CURBucket',
      's3-results':'AthenaResultsBucket', 'gremlin':'Gremlin function', 'search':'Search function',
      'api-discovery':'ServiceGremlin API', 's3-discovery':'DiscoveryBucket', 'container-image':'Container image'
    }
  },
  {
    id: 'P16', title: 'Boundaries only, VI', critical: true,
    prompt: 'Chỉ vẽ kiến trúc network sau: AWS Cloud chứa Region ap-southeast-1; Region chứa VPC Main; VPC Main chứa Public Subnet và Private Subnet. Hai subnet đều rỗng. Không có service node, actor hoặc connection nào. Không thêm AZ, NAT, Internet Gateway hay component khác.',
    expected: graph([], [['cloud','AWS Cloud','cloud'],['region','ap-southeast-1','region','cloud'],['vpc','VPC Main','vpc','region'],['public','Public Subnet','subnet-public','vpc'],['private','Private Subnet','subnet-private','vpc']], [], {type:'network'})
  }
];

cases[13].expected = cases[2].expected;

function valueOrAbsent<T>(value: T | undefined): FieldRule<T> {
  return value === undefined ? { mode: 'absent' } : { mode: 'value', value };
}

function expectedText(value: string): TextRule {
  return value.includes('/') || value.includes('*')
    ? { mode: 'token', value }
    : { mode: 'text', anyOf: [value] };
}

function assertionsFor(testCase: EvaluationCase): EvaluationAssertions {
  const model = testCase.expected;
  const nodes: NonNullable<EvaluationAssertions['nodes']> = {};
  for (const node of model.nodes) {
    const strictLabel = testCase.strictNodeLabels?.[node.id];
    nodes[node.id] = {
      label: strictLabel === undefined ? { mode: 'any' } : expectedText(strictLabel),
      assetId: valueOrAbsent(node.assetId),
      kind: { mode: 'value', value: node.kind },
      containerId: valueOrAbsent(node.containerId)
    };
  }
  const containers: NonNullable<EvaluationAssertions['containers']> = {};
  for (const container of model.containers) {
    containers[container.id] = {
      label: expectedText(container.label),
      type: { mode: 'value', value: container.type },
      parentId: valueOrAbsent(container.parentId)
    };
  }
  const connections: NonNullable<EvaluationAssertions['connections']> = {};
  for (const edge of model.connections) {
    connections[edge.id] = {
      label: edge.label === undefined ? { mode: 'any' } : expectedText(edge.label),
      relationship: edge.relationship === undefined ? { mode: 'any' } : { mode: 'value', value: edge.relationship }
    };
  }
  return { scope: { mode: 'any' }, nodes, containers, connections };
}

const explicitScopeCases = new Set(['P01', 'P04', 'P06', 'P16']);
for (const testCase of cases) {
  const assertions = assertionsFor(testCase);
  if (explicitScopeCases.has(testCase.id) && testCase.expected.scope) {
    assertions.scope = { mode: 'value', value: testCase.expected.scope.type };
  }
  if (testCase.id === 'P02' || testCase.id === 'P12') {
    for (const node of testCase.expected.nodes) {
      if (node.id !== 'ecs') assertions.nodes![node.id].containerId = { mode: 'any' };
    }
  }
  testCase.assertions = assertions;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export const PARSER_EVALUATION_CASES: readonly EvaluationCase[] = deepFreeze(cases);
export const PARSER_EVALUATION_SUITE_VERSION = '1.4.0';
