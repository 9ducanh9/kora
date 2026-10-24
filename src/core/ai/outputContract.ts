import { z } from 'zod';
import { KoraArchitectureModelSchema } from '../ir/schema';

/** Use Zod's public schema exporter so provider contracts follow the validator. */
export function describeOutputSchema(schema: z.ZodType): Record<string, unknown> {
  const described = z.toJSONSchema(schema, { io: 'input', target: 'draft-7' });
  delete described.$schema;
  return described;
}

export const ARCHITECTURE_OUTPUT_CONTRACT = describeOutputSchema(KoraArchitectureModelSchema);
