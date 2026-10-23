import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ArchitectureParseError, ArchitectureParser } from '../parser.interface';
import { EvaluationCase } from './corpus';
import { evaluateParserOutput, SemanticEvaluation } from './matcher';

export type LiveTrialStatus = 'NOT_RUN' | 'PROVIDER_ERROR' | 'TIMEOUT' | 'INVALID_JSON' | 'EMPTY_OUTPUT' | 'INVALID_MODEL' | 'SEMANTIC_FAIL' | 'PASS' | 'HARNESS_ERROR';

export interface LiveTrialResult {
  caseId: string;
  trial: number;
  status: LiveTrialStatus;
  durationMs?: number;
  requestedModel?: string;
  returnedModel?: string;
  returnedFingerprint?: string;
  requestSent?: boolean;
  httpStatus?: number;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  code?: string;
  reason?: string;
  semantic?: SemanticEvaluation;
}

export interface LiveRunnerConfig {
  repetitions: number;
  maxRequests: number;
  timeoutMs: number;
}

export interface LiveRunnerDependencies {
  parser: ArchitectureParser;
  hasCredential: boolean;
  requestedModel: string;
  interruptionSignal?: AbortSignal;
}

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json(value), 'utf8');
}

function classifyError(error: unknown): { status: LiveTrialStatus; code?: string; reason: string } {
  if (error instanceof ArchitectureParseError) {
    const status: LiveTrialStatus = error.code === 'PROVIDER_INVALID_JSON' ? 'INVALID_JSON' : error.code === 'PROVIDER_EMPTY_RESPONSE' ? 'EMPTY_OUTPUT' : error.code === 'PROVIDER_INVALID_MODEL' ? 'INVALID_MODEL' : error.code === 'PROVIDER_TIMEOUT' ? 'TIMEOUT' : 'PROVIDER_ERROR';
    return { status, code: error.code, reason: error.publicMessage };
  }
  if (error instanceof Error && error.name === 'AbortError') return { status: 'TIMEOUT', code: 'REQUEST_ABORTED', reason: 'Request deadline expired or the request was aborted.' };
  return { status: 'PROVIDER_ERROR', code: 'PROVIDER_REQUEST_FAILED', reason: 'Provider request failed; exception details were omitted.' };
}

/** Runs the serialized live schedule with injected transport ownership for offline ledger tests. */
export async function runLiveEvaluation(
  config: LiveRunnerConfig,
  cases: EvaluationCase[],
  directory: string,
  dependencies: LiveRunnerDependencies
): Promise<{ results: LiveTrialResult[]; requestCount: number }> {
  const results: LiveTrialResult[] = [];
  let requestCount = 0;
  let stopReason: string | undefined;
  let interrupted = false;
  let activeRequestController: AbortController | undefined;
  const onInterrupt = () => {
    interrupted = true;
    activeRequestController?.abort(new DOMException('Interrupted by user.', 'AbortError'));
  };
  dependencies.interruptionSignal?.addEventListener('abort', onInterrupt, { once: true });
  if (dependencies.interruptionSignal?.aborted) onInterrupt();

  try {
    for (let trial = 1; trial <= config.repetitions; trial++) {
      for (const testCase of cases) {
        const result: LiveTrialResult = {
          caseId: testCase.id,
          trial,
          status: 'NOT_RUN',
          requestedModel: dependencies.requestedModel,
          returnedModel: 'unknown',
          returnedFingerprint: 'unknown',
          finishReason: 'unknown',
          reason: 'No live request was scheduled.'
        };
        const trialDirectory = join(directory, 'trials', testCase.id, `t${trial}`);
        if (!dependencies.hasCredential) {
          result.reason = 'Missing DEEPSEEK_API_KEY or DEEPSEEK_KEY in process environment.';
        } else if (interrupted) {
          result.reason = 'Run interrupted by the user before this request was sent.';
        } else if (stopReason) {
          result.reason = stopReason;
        } else if (requestCount >= config.maxRequests) {
          result.reason = 'Live request budget exhausted before this scheduled slot.';
        } else {
          const controller = new AbortController();
          activeRequestController = controller;
          const startedAt = Date.now();
          const timeout = setTimeout(() => controller.abort(new DOMException('Request deadline expired.', 'AbortError')), config.timeoutMs);
          try {
            const parsed = await dependencies.parser.parse(testCase.prompt, testCase.context, {
              signal: controller.signal,
              timeoutMs: config.timeoutMs,
              onRequestSent: () => {
                if (requestCount >= config.maxRequests) throw new Error('Request budget exhausted.');
                requestCount++;
                result.requestSent = true;
              },
              onObservation: observation => {
                result.requestedModel = observation.requestedModel ?? dependencies.requestedModel;
                result.returnedModel = observation.returnedModel ?? 'unknown';
                result.returnedFingerprint = observation.returnedFingerprint ?? 'unknown';
                result.finishReason = observation.finishReason ?? 'unknown';
                result.httpStatus = observation.httpStatus;
                result.durationMs = observation.durationMs;
                result.usage = observation.usage;
              }
            });
            result.semantic = evaluateParserOutput(testCase, parsed.model);
            result.status = result.semantic.verdict;
            result.durationMs = result.durationMs ?? Date.now() - startedAt;
            result.reason = undefined;
            await writeJson(join(trialDirectory, 'parser-ir.json'), parsed.model);
            await writeJson(join(trialDirectory, 'issues.json'), parsed.issues);
            await writeJson(join(trialDirectory, 'semantic-diff.json'), result.semantic);
          } catch (error) {
            const classified = classifyError(error);
            result.status = classified.status;
            result.code = classified.code;
            result.reason = classified.reason;
            result.durationMs = result.durationMs ?? Date.now() - startedAt;
            if (interrupted) {
              result.code = 'RUN_INTERRUPTED';
              result.reason = 'Request was aborted after the user interrupted the run.';
            }
            if (result.httpStatus === 401 || result.httpStatus === 403 || result.httpStatus === 429) {
              stopReason = `Stopped after provider HTTP ${result.httpStatus}; remaining slots were not sent.`;
            }
          } finally {
            clearTimeout(timeout);
            if (activeRequestController === controller) activeRequestController = undefined;
          }
        }
        results.push(result);
        await writeJson(join(trialDirectory, 'observation.json'), result);
      }
    }
  } finally {
    dependencies.interruptionSignal?.removeEventListener('abort', onInterrupt);
  }

  return { results, requestCount };
}
