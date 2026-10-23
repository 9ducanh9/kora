export type NodeKind = 'aws-service' | 'aws-resource' | 'external' | 'actor' | 'generic';

export interface IRNode {
  id: string;                     // e.g. "cloudfront", "alb", "ecs-backend"
  label: string;                  // Display title e.g. "Amazon CloudFront"
  kind: NodeKind;
  assetId?: string;               // Semantic asset ID e.g. "aws.cloudfront", "aws.elb.alb"
  subtitle?: string;              // Optional detail e.g. "Fargate Tasks"
  containerId?: string;           // ID of the container this node belongs to (ONLY when explicitly stated)
  metadata?: Record<string, string>;
}

export type ConnectionRelationship = 
  | 'request'       // Synchronous request (HTTP, HTTPS, gRPC)
  | 'data'          // Data flow / stream / storage read-write
  | 'event'         // Asynchronous event / notification / queue
  | 'auth'          // Authentication / IAM token
  | 'association';  // Logical binding

export interface IRConnection {
  id: string;                     // e.g. "conn-1"
  source: string;                 // Source node ID
  target: string;                 // Target node ID
  relationship?: ConnectionRelationship;
  label?: string;                 // e.g. "HTTPS", "/api/*", "/assets/*"
  description?: string;
}

export type ContainerType = 
  | 'cloud'               // AWS Cloud
  | 'region'              // AWS Region
  | 'vpc'                 // Virtual Private Cloud
  | 'availability-zone'   // AZ (e.g. us-east-1a)
  | 'subnet-public'       // Public Subnet
  | 'subnet-private'      // Private Subnet
  | 'auto-scaling-group'  // Auto Scaling Group
  | 'security-group'
  | 'corporate-data-center' // Corporate Data Center
  | 'generic-group';

export interface IRContainer {
  id: string;                     // e.g. "vpc-main", "subnet-priv-1"
  label: string;                  // e.g. "VPC", "Private Subnet"
  type: ContainerType;
  parentId?: string;              // For nested hierarchy: subnet.parentId = vpc.id
  origin?: 'explicit' | 'system'; // Distinguishes auto-enclosed AWS Cloud from explicit IR containers
}

export interface IRScope {
  type: 'overall-architecture' | 'network' | 'data-flow' | 'auth' | 'custom';
  title?: string;
}

export interface KoraArchitectureModel {
  version: '1.0';
  scope?: IRScope;
  nodes: IRNode[];
  connections: IRConnection[];
  containers: IRContainer[];
  metadata?: {
    promptSummary?: string;
    generatedAt?: string;
  };
}
