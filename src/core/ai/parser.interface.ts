import { KoraArchitectureModel } from '../ir/types';
import { ValidationIssue } from '../validation/issues';
import type { SemanticGenerationReview } from './semantics/requirements';

export interface ArchitectureParseResult {
  model: KoraArchitectureModel;
  issues: ValidationIssue[];
  observation?: ParserObservation;
  review?: SemanticGenerationReview;
}

export interface ParserObservation {
  requestedModel?: string;
  returnedModel?: string;
  returnedFingerprint?: string;
  httpStatus?: number;
  durationMs: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  finishReason?: string;
}

export interface ParserRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onRequestSent?: () => void;
  onObservation?: (observation: ParserObservation) => void;
}

export class ArchitectureParseError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    readonly issues: ValidationIssue[] = [],
    readonly status = 502
  ) {
    super(publicMessage);
    this.name = 'ArchitectureParseError';
  }
}

export interface ArchitectureContext {
  scope?: string;
  preferredRegion?: string;
}

export interface ArchitectureParser {
  readonly id: string;
  readonly name: string;
  parse(prompt: string, context?: ArchitectureContext, options?: ParserRequestOptions): Promise<ArchitectureParseResult>;
}
