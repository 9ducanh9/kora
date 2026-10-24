// Typechecking runs separately. This loader keeps offline suites usable on
// machines where the native esbuild runner is unavailable.
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(
  fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', "require('node:url').pathToFileURL(__filename).href"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }
).outputText, file);
