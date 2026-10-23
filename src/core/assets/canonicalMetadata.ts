/**
 * Curated Canonical Asset Metadata
 *
 * Single human-curated source of truth for display short names and canonical aliases.
 * This decoupled metadata layer overrides or augments the asset manifest without relying
 * on build scripts or automated file scrapers.
 */

export interface CanonicalMetadataEntry {
  shortName: string;
  aliases?: string[];
}

export const CANONICAL_ASSET_METADATA: Record<string, CanonicalMetadataEntry> = {
  // Edge / Delivery
  'aws.cloudfront': {
    shortName: 'CloudFront',
    aliases: ['CloudFront', 'Amazon CloudFront', 'CDN']
  },
  'aws.route53': {
    shortName: 'Route 53',
    aliases: ['Route 53', 'Route53', 'Amazon Route 53', 'DNS']
  },
  'aws.waf': {
    shortName: 'WAF',
    aliases: ['WAF', 'AWS WAF', 'Web Application Firewall']
  },

  // Storage
  'aws.s3': {
    shortName: 'S3',
    aliases: ['S3', 'Amazon S3', 'S3 Bucket', 'Simple Storage Service', 'Amazon Simple Storage Service']
  },

  // Networking
  'aws.elb.alb': {
    shortName: 'ALB',
    aliases: ['ALB', 'Application Load Balancer', 'AWS ALB', 'ELB ALB', 'Elastic Load Balancing']
  },
  'aws.vpc': {
    shortName: 'VPC',
    aliases: ['VPC', 'Virtual Private Cloud', 'AWS VPC']
  },
  'aws.vpc.igw': {
    shortName: 'Internet Gateway',
    aliases: ['Internet Gateway', 'IGW', 'AWS IGW']
  },
  'aws.vpc.nat-gateway': {
    shortName: 'NAT Gateway',
    aliases: ['NAT Gateway', 'NAT GW', 'NAT']
  },
  'aws.subnet.public': {
    shortName: 'Public Subnet',
    aliases: ['Public Subnet', 'Public Subnet A', 'Public Subnet B']
  },
  'aws.subnet.private': {
    shortName: 'Private Subnet',
    aliases: ['Private Subnet', 'Private Subnet A', 'Private Subnet B']
  },

  // Compute
  'aws.ec2': {
    shortName: 'EC2',
    aliases: ['EC2', 'Amazon EC2', 'Virtual Server', 'Instance']
  },
  'aws.ecs': {
    shortName: 'ECS',
    aliases: ['ECS', 'Amazon ECS', 'Elastic Container Service', 'Amazon Elastic Container Service']
  },
  'aws.ecs.fargate': {
    shortName: 'ECS Fargate',
    aliases: ['Fargate', 'ECS Fargate', 'AWS Fargate', 'Serverless Containers']
  },
  'aws.lambda': {
    shortName: 'Lambda',
    aliases: ['Lambda', 'AWS Lambda', 'Serverless Function', 'Function URL']
  },

  // Database
  'aws.rds': {
    shortName: 'RDS',
    aliases: ['RDS', 'Amazon RDS', 'Relational Database', 'PostgreSQL', 'MySQL']
  },
  'aws.dynamodb': {
    shortName: 'DynamoDB',
    aliases: ['DynamoDB', 'Amazon DynamoDB', 'DDB', 'NoSQL Database']
  },
  'aws.elasticache': {
    shortName: 'ElastiCache',
    aliases: ['ElastiCache', 'Amazon ElastiCache', 'Redis', 'Memcached']
  },

  // Security & Identity
  'aws.cognito': {
    shortName: 'Cognito',
    aliases: ['Cognito', 'Amazon Cognito', 'User Pool', 'Auth Pool']
  },
  'aws.iam': {
    shortName: 'IAM',
    aliases: ['IAM', 'AWS IAM', 'Identity and Access Management', 'AWS Identity and Access Management']
  },
  'aws.secretsmanager': {
    shortName: 'Secrets Manager',
    aliases: ['Secrets Manager', 'AWS Secrets Manager']
  },

  // Integration
  'aws.apigateway': {
    shortName: 'API Gateway',
    aliases: ['API Gateway', 'Amazon API Gateway', 'REST API', 'HTTP API']
  },
  'aws.sqs': {
    shortName: 'SQS',
    aliases: ['SQS', 'Amazon SQS', 'Simple Queue Service', 'Message Queue', 'Amazon Simple Queue Service']
  },
  'aws.sns': {
    shortName: 'SNS',
    aliases: ['SNS', 'Amazon SNS', 'Simple Notification Service', 'Topic', 'Amazon Simple Notification Service']
  },
  'aws.eventbridge': {
    shortName: 'EventBridge',
    aliases: ['EventBridge', 'Amazon EventBridge', 'CloudWatch Events', 'Event Bus']
  },

  // AI & ML
  'aws.transcribe': {
    shortName: 'Transcribe',
    aliases: ['Transcribe', 'Amazon Transcribe', 'Speech to Text', 'STT']
  },
  'aws.translate': {
    shortName: 'Translate',
    aliases: ['Translate', 'Amazon Translate']
  },
  'aws.polly': {
    shortName: 'Polly',
    aliases: ['Polly', 'Amazon Polly', 'Text to Speech', 'TTS']
  },
  'aws.comprehend': {
    shortName: 'Comprehend',
    aliases: ['Comprehend', 'Amazon Comprehend', 'Sentiment Analysis', 'NLP']
  },

  // Operations
  'aws.cloudwatch': {
    shortName: 'CloudWatch',
    aliases: ['CloudWatch', 'Amazon CloudWatch', 'Logs', 'Metrics', 'Monitoring']
  },

  // Containers
  'aws.ecr': {
    shortName: 'ECR',
    aliases: ['ECR', 'Amazon ECR', 'Elastic Container Registry', 'Amazon Elastic Container Registry', 'Container Registry']
  },

  // Extended Services for Reference Architectures (e.g. ServiceGremlin)
  'aws.appsync': {
    shortName: 'AppSync',
    aliases: ['AppSync', 'AWS AppSync', 'GraphQL']
  },
  'aws.systems-manager': {
    shortName: 'Systems Manager',
    aliases: ['Systems Manager', 'AWS Systems Manager', 'SSM', 'Amazon Systems Manager']
  },
  'aws.athena': {
    shortName: 'Athena',
    aliases: ['Athena', 'Amazon Athena', 'Serverless SQL']
  },
  'aws.cur': {
    shortName: 'Cost & Usage Report',
    aliases: ['Cost & Usage Report', 'AWS Cost & Usage Report', 'AWS Cost and Usage Report', 'Cost and Usage Report', 'CUR', 'AWS Cost & Usage Report (CUR)']
  },
  'aws.neptune': {
    shortName: 'Neptune',
    aliases: ['Neptune', 'Amazon Neptune', 'Graph Database']
  },
  'aws.opensearch': {
    shortName: 'OpenSearch',
    aliases: ['OpenSearch', 'Amazon OpenSearch Service', 'Amazon OpenSearch', 'OpenSearch Service', 'Elasticsearch']
  },
  'aws.sdk': {
    shortName: 'AWS SDK',
    aliases: ['AWS SDK', 'SDK', 'AWS Tools and SDKs', 'Tools and SDKs']
  },
  'aws.config': {
    shortName: 'Config',
    aliases: ['Config', 'AWS Config']
  },
  'aws.codepipeline': {
    shortName: 'CodePipeline',
    aliases: ['CodePipeline', 'AWS CodePipeline']
  },
  'aws.codebuild': {
    shortName: 'CodeBuild',
    aliases: ['CodeBuild', 'AWS CodeBuild']
  },

  // External / Generic
  'external.user': {
    shortName: 'Users',
    aliases: ['User', 'Users', 'Client', 'Browser', 'Customer', 'Client Browser', 'Users / Clients']
  },
  'external.internet': {
    shortName: 'Internet',
    aliases: ['Internet', 'Public Internet', 'Web']
  },
  'external.third-party': {
    shortName: 'Third Party',
    aliases: ['Third-Party', 'Third Party', 'External API', 'Stripe', 'DeepSeek', 'External Service', 'Third-Party Service']
  },
  'generic.component': {
    shortName: 'Component',
    aliases: ['Generic', 'Component', 'Service', 'AWS Component']
  }
};
