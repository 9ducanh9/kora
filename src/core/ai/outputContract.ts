import { z } from 'zod';
import { KoraArchitectureModelSchema } from '../ir/schema';

/** Describe the actual validator, rather than maintaining a second handwritten schema. */
export function describeOutputSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional) return describeOutputSchema(schema.unwrap());
  if (schema instanceof z.ZodDefault) return describeOutputSchema(schema.removeDefault());
  if (schema instanceof z.ZodString) {
    return { type: 'string', ...(schema.minLength !== null ? { minLength: schema.minLength } : {}), ...(schema.maxLength !== null ? { maxLength: schema.maxLength } : {}) };
  }
  if (schema instanceof z.ZodLiteral) return { const: schema.value };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options };
  if (schema instanceof z.ZodArray) return { type: 'array', items: describeOutputSchema(schema.element), ...(schema._def.minLength ? { minItems: schema._def.minLength.value } : {}), ...(schema._def.maxLength ? { maxItems: schema._def.maxLength.value } : {}) };
  if (schema instanceof z.ZodRecord) return { type: 'object', additionalProperties: describeOutputSchema(schema.valueSchema) };
  if (schema instanceof z.ZodObject) {
    const fields: Record<string, z.ZodTypeAny> = schema.shape;
    return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, describeOutputSchema(field)])),
      required: Object.entries(fields).filter(([, field]) => !field.isOptional()).map(([key]) => key),
      additionalProperties: false
    };
  }
  throw new Error(`Unsupported IR schema type: ${schema._def.typeName}`);
}

export const ARCHITECTURE_OUTPUT_CONTRACT = describeOutputSchema(KoraArchitectureModelSchema);
