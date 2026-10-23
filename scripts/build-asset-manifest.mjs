import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const ICONS_SRC_DIR = path.join(ROOT_DIR, 'aws-architecture-icons-2026');
const PUBLIC_ASSETS_DIR = path.join(ROOT_DIR, 'public', 'assets', 'aws');
const MANIFEST_OUTPUT = path.join(ROOT_DIR, 'src', 'core', 'assets', 'manifest.json');

// Ensure target directories exist
fs.mkdirSync(PUBLIC_ASSETS_DIR, { recursive: true });
fs.mkdirSync(path.dirname(MANIFEST_OUTPUT), { recursive: true });

// Curated V1 Services & Resources mapping
// targetId -> { displayName, category, aliases, searchPatterns }
const CURATED_CATALOG = [
  // Edge / Delivery
  {
    id: 'aws.cloudfront',
    displayName: 'Amazon CloudFront',
    category: 'edge',
    aliases: ['CloudFront', 'Amazon CloudFront', 'CDN'],
    patterns: ['Arch_Amazon-CloudFront_48.svg']
  },
  {
    id: 'aws.route53',
    displayName: 'Amazon Route 53',
    category: 'edge',
    aliases: ['Route 53', 'Route53', 'Amazon Route 53', 'DNS'],
    patterns: ['Arch_Amazon-Route-53_48.svg', 'Arch_Amazon-Route-53*48.svg']
  },
  {
    id: 'aws.waf',
    displayName: 'AWS WAF',
    category: 'security',
    aliases: ['WAF', 'AWS WAF', 'Web Application Firewall'],
    patterns: ['Arch_AWS-WAF_48.svg']
  },

  // Storage
  {
    id: 'aws.s3',
    displayName: 'Amazon S3',
    category: 'storage',
    aliases: ['S3', 'Amazon S3', 'S3 Bucket', 'Simple Storage Service'],
    patterns: ['Arch_Amazon-Simple-Storage-Service_48.svg']
  },

  // Networking
  {
    id: 'aws.elb.alb',
    displayName: 'Application Load Balancer',
    category: 'networking',
    aliases: ['ALB', 'Application Load Balancer', 'AWS ALB', 'ELB ALB', 'Elastic Load Balancing'],
    patterns: [
      'Res_Elastic-Load-Balancing_Application-Load-Balancer_48.svg',
      'Arch_Elastic-Load-Balancing_48.svg'
    ]
  },
  {
    id: 'aws.vpc',
    displayName: 'Virtual Private Cloud',
    category: 'networking',
    aliases: ['VPC', 'Virtual Private Cloud', 'AWS VPC'],
    patterns: ['Virtual-private-cloud-VPC_32.svg', 'Virtual-private-cloud-VPC*']
  },
  {
    id: 'aws.vpc.igw',
    displayName: 'Internet Gateway',
    category: 'networking',
    aliases: ['Internet Gateway', 'IGW', 'AWS IGW'],
    patterns: ['*Internet-Gateway*48.svg', '*Internet-gateway*48.svg', '*Internet-Gateway*']
  },
  {
    id: 'aws.vpc.nat-gateway',
    displayName: 'NAT Gateway',
    category: 'networking',
    aliases: ['NAT Gateway', 'NAT GW', 'NAT'],
    patterns: ['*NAT-Gateway*48.svg', '*NAT-gateway*48.svg', '*NAT-Gateway*']
  },
  {
    id: 'aws.subnet.public',
    displayName: 'Public Subnet',
    category: 'networking',
    aliases: ['Public Subnet', 'Public Subnet A', 'Public Subnet B'],
    patterns: ['Public-subnet_32.svg', 'Public-subnet*']
  },
  {
    id: 'aws.subnet.private',
    displayName: 'Private Subnet',
    category: 'networking',
    aliases: ['Private Subnet', 'Private Subnet A', 'Private Subnet B'],
    patterns: ['Private-subnet_32.svg', 'Private-subnet*']
  },

  // Compute
  {
    id: 'aws.ec2',
    displayName: 'Amazon EC2',
    category: 'compute',
    aliases: ['EC2', 'Amazon EC2', 'Virtual Server', 'Instance'],
    patterns: ['Arch_Amazon-EC2_48.svg']
  },
  {
    id: 'aws.ecs',
    displayName: 'Amazon ECS',
    category: 'compute',
    aliases: ['ECS', 'Amazon ECS', 'Elastic Container Service'],
    patterns: ['Arch_Amazon-Elastic-Container-Service_48.svg']
  },
  {
    id: 'aws.ecs.fargate',
    displayName: 'AWS Fargate',
    category: 'compute',
    aliases: ['Fargate', 'ECS Fargate', 'AWS Fargate', 'Serverless Containers'],
    patterns: ['*Fargate*48.svg', 'Arch_Amazon-Elastic-Container-Service_48.svg']
  },
  {
    id: 'aws.lambda',
    displayName: 'AWS Lambda',
    category: 'compute',
    aliases: ['Lambda', 'AWS Lambda', 'Serverless Function', 'Function URL'],
    patterns: ['Arch_AWS-Lambda_48.svg']
  },

  // Database
  {
    id: 'aws.rds',
    displayName: 'Amazon RDS',
    category: 'database',
    aliases: ['RDS', 'Amazon RDS', 'Relational Database', 'PostgreSQL', 'MySQL'],
    patterns: ['Arch_Amazon-RDS_48.svg']
  },
  {
    id: 'aws.dynamodb',
    displayName: 'Amazon DynamoDB',
    category: 'database',
    aliases: ['DynamoDB', 'Amazon DynamoDB', 'DDB', 'NoSQL Database'],
    patterns: ['Arch_Amazon-DynamoDB_48.svg']
  },
  {
    id: 'aws.elasticache',
    displayName: 'Amazon ElastiCache',
    category: 'database',
    aliases: ['ElastiCache', 'Amazon ElastiCache', 'Redis', 'Memcached'],
    patterns: ['Arch_Amazon-ElastiCache_48.svg']
  },

  // Identity & Security
  {
    id: 'aws.cognito',
    displayName: 'Amazon Cognito',
    category: 'security',
    aliases: ['Cognito', 'Amazon Cognito', 'User Pool', 'Auth Pool'],
    patterns: ['Arch_Amazon-Cognito_48.svg']
  },
  {
    id: 'aws.iam',
    displayName: 'AWS IAM',
    category: 'security',
    aliases: ['IAM', 'AWS IAM', 'Identity and Access Management'],
    patterns: ['Arch_AWS-Identity-and-Access-Management_48.svg']
  },
  {
    id: 'aws.secretsmanager',
    displayName: 'AWS Secrets Manager',
    category: 'security',
    aliases: ['Secrets Manager', 'AWS Secrets Manager'],
    patterns: ['Arch_AWS-Secrets-Manager_48.svg']
  },

  // Integration
  {
    id: 'aws.apigateway',
    displayName: 'Amazon API Gateway',
    category: 'integration',
    aliases: ['API Gateway', 'Amazon API Gateway', 'REST API', 'HTTP API'],
    patterns: ['Arch_Amazon-API-Gateway_48.svg']
  },
  {
    id: 'aws.sqs',
    displayName: 'Amazon SQS',
    category: 'integration',
    aliases: ['SQS', 'Amazon SQS', 'Simple Queue Service', 'Message Queue'],
    patterns: ['Arch_Amazon-Simple-Queue-Service_48.svg']
  },
  {
    id: 'aws.sns',
    displayName: 'Amazon SNS',
    category: 'integration',
    aliases: ['SNS', 'Amazon SNS', 'Simple Notification Service', 'Topic'],
    patterns: ['Arch_Amazon-Simple-Notification-Service_48.svg']
  },
  {
    id: 'aws.eventbridge',
    displayName: 'Amazon EventBridge',
    category: 'integration',
    aliases: ['EventBridge', 'Amazon EventBridge', 'CloudWatch Events', 'Event Bus'],
    patterns: ['Arch_Amazon-EventBridge_48.svg']
  },

  // AI & ML
  {
    id: 'aws.transcribe',
    displayName: 'Amazon Transcribe',
    category: 'aiml',
    aliases: ['Transcribe', 'Amazon Transcribe', 'Speech to Text', 'STT'],
    patterns: ['Arch_Amazon-Transcribe_48.svg']
  },
  {
    id: 'aws.translate',
    displayName: 'Amazon Translate',
    category: 'aiml',
    aliases: ['Translate', 'Amazon Translate'],
    patterns: ['Arch_Amazon-Translate_48.svg']
  },
  {
    id: 'aws.polly',
    displayName: 'Amazon Polly',
    category: 'aiml',
    aliases: ['Polly', 'Amazon Polly', 'Text to Speech', 'TTS'],
    patterns: ['Arch_Amazon-Polly_48.svg']
  },
  {
    id: 'aws.comprehend',
    displayName: 'Amazon Comprehend',
    category: 'aiml',
    aliases: ['Comprehend', 'Amazon Comprehend', 'Sentiment Analysis', 'NLP'],
    patterns: ['Arch_Amazon-Comprehend_48.svg']
  },

  // Operations
  {
    id: 'aws.cloudwatch',
    displayName: 'Amazon CloudWatch',
    category: 'operations',
    aliases: ['CloudWatch', 'Amazon CloudWatch', 'Logs', 'Metrics', 'Monitoring'],
    patterns: ['Arch_Amazon-CloudWatch_48.svg']
  },

  // Containers
  {
    id: 'aws.ecr',
    displayName: 'Amazon ECR',
    category: 'containers',
    aliases: ['ECR', 'Amazon ECR', 'Elastic Container Registry', 'Container Registry'],
    patterns: ['Arch_Amazon-Elastic-Container-Registry_48.svg']
  },

  // Extended Services for Reference Architectures (e.g. ServiceGremlin)
  {
    id: 'aws.appsync',
    displayName: 'AWS AppSync',
    category: 'integration',
    aliases: ['AppSync', 'AWS AppSync', 'GraphQL'],
    patterns: ['Arch_AWS-AppSync_48.svg']
  },
  {
    id: 'aws.systems-manager',
    displayName: 'AWS Systems Manager',
    category: 'operations',
    aliases: ['Systems Manager', 'AWS Systems Manager', 'SSM'],
    patterns: ['Arch_AWS-Systems-Manager_48.svg']
  },
  {
    id: 'aws.athena',
    displayName: 'Amazon Athena',
    category: 'database',
    aliases: ['Athena', 'Amazon Athena', 'Serverless SQL'],
    patterns: ['Arch_Amazon-Athena_48.svg']
  },
  {
    id: 'aws.cur',
    displayName: 'AWS Cost & Usage Report',
    category: 'operations',
    aliases: ['Cost & Usage Report', 'AWS Cost & Usage Report', 'AWS Cost and Usage Report', 'CUR'],
    patterns: ['Arch_AWS-Cost-and-Usage-Report_48.svg']
  },
  {
    id: 'aws.neptune',
    displayName: 'Amazon Neptune',
    category: 'database',
    aliases: ['Neptune', 'Amazon Neptune', 'Graph Database'],
    patterns: ['Arch_Amazon-Neptune_48.svg']
  },
  {
    id: 'aws.opensearch',
    displayName: 'Amazon OpenSearch Service',
    category: 'database',
    aliases: ['OpenSearch', 'Amazon OpenSearch Service', 'Amazon OpenSearch', 'Elasticsearch'],
    patterns: ['Arch_Amazon-OpenSearch-Service_48.svg']
  },
  {
    id: 'aws.sdk',
    displayName: 'AWS SDK',
    category: 'operations',
    aliases: ['AWS SDK', 'SDK', 'AWS Tools and SDKs', 'Tools and SDKs'],
    patterns: ['Arch_AWS-Tools-and-SDKs_48.svg']
  },
  {
    id: 'aws.config',
    displayName: 'AWS Config',
    category: 'operations',
    aliases: ['Config', 'AWS Config'],
    patterns: ['Arch_AWS-Config_48.svg']
  },
  {
    id: 'aws.codepipeline',
    displayName: 'AWS CodePipeline',
    category: 'operations',
    aliases: ['CodePipeline', 'AWS CodePipeline'],
    patterns: ['Arch_AWS-CodePipeline_48.svg']
  },
  {
    id: 'aws.codebuild',
    displayName: 'AWS CodeBuild',
    category: 'compute',
    aliases: ['CodeBuild', 'AWS CodeBuild'],
    patterns: ['Arch_AWS-CodeBuild_48.svg']
  }
];

// Helper to find all SVGs in a directory recursively
function findAllFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const dirent of list) {
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      results = results.concat(findAllFiles(fullPath));
    } else if (dirent.name.endsWith('.svg')) {
      results.push({ name: dirent.name, path: fullPath });
    }
  }
  return results;
}

console.log('Scanning source icon library...');
const allSourceSvgs = findAllFiles(ICONS_SRC_DIR);
console.log(`Found ${allSourceSvgs.length} SVG files in source folder.`);

const manifest = {};

for (const item of CURATED_CATALOG) {
  let matchedFile = null;

  for (const pattern of item.patterns) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
      matchedFile = allSourceSvgs.find(f => regex.test(f.name));
    } else {
      matchedFile = allSourceSvgs.find(f => f.name.toLowerCase() === pattern.toLowerCase());
    }
    if (matchedFile) break;
  }

  if (matchedFile) {
    const catDir = path.join(PUBLIC_ASSETS_DIR, item.category);
    fs.mkdirSync(catDir, { recursive: true });
    const targetFileName = `${item.id.replace(/\./g, '-')}.svg`;
    const targetFilePath = path.join(catDir, targetFileName);
    fs.copyFileSync(matchedFile.path, targetFilePath);

    manifest[item.id] = {
      id: item.id,
      displayName: item.displayName,
      category: item.category,
      assetPath: `/assets/aws/${item.category}/${targetFileName}`,
      aliases: item.aliases
    };
    console.log(`[OK] ${item.id} -> ${matchedFile.name}`);
  } else {
    console.warn(`[WARN] No matching file found for ${item.id} (patterns: ${item.patterns.join(', ')})`);
  }
}

// Write external primitives & generic fallback SVGs
function writeBuiltinSvg(id, displayName, category, filename, svgContent, aliases) {
  const catDir = path.join(PUBLIC_ASSETS_DIR, category);
  fs.mkdirSync(catDir, { recursive: true });
  const targetFilePath = path.join(catDir, filename);
  fs.writeFileSync(targetFilePath, svgContent.trim());
  manifest[id] = {
    id,
    displayName,
    category,
    assetPath: `/assets/aws/${category}/${filename}`,
    aliases
  };
  console.log(`[BUILTIN] ${id} -> ${filename}`);
}

// User / Client primitive
writeBuiltinSvg(
  'external.user',
  'Users / Clients',
  'external',
  'external-user.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="16" r="8" fill="#545B64" />
    <path d="M10 38C10 30.268 16.268 26 24 26C31.732 26 38 30.268 38 38V40H10V38Z" fill="#545B64" />
  </svg>`,
  ['User', 'Users', 'Client', 'Browser', 'Customer', 'Client Browser']
);

// Internet primitive
writeBuiltinSvg(
  'external.internet',
  'Internet',
  'external',
  'external-internet.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="18" stroke="#545B64" stroke-width="2.5" />
    <ellipse cx="24" cy="24" rx="8" ry="18" stroke="#545B64" stroke-width="2.5" />
    <line x1="6" y1="24" x2="42" y2="24" stroke="#545B64" stroke-width="2.5" />
    <line x1="9" y1="14" x2="39" y2="14" stroke="#545B64" stroke-width="2" />
    <line x1="9" y1="34" x2="39" y2="34" stroke="#545B64" stroke-width="2" />
  </svg>`,
  ['Internet', 'Public Internet', 'Web']
);

// Third party / external service
writeBuiltinSvg(
  'external.third-party',
  'Third-Party Service',
  'external',
  'external-third-party.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
    <rect x="8" y="8" width="32" height="32" rx="6" stroke="#545B64" stroke-width="2.5" stroke-dasharray="4 3" />
    <path d="M16 24L22 30L32 18" stroke="#545B64" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`,
  ['Third-Party', 'Third Party', 'External API', 'Stripe', 'External Service']
);

// Generic fallback node
writeBuiltinSvg(
  'generic.component',
  'AWS Component',
  'generic',
  'generic-component.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
    <rect x="6" y="6" width="36" height="36" rx="8" fill="#F2F3F3" stroke="#879596" stroke-width="2" />
    <circle cx="24" cy="24" r="6" fill="#879596" />
  </svg>`,
  ['Generic', 'Component', 'Service']
);

fs.writeFileSync(MANIFEST_OUTPUT, JSON.stringify(manifest, null, 2));
console.log(`\nSuccessfully generated manifest with ${Object.keys(manifest).length} assets at:\n${MANIFEST_OUTPUT}`);
