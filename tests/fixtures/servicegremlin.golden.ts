import { KoraArchitectureModel } from '../../src/core/ir/types';

/**
 * ServiceGremlin Golden Reference Architecture Model
 *
 * Expected Architecture:
 * - 9 explicit logical & infrastructure containers
 * - ~29 architecture nodes
 * - Complete data-flow & control-flow connections
 * - Mandatory AWS Cloud root added deterministically by Kora normalization
 */
export const SERVICEGREMLIN_GOLDEN_MODEL: KoraArchitectureModel = {
  version: '1.0',
  scope: {
    type: 'overall-architecture',
    title: 'ServiceGremlin — Infrastructure Dependency Visualizer'
  },
  containers: [
    // 1. Web UI component (logical group)
    { id: 'group-web-ui', label: 'Web UI component', type: 'generic-group' },

    // 2. Client API (logical group)
    { id: 'group-client-api', label: 'Client API', type: 'generic-group' },

    // 3. Storage management component (logical group)
    { id: 'group-storage', label: 'Storage management component', type: 'generic-group' },

    // 4. Cost component (logical group)
    { id: 'group-cost', label: 'Cost component', type: 'generic-group' },

    // 5. VPC (AWS Infrastructure container)
    { id: 'vpc-main', label: 'VPC', type: 'vpc' },

    // 6. Private subnet (AWS Infrastructure container inside VPC)
    { id: 'subnet-priv', label: 'Private subnet', type: 'subnet-private', parentId: 'vpc-main' },

    // 7. Data component (logical group inside Private subnet)
    { id: 'group-data', label: 'Data component', type: 'generic-group', parentId: 'subnet-priv' },

    // 8. Discovery component (logical group inside Private subnet)
    { id: 'group-discovery', label: 'Discovery component', type: 'generic-group', parentId: 'subnet-priv' },

    // 9. Image deployment component (logical group on far right)
    { id: 'group-image-deploy', label: 'Image deployment component', type: 'generic-group' }
  ],
  nodes: [
    // External Client Actor
    { id: 'users', label: 'Users', kind: 'external', assetId: 'external.user' },

    // Web UI component
    { id: 'web-ui', label: 'Web UI', kind: 'generic', assetId: 'generic.component', containerId: 'group-web-ui' },

    // Client API logical group
    { id: 'waf', label: 'AWS WAF', kind: 'aws-service', assetId: 'aws.waf', containerId: 'group-client-api' },
    { id: 'appsync', label: 'AWS AppSync', kind: 'aws-service', assetId: 'aws.appsync', containerId: 'group-client-api' },
    { id: 'api-gw', label: 'ServiceGremlin API', kind: 'aws-service', assetId: 'aws.apigateway', containerId: 'group-client-api' },
    { id: 'cloudwatch', label: 'Amazon CloudWatch', kind: 'aws-service', assetId: 'aws.cloudwatch', containerId: 'group-client-api' },
    { id: 'ssm', label: 'AWS Systems Manager', kind: 'aws-service', assetId: 'aws.systems-manager', containerId: 'group-client-api' },

    // Cost component
    { id: 'cost-fn', label: 'Cost function', kind: 'aws-service', assetId: 'aws.lambda', containerId: 'group-cost' },

    // Storage management component
    { id: 'athena', label: 'Amazon Athena', kind: 'aws-service', assetId: 'aws.athena', containerId: 'group-storage' },
    { id: 's3-cur', label: 'CURBucket', kind: 'aws-service', assetId: 'aws.s3', containerId: 'group-storage' },
    { id: 'cur', label: 'AWS Cost & Usage Report (CUR)', kind: 'aws-service', assetId: 'aws.cur', containerId: 'group-storage' },
    { id: 's3-athena-res', label: 'AthenaResultsBucket', kind: 'aws-service', assetId: 'aws.s3', containerId: 'group-storage' },

    // Data component (nested in Private Subnet)
    { id: 'gremlin-fn', label: 'Gremlin function', kind: 'aws-service', assetId: 'aws.lambda', containerId: 'group-data' },
    { id: 'neptune', label: 'Amazon Neptune', kind: 'aws-service', assetId: 'aws.neptune', containerId: 'group-data' },
    { id: 'search-fn', label: 'Search function', kind: 'aws-service', assetId: 'aws.lambda', containerId: 'group-data' },
    { id: 'opensearch', label: 'Amazon OpenSearch Service', kind: 'aws-service', assetId: 'aws.opensearch', containerId: 'group-data' },

    // Discovery component (nested in Private Subnet)
    { id: 'ecs', label: 'Amazon Elastic Container Service', kind: 'aws-service', assetId: 'aws.ecs', containerId: 'group-discovery' },
    { id: 'fargate', label: 'AWS Fargate', kind: 'aws-service', assetId: 'aws.ecs.fargate', containerId: 'group-discovery' },
    { id: 'ecr', label: 'Amazon Elastic Container Registry', kind: 'aws-service', assetId: 'aws.ecr', containerId: 'group-discovery' },

    // Discovery Inputs (in AWS Cloud, outside VPC)
    { id: 'api-gw-discovery', label: 'ServiceGremlin API', kind: 'aws-service', assetId: 'aws.apigateway' },
    { id: 'aws-sdk', label: 'AWS SDK', kind: 'aws-service', assetId: 'aws.sdk' },
    { id: 'aws-config', label: 'AWS Config', kind: 'aws-service', assetId: 'aws.config' },

    // Image deployment component
    { id: 's3-discovery', label: 'DiscoveryBucket', kind: 'aws-service', assetId: 'aws.s3', containerId: 'group-image-deploy' },
    { id: 'codepipeline', label: 'AWS CodePipeline', kind: 'aws-service', assetId: 'aws.codepipeline', containerId: 'group-image-deploy' },
    { id: 'codebuild', label: 'AWS CodeBuild', kind: 'aws-service', assetId: 'aws.codebuild', containerId: 'group-image-deploy' },
    { id: 'container-image', label: 'Container image', kind: 'generic', assetId: 'generic.component', containerId: 'group-image-deploy' }
  ],
  connections: [
    // Client flow
    { id: 'c1', source: 'users', target: 'web-ui', label: 'Interacts' },
    { id: 'c2', source: 'web-ui', target: 'waf', label: 'HTTPS' },
    { id: 'c3', source: 'waf', target: 'appsync' },
    { id: 'c4', source: 'appsync', target: 'cloudwatch' },
    { id: 'c5', source: 'appsync', target: 'ssm' },
    { id: 'c6', source: 'api-gw', target: 'cloudwatch' },
    { id: 'c7', source: 'api-gw', target: 'ssm' },

    // Client to Data component
    { id: 'c8', source: 'appsync', target: 'gremlin-fn' },
    { id: 'c9', source: 'api-gw', target: 'search-fn' },

    // Data component internal
    { id: 'c10', source: 'gremlin-fn', target: 'neptune' },
    { id: 'c11', source: 'search-fn', target: 'opensearch' },

    // Cost & Storage management
    { id: 'c12', source: 'cost-fn', target: 'athena' },
    { id: 'c13', source: 'athena', target: 's3-cur' },
    { id: 'c14', source: 'cur', target: 's3-cur' },
    { id: 'c15', source: 'cost-fn', target: 's3-athena-res' },

    // Discovery internal
    { id: 'c16', source: 'ecs', target: 'fargate' },
    { id: 'c17', source: 'ecs', target: 'ecr' },

    // Discovery inputs
    { id: 'c18', source: 'fargate', target: 'aws-sdk' },
    { id: 'c19', source: 'fargate', target: 'aws-config' },
    { id: 'c20', source: 'fargate', target: 'api-gw-discovery' },

    // Image deployment
    { id: 'c21', source: 'codepipeline', target: 's3-discovery' },
    { id: 'c22', source: 'codepipeline', target: 'codebuild' },
    { id: 'c23', source: 'codebuild', target: 'container-image' },
    { id: 'c24', source: 'container-image', target: 'ecr' }
  ]
};
