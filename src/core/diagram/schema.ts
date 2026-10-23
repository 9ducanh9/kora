import { z } from 'zod';
import { IRConnectionSchema, IRContainerSchema, IRNodeSchema, IRScopeSchema } from '../ir/schema';
import { SemanticGenerationReviewSchema } from '../ai/semantics/requirements';

const finite = z.number().finite();

export const NodePresentationSchema = z.object({
  x: finite,
  y: finite,
  width: finite.positive().optional(),
  height: finite.positive().optional(),
  selected: z.boolean().optional()
}).strict();

export const ContainerPresentationSchema = z.object({
  x: finite,
  y: finite,
  width: finite.positive(),
  height: finite.positive(),
  selected: z.boolean().optional()
}).strict();

export const ViewportSchema = z.object({
  x: finite,
  y: finite,
  zoom: finite.positive()
}).strict();

const PointSchema = z.object({ x: finite, y: finite }).strict();
const RectSchema = z.object({ x: finite, y: finite, width: finite.positive(), height: finite.positive() }).strict();

export const ConnectionRouteSchema = z.object({
  version: z.literal('1.0'),
  inputSignature: z.string().regex(/^[a-f0-9]{64}$/),
  points: z.array(PointSchema).min(2),
  label: RectSchema.optional()
}).strict();

export const ConnectionPresentationSchema = z.object({
  sourceSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
  targetSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
  route: ConnectionRouteSchema.optional()
}).strict();

const IsoTimestampSchema = z.string().refine(value => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}, 'Expected a valid ISO 8601 timestamp with timezone.');

export const DiagramSourceSchema = z.object({
  kind: z.enum(['prompt', 'fixture']),
  prompt: z.string(),
  context: z.object({ scope: z.string().optional() }).strict().optional(),
  parser: z.object({ id: z.string().min(1), model: z.string().min(1).optional() }).strict(),
  generatedAt: IsoTimestampSchema,
  semanticReview: SemanticGenerationReviewSchema.optional()
}).strict();

export const DiagramDocumentSchema = z.object({
  version: z.literal('1.0'),
  semantic: z.object({
    scope: IRScopeSchema.optional(),
    nodes: z.record(z.string(), IRNodeSchema),
    connections: z.record(z.string(), IRConnectionSchema),
    containers: z.record(z.string(), IRContainerSchema)
  }).strict(),
  presentation: z.object({
    nodes: z.record(z.string(), NodePresentationSchema),
    containers: z.record(z.string(), ContainerPresentationSchema),
    connections: z.record(z.string(), ConnectionPresentationSchema).optional(),
    viewport: ViewportSchema
  }).strict(),
  metadata: z.object({
    title: z.string(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    source: DiagramSourceSchema.optional()
  }).strict()
}).strict();

export type ParsedDiagramDocument = z.infer<typeof DiagramDocumentSchema>;
