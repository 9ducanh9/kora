import { z } from 'zod';
import { ValidationIssue, ValidationIssueSchema } from '../validation/issues';
import { SemanticGenerationReviewSchema } from './semantics/requirements';

export const ParseResponseSchema = z.object({
  success: z.boolean(),
  model: z.unknown().optional(),
  issues: z.array(ValidationIssueSchema).optional(),
  review: SemanticGenerationReviewSchema.optional(),
  parser: z.object({ id: z.string().optional(), name: z.string().optional(), model: z.string().optional() }).optional(),
  error: z.string().optional(),
  code: z.string().optional()
}).passthrough();

export class ParserResponseError extends Error {
  constructor(message: string, readonly code?: string, readonly issues: ValidationIssue[] = []) {
    super(message);
    this.name = 'ParserResponseError';
  }
}

export function readParseResponse(raw: unknown) {
  const parsed = ParseResponseSchema.safeParse(raw);
  if (!parsed.success) throw new ParserResponseError('The parser returned an invalid response envelope.', 'INVALID_PARSER_RESPONSE');
  if (!parsed.data.success) throw new ParserResponseError(parsed.data.error || 'Architecture generation failed.', parsed.data.code, parsed.data.issues);
  if (parsed.data.model === undefined) throw new ParserResponseError('The parser response did not contain a model.', 'PARSER_MODEL_MISSING');
  return parsed.data;
}
