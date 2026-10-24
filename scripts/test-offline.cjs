const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'kora-offline-'));
const suites = fs.readdirSync(path.join(root, 'scripts')).filter(name => /^test-/.test(name) && name !== 'test-offline.cjs' && name !== 'test-deepseek.ts');
const env = { ...process.env, GEMINI_API_KEY: '', DEEPSEEK_KEY: '', DEEPSEEK_API_KEY: '' };
let failures = 0;
for (const suite of suites) {
  const args = suite.endsWith('.ts') ? ['-r', path.join(__dirname, 'register-typescript.cjs'), '-e', `require(${JSON.stringify(path.join(__dirname, suite))})`, '--'] : [path.join(__dirname, suite)];
  if (suite === 'test-baseline.ts') args.push('--out', path.join(output, 'baseline'));
  const run = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  const log = (run.stdout ?? '') + (run.stderr ?? '');
  fs.writeFileSync(path.join(output, `${suite}.log`), log);
  const passed = run.status === 0 && !/^\[FAIL\]/m.test(log);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${suite}`);
  if (!passed) { failures++; console.error(log.slice(-5000)); }
}
console.log(`${suites.length - failures}/${suites.length} offline suites passed. Logs: ${output}`);
process.exitCode = failures ? 1 : 0;
