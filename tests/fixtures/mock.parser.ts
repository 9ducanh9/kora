import { KoraArchitectureModel } from '../../src/core/ir/types';
import { ArchitectureParseResult, ArchitectureParser, ArchitectureContext } from '../../src/core/ai/parser.interface';
import { validateArchitectureModel } from '../../src/core/ir/validator';

/**
 * MockArchitectureParser is strictly test infrastructure for offline deterministic pipeline testing.
 * It is never used in the user interface to claim prompt understanding works.
 */
export class MockArchitectureParser implements ArchitectureParser {
  readonly id = 'mock-fixture';
  readonly name = 'Mock Fixture Parser';

  private cannedResponses: Map<string, KoraArchitectureModel> = new Map();

  constructor() {
    this.initDefaultFixtures();
  }

  setFixture(promptKey: string, model: KoraArchitectureModel) {
    this.cannedResponses.set(promptKey, model);
  }

  async parse(prompt: string, context?: ArchitectureContext): Promise<ArchitectureParseResult> {
    void context;
    let selected: KoraArchitectureModel | undefined;
    for (const [key, fixture] of this.cannedResponses.entries()) {
      if (prompt.toLowerCase().includes(key.toLowerCase())) {
        selected = fixture;
        break;
      }
    }
    selected ??= this.getDefaultFixture();
    const validation = validateArchitectureModel(structuredClone(selected));
    if (!validation.ok) throw new Error(`Invalid mock fixture: ${validation.issues.map(issue => issue.code).join(', ')}`);
    return { model: validation.value, issues: validation.issues };
  }

  private initDefaultFixtures() {
    // Acceptance Test fixture (Section 22)
    this.cannedResponses.set('CloudFront routes /assets/* to a private S3 bucket', {
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
        { id: 'conn-1', source: 'user', target: 'cloudfront', relationship: 'request', label: 'HTTPS' },
        { id: 'conn-2', source: 'cloudfront', target: 's3', relationship: 'request', label: '/assets/*' },
        { id: 'conn-3', source: 'cloudfront', target: 'alb', relationship: 'request', label: '/api/*' },
        { id: 'conn-4', source: 'alb', target: 'ecs', relationship: 'request', label: 'Forward' },
        { id: 'conn-5', source: 'ecs', target: 'dynamodb', relationship: 'data', label: 'State' }
      ],
      containers: [
        { id: 'vpc', label: 'VPC', type: 'vpc' },
        { id: 'subnet-private', label: 'Private Subnet', type: 'subnet-private', parentId: 'vpc' }
      ]
    });
  }

  private getDefaultFixture(): KoraArchitectureModel {
    return {
      version: '1.0',
      scope: { type: 'overall-architecture', title: 'Default Test Fixture' },
      nodes: [
        { id: 'user', label: 'Users', kind: 'external', assetId: 'external.user' },
        { id: 'cloudfront', label: 'CloudFront', kind: 'aws-service', assetId: 'aws.cloudfront' },
        { id: 'alb', label: 'ALB', kind: 'aws-resource', assetId: 'aws.elb.alb' },
        { id: 'ecs', label: 'ECS Backend', kind: 'aws-service', assetId: 'aws.ecs' }
      ],
      connections: [
        { id: 'conn-1', source: 'user', target: 'cloudfront', relationship: 'request', label: 'HTTPS' },
        { id: 'conn-2', source: 'cloudfront', target: 'alb', relationship: 'request', label: '/api/*' },
        { id: 'conn-3', source: 'alb', target: 'ecs', relationship: 'request', label: 'Forward' }
      ],
      containers: []
    };
  }
}
