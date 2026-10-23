import { z } from 'zod';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export const ValidationIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning', 'info']),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  entityId: z.string().optional()
}).strict();

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  path: Array<string | number>;
  message: string;
  entityId?: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T; issues: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

export function validationFailure<T = never>(issues: ValidationIssue[]): ValidationResult<T> {
  return { ok: false, issues: deduplicateIssues(issues) };
}

export function validationSuccess<T>(value: T, issues: ValidationIssue[] = []): ValidationResult<T> {
  return { ok: true, value, issues: deduplicateIssues(issues) };
}

export function deduplicateIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const result: ValidationIssue[] = [];
  for (const issue of issues) {
    const key = JSON.stringify([issue.severity, issue.code, issue.path, issue.entityId]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(issue);
  }
  return result;
}

export function formatValidationIssues(issues: ValidationIssue[]): string {
  return issues.map(issue => `${issue.code} at ${issue.path.join('.') || '<root>'}: ${issue.message}`).join('\n');
}

export function zodIssues(
  zodIssues: Array<{ code: string; path: Array<string | number>; message: string }>,
  codePrefix: string
): ValidationIssue[] {
  return zodIssues.map(issue => ({
    code: `${codePrefix}_${issue.code.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
    severity: 'error',
    path: issue.path,
    message: issue.message,
    entityId: typeof issue.path[issue.path.length - 1] === 'string' ? String(issue.path[issue.path.length - 1]) : undefined
  }));
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some(issue => issue.severity === 'error');
}

export function parseValidationIssues(raw: unknown): ValidationIssue[] {
  const result = z.array(ValidationIssueSchema).safeParse(raw);
  return result.success ? result.data : [];
}
