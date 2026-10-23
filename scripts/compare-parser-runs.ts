import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { compareEvaluationCohorts, EvaluationCohortIdentity } from '../src/core/ai/evaluation/comparison';

interface RunManifest extends EvaluationCohortIdentity {
  gate?: string;
  mode?: string;
  repetitions?: number;
  requestCount?: number;
}
interface Diff { code: string; path: string; }
interface Trial { caseId: string; trial: number; status: string; semantic?: { diffs: Diff[] }; durationMs?: number; }

function parseArgs(args: string[]): { baseline: string; candidate: string; out?: string } {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const token = args[index]; const value = args[index + 1];
    if (!token?.startsWith('--') || !value || value.startsWith('--')) throw new Error('Use --baseline <run> --candidate <run> [--out <directory>].');
    options.set(token.slice(2), value); index++;
  }
  if (!options.has('baseline') || !options.has('candidate')) throw new Error('Both --baseline and --candidate are required.');
  return { baseline: resolve(options.get('baseline')!), candidate: resolve(options.get('candidate')!), out: options.get('out') ? resolve(options.get('out')!) : undefined };
}

async function readRun(path: string): Promise<{ manifest: RunManifest; trials: Trial[] }> {
  const [manifestText, resultsText] = await Promise.all([
    readFile(join(path, 'manifest.json'), 'utf8'), readFile(join(path, 'results.json'), 'utf8')
  ]);
  const manifest = JSON.parse(manifestText) as RunManifest;
  const results = JSON.parse(resultsText) as { results?: Trial[] };
  if (!manifest.suiteVersion || !manifest.suiteSha256 || !manifest.matcherVersion || !manifest.provider || !manifest.requestedModel || !manifest.generationOptions) {
    throw new Error('A run is missing comparison identity metadata.');
  }
  if (!Array.isArray(results.results)) throw new Error('A run has no trial results.');
  return { manifest, trials: results.results };
}

async function main() {
  let args: ReturnType<typeof parseArgs>;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Invalid arguments.'}\n`); process.exitCode = 2; return; }
  const [baseline, candidate] = await Promise.all([readRun(args.baseline), readRun(args.candidate)]);
  const identity = compareEvaluationCohorts(baseline.manifest, candidate.manifest);
  const caseIds = [...new Set([...baseline.trials.map(item => item.caseId), ...candidate.trials.map(item => item.caseId)])].sort();
  const table = caseIds.map(caseId => {
    const before = baseline.trials.filter(item => item.caseId === caseId); const after = candidate.trials.filter(item => item.caseId === caseId);
    const beforePass = before.filter(item => item.status === 'PASS').length; const afterPass = after.filter(item => item.status === 'PASS').length;
    const critical = (baseline.manifest as RunManifest & { cases?: Array<{id:string;critical:boolean}> }).cases?.find(item => item.id === caseId)?.critical ?? false;
    const beforeDiffs = before.flatMap(item => item.semantic?.diffs ?? []); const afterDiffs = after.flatMap(item => item.semantic?.diffs ?? []);
    const signature = (item: Diff) => `${item.code}\t${item.path}`;
    const beforeSet = new Set(beforeDiffs.map(signature)); const afterSet = new Set(afterDiffs.map(signature));
    const newViolations = [...afterSet].filter(item => !beforeSet.has(item) && /FORBIDDEN_|MEMBERSHIP_MISMATCH|PARENT_MISMATCH/u.test(item));
    return { caseId, critical, baseline: { scheduled: before.length, passes: beforePass }, candidate: { scheduled: after.length, passes: afterPass }, delta: afterPass - beforePass, regression: afterPass < beforePass || (critical && beforePass === 3 && afterPass < 3), newViolations };
  });
  const comparable = identity.comparable;
  const strictPasses = (items: Trial[]) => items.filter(item => item.status === 'PASS').length;
  const regression = comparable && table.some(row => row.regression || row.newViolations.length > 0);
  const comparison = {
    comparable,
    cohortDifferences: identity.differences,
    variableDifferences: identity.variableDifferences,
    baseline: { directory: args.baseline, strictPasses: strictPasses(baseline.trials), results: baseline.trials.length },
    candidate: { directory: args.candidate, strictPasses: strictPasses(candidate.trials), results: candidate.trials.length },
    regression, cases: table
  };
  const report = [
    '# Parser run comparison', '',
    `- Comparable cohort: ${comparable ? 'yes' : 'no'}.`,
    `- Cohort differences: ${identity.differences.length ? identity.differences.join(', ') : 'none'}.`,
    `- Candidate variables: ${identity.variableDifferences.length ? identity.variableDifferences.join(', ') : 'none'}.`,
    `- Strict passes: ${comparison.baseline.strictPasses}/${comparison.baseline.results} → ${comparison.candidate.strictPasses}/${comparison.candidate.results}.`,
    `- Regression detected: ${comparable ? (regression ? 'yes' : 'no') : 'not evaluated because cohorts differ'}.`,
    '', '| Case | Critical | Baseline | Candidate | Delta | Regression | New placement/forbidden diffs |', '| --- | --- | ---: | ---: | ---: | --- | ---: |',
    ...table.map(row => `| ${row.caseId} | ${row.critical ? 'yes' : 'no'} | ${row.baseline.passes}/${row.baseline.scheduled} | ${row.candidate.passes}/${row.candidate.scheduled} | ${row.delta > 0 ? '+' : ''}${row.delta} | ${row.regression ? 'yes' : 'no'} | ${row.newViolations.length} |`), ''
  ].join('\n');
  const directory = args.out ?? resolve('docs/evaluations', `${new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z/u, 'Z')}-comparison`);
  await mkdir(dirname(directory), { recursive: true }); await mkdir(directory, { recursive: false });
  await writeFile(join(directory, 'comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
  await writeFile(join(directory, 'report.md'), report, 'utf8');
  process.stdout.write(`${report}\nArtifacts: ${directory}\n`);
  process.exitCode = !comparable ? 2 : regression ? 1 : 0;
}

void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Comparison failed.'}\n`); process.exitCode = 2; });
