import { z } from 'zod';

export const NodeKindSchema = z.enum([
  'aws-service',
  'aws-resource',
  'external',
  'actor',
  'generic'
]);

export const IRNodeSchema = z.object({
  id: z.string().min(1, 'Node ID cannot be empty'),
  label: z.string().min(1, 'Node label cannot be empty'),
  kind: NodeKindSchema,
  assetId: z.string().optional(),
  subtitle: z.string().optional(),
  containerId: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional()
}).strict();

export const ConnectionRelationshipSchema = z.enum([
  'request',
  'data',
  'event',
  'auth',
  'association'
]);

export const IRConnectionSchema = z.object({
  id: z.string().min(1, 'Connection ID cannot be empty'),
  source: z.string().min(1, 'Connection source cannot be empty'),
  target: z.string().min(1, 'Connection target cannot be empty'),
  relationship: ConnectionRelationshipSchema.optional(),
  label: z.string().optional(),
  description: z.string().optional()
}).strict();

export const ContainerTypeSchema = z.enum([
  'cloud',
  'region',
  'vpc',
  'availability-zone',
  'subnet-public',
  'subnet-private',
  'auto-scaling-group',
  'security-group',
  'corporate-data-center',
  'generic-group'
]);

export const IRContainerSchema = z.object({
  id: z.string().min(1, 'Container ID cannot be empty'),
  label: z.string().min(1, 'Container label cannot be empty'),
  type: ContainerTypeSchema,
  parentId: z.string().optional(),
  origin: z.enum(['explicit', 'system']).optional()
}).strict();

export const IRScopeSchema = z.object({
  type: z.enum(['overall-architecture', 'network', 'data-flow', 'auth', 'custom']),
  title: z.string().optional()
}).strict();

export const KoraArchitectureModelSchema = z.object({
  version: z.literal('1.0'),
  scope: IRScopeSchema.optional(),
  nodes: z.array(IRNodeSchema),
  connections: z.array(IRConnectionSchema),
  containers: z.array(IRContainerSchema).default([]),
  metadata: z.object({
    promptSummary: z.string().optional(),
    generatedAt: z.string().optional()
  }).strict().optional()
}).strict();

export type ValidatedArchitectureModel = z.infer<typeof KoraArchitectureModelSchema>;
