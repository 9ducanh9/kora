import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { KoraArchitectureModel } from '../src/core/ir/types';
import { computeCompoundLayout } from '../src/core/layout/elkCompoundLayout';
import { renderDiagramSvg } from '../src/core/export/svg';

// Use the editor's layout and SVG exporter, without a provider request.
const stages = [
  ['describe', 'Describe', 'Natural language'],
  ['extract', 'Extract', 'DeepSeek'],
  ['validate', 'Validate', 'Schema + flows'],
  ['layout', 'Arrange', 'Assets + ELK'],
  ['edit', 'Edit & export', 'JSON / SVG / PNG']
];
const model: KoraArchitectureModel = {
  version: '1.0',
  scope: { type: 'custom', title: 'Kora generation workflow' },
  nodes: stages.map(([id, label, subtitle]) => ({ id, label, subtitle, kind: 'generic', assetId: 'generic.component' })),
  containers: [],
  connections: stages.slice(1).map(([id], i) => ({ id: `step-${i + 1}`, source: stages[i][0], target: id, relationship: 'data' }))
};

async function main() {
  const document = await computeCompoundLayout(model, { composition: 'layered', direction: 'RIGHT', layerSpacing: 60 });
  document.metadata.title = 'Kora generation workflow';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    if (!/^\/(assets|fonts)\//.test(path) || path.includes('..')) throw new Error('Only bundled diagram resources are allowed.');
    const bytes = await readFile(resolve('public', path.slice(1)));
    return new Response(bytes, { headers: { 'content-type': path.endsWith('.svg') ? 'image/svg+xml' : 'font/woff2' } });
  }) as typeof fetch;
  try {
    for (const theme of ['dark', 'light'] as const) {
      const exported = await renderDiagramSvg(document, { theme });
      await writeFile(`docs/images/kora-workflow-${theme}.svg`, await exported.blob.text());
    }
    await writeFile('docs/images/kora-workflow.json', JSON.stringify(document, null, 2) + '\n');
  } finally { globalThis.fetch = originalFetch; }
  console.log('Rendered workflow with Kora layout and SVG export.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
