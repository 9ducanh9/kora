import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DeepSeekArchitectureParser } from '../src/core/ai/providers/deepseek.parser';
import { KORA_SYSTEM_PROMPT } from '../src/core/ai/systemPrompt';
import { PARSER_EVALUATION_CASES, PARSER_EVALUATION_SUITE_VERSION, EvaluationCase } from '../src/core/ai/evaluation/corpus';
import { PARSER_MATCHER_VERSION } from '../src/core/ai/evaluation/matcher';
import { LiveTrialResult as TrialResult, runLiveEvaluation } from '../src/core/ai/evaluation/liveRunner';
import { assertReplayOutputIsolated, runReplayEvaluation } from '../src/core/ai/evaluation/replayRunner';

type Mode = 'offline' | 'replay' | 'live';
type Gate = 'harness' | 'baseline' | 'quality';
interface Args { mode: Mode; gate: Gate; provider: 'deepseek'; repetitions: number; maxRequests: number; timeoutMs: number; out?: string; input?: string; }

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
    values.set(name, value); index++;
  }
  const mode = (values.get('mode') ?? 'offline') as Mode;
  const gate = (values.get('gate') ?? (mode === 'live' ? 'baseline' : 'harness')) as Gate;
  if (!['offline','replay','live'].includes(mode) || !['harness','baseline','quality'].includes(gate)) throw new Error('Use --mode offline|replay|live and --gate harness|baseline|quality.');
  if (mode !== 'live' && gate !== 'harness') throw new Error('Only live mode supports baseline or quality gates.');
  const numeric = (key: string, fallback: number) => {
    const value = values.get(key);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${key} must be a positive integer.`);
    return parsed;
  };
  const repetitions = numeric('repetitions', 3);
  const maxRequests = numeric('max-requests', 48);
  if (repetitions > 3 || maxRequests > 48) throw new Error('Step 5 live limits are 3 repetitions and 48 requests.');
  const provider = values.get('provider') ?? 'deepseek';
  if (provider !== 'deepseek') throw new Error('Step 5 currently supports only the explicit deepseek provider.');
  if (mode === 'live' && !values.has('provider')) throw new Error('Live mode requires an explicit --provider deepseek.');
  if (mode === 'live' && !values.has('max-requests')) throw new Error('Live mode requires an explicit --max-requests budget.');
  if (mode === 'replay' && !(values.has('input') || values.has('replay'))) throw new Error('Replay mode requires --input <run-directory>.');
  if (mode === 'live' && (gate === 'baseline' || gate === 'quality') && repetitions !== 3) throw new Error('A baseline or quality run requires --repetitions 3.');
  return { mode, gate, provider: 'deepseek', repetitions, maxRequests, timeoutMs: numeric('timeout-ms', 90_000), out: values.get('out'), input: values.get('input') ?? values.get('replay') };
}

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const runId = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}-${value.hour}${value.minute}${value.second}`;
};

async function materializeCases(): Promise<EvaluationCase[]> {
  return Promise.all(PARSER_EVALUATION_CASES.map(async item => ({
    ...item,
    prompt: item.promptFile ? await readFile(resolve(process.cwd(), item.promptFile), 'utf8') : item.prompt
  })));
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json(value), 'utf8');
}

function summarize(cases: EvaluationCase[], results: TrialResult[]) {
  const outcomes = Object.fromEntries(['NOT_RUN','PROVIDER_ERROR','TIMEOUT','INVALID_JSON','EMPTY_OUTPUT','INVALID_MODEL','SEMANTIC_FAIL','PASS','HARNESS_ERROR'].map(status => [status, results.filter(result => result.status === status).length]));
  const caseSummary = cases.map(testCase => {
    const rows = results.filter(result => result.caseId === testCase.id);
    const passes = rows.filter(result => result.status === 'PASS').length;
    return { caseId: testCase.id, title: testCase.title, critical: testCase.critical, scheduled: rows.length, passes, passRate: rows.length ? passes / rows.length : null, statuses: rows.map(row => row.status) };
  });
  const completedSlots = results.filter(result => result.status !== 'NOT_RUN').length;
  const validOutputs = results.filter(result => ['PASS','SEMANTIC_FAIL'].includes(result.status)).length;
  const allCriticalPass = cases.filter(testCase => testCase.critical).every(testCase => {
    const rows = results.filter(result => result.caseId === testCase.id);
    return rows.length === 3 && rows.every(row => row.status === 'PASS');
  });
  const allCaseMinimums = caseSummary.every(row => row.scheduled === 3 && row.passes >= 2);
  const strictPasses = results.filter(result => result.status === 'PASS').length;
  const scheduled = results.length;
  const baselineComplete = scheduled === 48 && completedSlots === 48 && results.every(result => result.requestSent && ['PASS','SEMANTIC_FAIL','INVALID_JSON','EMPTY_OUTPUT','INVALID_MODEL'].includes(result.status));
  const rateMetrics = (key: 'nodes' | 'containers' | 'topology' | 'connections') => {
    const valid = results.filter(row => row.semantic && row.semantic.verdict !== 'HARNESS_ERROR');
    const counts = valid.map(row => row.semantic![key]);
    const tp = counts.reduce((sum, item) => sum + item.tp, 0); const fp = counts.reduce((sum, item) => sum + item.fp, 0); const fn = counts.reduce((sum, item) => sum + item.fn, 0);
    const macroRates = (field: 'precision' | 'recall') => {
      const byCase = cases.map(testCase => {
        const rows = valid.filter(row => row.caseId === testCase.id).map(row => row.semantic![key]);
        const a = rows.reduce((sum, item) => sum + item.tp, 0); const b = rows.reduce((sum, item) => sum + item.fp, 0); const c = rows.reduce((sum, item) => sum + item.fn, 0);
        return field === 'precision' ? (a + b ? a / (a + b) : null) : (a + c ? a / (a + c) : null);
      }).filter((value): value is number => value !== null);
      return { value: byCase.length ? byCase.reduce((sum, value) => sum + value, 0) / byCase.length : null, applicableCases: byCase.length };
    };
    return { micro: { tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null }, macroPrecision: macroRates('precision'), macroRecall: macroRates('recall') };
  };
  const observedDurations = results.filter(result => result.httpStatus !== undefined && result.durationMs !== undefined).map(result => result.durationMs!).sort((a, b) => a - b);
  const percentile = (fraction: number) => observedDurations.length ? observedDurations[Math.ceil(observedDurations.length * fraction) - 1] : null;
  const fieldAccuracy = Object.fromEntries(['asset','kind','customLabel','membership','containerType','containerLabel','parent','edgeLabel','relationship','scope'].map(field => {
    const values = results.flatMap(row => row.semantic?.fields[field] && row.semantic.fields[field].total > 0 ? [row.semantic.fields[field]] : []);
    const correct = values.reduce((sum, value) => sum + value.correct, 0); const total = values.reduce((sum, value) => sum + value.total, 0);
    return [field, { correct, total, accuracy: total ? correct / total : null }];
  }));
  const placementDiffs = results.flatMap(row => row.semantic?.diffs.filter(diff => ['NODE_MEMBERSHIP_MISMATCH','CONTAINER_PARENT_MISMATCH'].includes(diff.code)) ?? []);
  const forbiddenDiffs = results.flatMap(row => row.semantic?.diffs.filter(diff => diff.code.startsWith('FORBIDDEN_')) ?? []);
  return {
    outcomes, caseSummary, scheduled, completedSlots, attemptedRequests: results.filter(result => result.requestSent).length, baselineComplete,
    validOutputs, strictPasses, allCriticalPass, allCaseMinimums, fieldAccuracy,
    rates: { nodes: rateMetrics('nodes'), containers: rateMetrics('containers'), topology: rateMetrics('topology'), connections: rateMetrics('connections') },
    placementViolations: placementDiffs.length, forbiddenAdditions: forbiddenDiffs.length,
    latency: { responseCount: observedDurations.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95) }
  };
}

function buildReport(args: Args, cases: EvaluationCase[], results: TrialResult[], summary: ReturnType<typeof summarize>) {
  const lines = [
    '# Parser evaluation', '',
    `- Mode: ${args.mode}; gate: ${args.gate}; provider: ${args.provider}.`,
    `- Suite: ${PARSER_EVALUATION_SUITE_VERSION}; scheduled slots: ${summary.scheduled}; requests sent: ${summary.attemptedRequests}.`,
    `- Outcomes: ${Object.entries(summary.outcomes).map(([key, value]) => `${key}=${value}`).join(', ')}.`,
    `- Baseline coverage: ${summary.baselineComplete ? 'COMPLETE' : 'INCOMPLETE'}; strict passes: ${summary.strictPasses}/${summary.scheduled}; valid outputs: ${summary.validOutputs}/${summary.scheduled}.`,
    `- Quality target: ${summary.baselineComplete && summary.validOutputs === 48 && summary.strictPasses >= 44 && summary.allCriticalPass && summary.allCaseMinimums && summary.forbiddenAdditions === 0 && summary.placementViolations === 0 ? 'PASS' : 'FAIL/INCOMPLETE'}.`,
    `- Latency for provider responses: n=${summary.latency.responseCount}, p50=${summary.latency.p50Ms ?? 'N/A'} ms, p95=${summary.latency.p95Ms ?? 'N/A'} ms.`,
    `- Node rates: micro P=${summary.rates.nodes.micro.precision ?? 'N/A'}, R=${summary.rates.nodes.micro.recall ?? 'N/A'}; macro P=${summary.rates.nodes.macroPrecision.value ?? 'N/A'} (${summary.rates.nodes.macroPrecision.applicableCases} cases), R=${summary.rates.nodes.macroRecall.value ?? 'N/A'}.`,
    `- Directed topology rates: micro P=${summary.rates.topology.micro.precision ?? 'N/A'}, R=${summary.rates.topology.micro.recall ?? 'N/A'}; labeled-edge rates: micro P=${summary.rates.connections.micro.precision ?? 'N/A'}, R=${summary.rates.connections.micro.recall ?? 'N/A'}.`,
    `- Field accuracy: ${Object.entries(summary.fieldAccuracy).map(([field, metric]) => `${field}=${metric.accuracy === null ? 'N/A' : `${metric.accuracy.toFixed(3)} (${metric.correct}/${metric.total})`}`).join('; ')}.`,
    `- Placement violations: ${summary.placementViolations}; forbidden additions: ${summary.forbiddenAdditions}.`,
    '- Raw provider output is intentionally not retained; valid live or replay trials retain validated parser IR and safe observations when available.',
    '', '| Case | Critical | Passes | Scheduled | Outcomes |', '| --- | --- | ---: | ---: | --- |',
    ...summary.caseSummary.map(row => `| ${row.caseId} ${row.title} | ${row.critical ? 'yes' : 'no'} | ${row.passes} | ${row.scheduled} | ${row.statuses.join(', ')} |`),
    '', 'Semantic diffs are stored per trial in `semantic-diff.json`. Provider exceptions and credentials are not written to artifacts.', ''
  ];
  return lines.join('\n');
}

async function main() {
  const runStartedAt = new Date();
  let args: Args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Invalid arguments.'}\n`); process.exitCode = 2; return; }
  const cases = await materializeCases();
  const directory = args.out ? resolve(args.out) : resolve('docs/evaluations', `${runId(runStartedAt)}-${args.mode}`);
  if (args.mode === 'replay') assertReplayOutputIsolated(resolve(args.input!), directory);
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
  let requestCount = 0;
  let sourceRun: unknown;
  let results: TrialResult[];
  if (args.mode === 'live') {
    const interruptController = new AbortController();
    const onInterrupt = () => interruptController.abort(new DOMException('Interrupted by user.', 'AbortError'));
    process.on('SIGINT', onInterrupt);
    try {
      const live = await runLiveEvaluation(
        { repetitions: args.repetitions, maxRequests: args.maxRequests, timeoutMs: args.timeoutMs },
        cases,
        directory,
        {
          parser: new DeepSeekArchitectureParser(),
          hasCredential: Boolean(process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY),
          requestedModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          interruptionSignal: interruptController.signal
        }
      );
      results = live.results;
      requestCount = live.requestCount;
    } finally { process.off('SIGINT', onInterrupt); }
  } else if (args.mode === 'replay') {
    sourceRun = JSON.parse(await readFile(join(resolve(args.input!), 'manifest.json'), 'utf8')) as unknown;
    results = await runReplayEvaluation(resolve(args.input!), directory, cases);
  } else {
    results = cases.flatMap(testCase => Array.from({ length: args.repetitions }, (_, index): TrialResult => ({
      caseId: testCase.id, trial: index + 1, status: 'NOT_RUN', requestedModel: 'not-requested',
      reason: 'Offline mode builds the schedule and performs no provider request.'
    })));
  }
  const summary = summarize(cases, results);
  const sourcePaths = [
    'package.json','tsconfig.json','scripts/evaluate-parser.ts','scripts/compare-parser-runs.ts','scripts/test-parser-evaluation.ts',
    'src/core/ai/evaluation/corpus.ts','src/core/ai/evaluation/matcher.ts','src/core/ai/evaluation/comparison.ts','src/core/ai/evaluation/liveRunner.ts','src/core/ai/evaluation/replayRunner.ts',
    'src/core/ai/parser.interface.ts','src/core/ai/providers/deepseek.parser.ts','src/core/ai/systemPrompt.ts',
    'src/core/ir/types.ts','src/core/ir/schema.ts','src/core/ir/validator.ts',
    'docs/specs/step-1-v1-baseline.md',
    'tests/fixtures/parser-evaluation/P02-branching.prompt.txt','tests/fixtures/parser-evaluation/P03-two-backends.prompt.txt',
    'tests/fixtures/parser-evaluation/P14-two-backends-reordered.prompt.txt','tests/fixtures/parser-evaluation/P15-servicegremlin.prompt.txt',
    'tests/fixtures/servicegremlin.prompt.txt'
  ];
  const sourceHashes: Record<string, string> = {};
  for (const path of sourcePaths) sourceHashes[path] = sha256(await readFile(resolve(path)));
  const suiteSnapshot = cases.map(({ id, prompt, context, critical, expected, strictNodeLabels, nodeAliases, interchangeableNodeRoles, assertions, forbiddenAssets, forbiddenNodeLabels }) => ({ id, prompt, context, critical, expected, strictNodeLabels, nodeAliases, interchangeableNodeRoles, assertions, forbiddenAssets, forbiddenNodeLabels }));
  const caseHashes = cases.map(testCase => ({ id: testCase.id, promptSha256: sha256(testCase.prompt), contextSha256: sha256(json(testCase.context ?? null)), oracleSha256: sha256(json({ expected: testCase.expected, assertions: testCase.assertions, strictNodeLabels: testCase.strictNodeLabels, nodeAliases: testCase.nodeAliases, interchangeableNodeRoles: testCase.interchangeableNodeRoles, forbiddenAssets: testCase.forbiddenAssets, forbiddenNodeLabels: testCase.forbiddenNodeLabels })) }));
  await writeJson(join(directory, 'environment.json'), { startedAt: runStartedAt.toISOString(), timezone: 'Asia/Saigon', node: process.version, sourceIdentity: 'NO_GIT', sourceHashes });
  await writeJson(join(directory, 'manifest.json'), {
    mode: args.mode, provider: args.provider, gate: args.gate, suiteVersion: PARSER_EVALUATION_SUITE_VERSION,
    requestedModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat', temperature: 0.1, repetitions: args.repetitions,
    requestBudget: args.maxRequests, requestCount,
    timeoutMs: args.timeoutMs, automaticRetries: false, systemPromptSha256: sha256(KORA_SYSTEM_PROMPT),
    matcherVersion: PARSER_MATCHER_VERSION, generationOptions: { temperature: 0.1, responseFormat: 'json_object', concurrency: 1 },
    suiteSha256: sha256(json(suiteSnapshot)), caseHashes, cases: suiteSnapshot,
    ...(args.mode === 'replay' ? { sourceRun: { directory: args.input, manifest: sourceRun } } : {})
  });
  for (const result of results) {
    const trialDirectory = join(directory, 'trials', result.caseId, `t${result.trial}`);
    await writeJson(join(trialDirectory, 'observation.json'), { ...result, rawOutputCapture: 'not-enabled; provider response bodies are intentionally not retained' });
    if (!result.semantic) await writeFile(join(trialDirectory, 'provider-output.txt'), 'No semantic output was captured for this trial. Raw provider response bodies are intentionally not retained.\n', 'utf8');
    if (result.semantic) await writeJson(join(trialDirectory, 'semantic-diff.json'), result.semantic);
  }
  await writeJson(join(directory, 'results.json'), { provenance: args.mode === 'replay' ? { kind: 'replay', sourceDirectory: args.input } : { kind: args.mode }, results, summary });
  const report = buildReport(args, cases, results, summary);
  await writeFile(join(directory, 'report.md'), report, 'utf8');
  await writeFile(join(directory, 'issues.md'), results.filter(result => result.status !== 'PASS').map(result => `## ${result.caseId} trial ${result.trial}\n\n${result.status}: ${result.code ?? ''} ${result.reason ?? ''}\n\n${result.semantic?.diffs.map(diff => `- ${diff.code} at ${diff.path}`).join('\n') ?? ''}\n`).join('\n') || 'No issues recorded.\n', 'utf8');
  process.stdout.write(`${report}\nArtifacts: ${directory}\n`);
  if (args.mode === 'offline') process.exitCode = 0;
  else if (args.mode === 'replay') process.exitCode = results.some(result => result.status === 'HARNESS_ERROR') ? 2 : results.some(result => result.status === 'NOT_RUN') ? 2 : results.some(result => result.status !== 'PASS') ? 1 : 0;
  else if (args.gate === 'harness') process.exitCode = results.some(result => result.status === 'HARNESS_ERROR') ? 2 : 0;
  else if (!summary.baselineComplete) process.exitCode = 2;
  else if (args.gate === 'quality' && !(summary.validOutputs === 48 && summary.strictPasses >= 44 && summary.allCriticalPass && summary.allCaseMinimums && summary.forbiddenAdditions === 0 && summary.placementViolations === 0)) process.exitCode = 1;
  else process.exitCode = 0;
}

void main();
