import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep, resolve } from 'node:path';
import { validateArchitectureModel } from '../../ir/validator';
import { EvaluationCase } from './corpus';
import { evaluateParserOutput } from './matcher';
import { LiveTrialResult } from './liveRunner';

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json(value), 'utf8');
}

function containsPath(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** Prevent replay outputs from being written into, over, or around the source artifact tree. */
export function assertReplayOutputIsolated(sourceDirectory: string, outputDirectory: string): void {
  if (containsPath(sourceDirectory, outputDirectory) || containsPath(outputDirectory, sourceDirectory)) {
    throw new Error('Replay input and output directories must be separate, non-overlapping paths.');
  }
}

export async function runReplayEvaluation(
  sourceDirectory: string,
  outputDirectory: string,
  cases: EvaluationCase[]
): Promise<LiveTrialResult[]> {
  const replayDirectory = resolve(sourceDirectory);
  const destination = resolve(outputDirectory);
  assertReplayOutputIsolated(replayDirectory, destination);
  const output: LiveTrialResult[] = [];
  const prior = JSON.parse(await readFile(join(replayDirectory, 'results.json'), 'utf8')) as { results?: LiveTrialResult[] };
  const sourceSlots: LiveTrialResult[] = Array.isArray(prior.results)
    ? prior.results
    : cases.flatMap(testCase => [1, 2, 3].map(trial => ({ caseId: testCase.id, trial, status: 'NOT_RUN' as const })));

  for (const source of sourceSlots) {
    const testCase = cases.find(item => item.id === source.caseId);
    if (!testCase) continue;
    const sourceTrialDirectory = join(replayDirectory, 'trials', testCase.id, `t${source.trial}`);
    const path = join(sourceTrialDirectory, 'parser-ir.json');
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
      const malformed = error instanceof SyntaxError;
      output.push({
        ...source,
        status: malformed ? 'INVALID_JSON' : missing ? source.status : 'HARNESS_ERROR',
        code: malformed ? 'REPLAY_INVALID_JSON' : missing ? source.code ?? 'REPLAY_ARTIFACT_MISSING' : 'REPLAY_READ_FAILED',
        reason: malformed ? 'Captured parser IR is not valid JSON.' : missing ? `Replay has no parser IR for this source outcome (${source.status}).` : 'Replay could not read a captured parser IR.'
      });
      continue;
    }

    const validation = validateArchitectureModel(raw);
    if (!validation.ok) {
      output.push({ ...source, status: 'INVALID_MODEL', code: 'REPLAY_INVALID_MODEL', reason: 'Captured parser IR failed current validation.' });
      continue;
    }

    const semantic = evaluateParserOutput(testCase, validation.value);
    const trialDirectory = join(destination, 'trials', testCase.id, `t${source.trial}`);
    await writeJson(join(trialDirectory, 'parser-ir.json'), validation.value);
    try {
      await writeJson(join(trialDirectory, 'issues.json'), JSON.parse(await readFile(join(sourceTrialDirectory, 'issues.json'), 'utf8')) as unknown);
    } catch { /* Older captures may not include the issue artifact. */ }
    output.push({ ...source, status: semantic.verdict, reason: 'Replay; no provider request was made.', semantic });
  }
  return output;
}
