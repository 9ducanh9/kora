import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'docs/audits/20261019-deployment');
const paths = [];
async function collect(directory) {
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (file === 'public/vendor') continue; // Recreated from the locked elkjs package by prebuild.
    if (entry.isDirectory()) await collect(file);
    else paths.push(file);
  }
}
await collect('src');
await collect('public');
paths.push('package.json', 'package-lock.json', 'next.config.mjs', 'tsconfig.json', 'next-env.d.ts',
  'eslint.config.mjs', 'scripts/prepare-layout-worker.mjs', 'tests/fixtures/mock.parser.ts', '.vercelignore');
paths.sort();
const files = [];
const manifest = [];
for (const file of paths) {
  const absolute = resolve(root, file);
  if (relative(root, absolute).split(sep).includes('..')) throw new Error('Invalid deployment path');
  const content = await readFile(absolute);
  const binary = file.endsWith('.woff2');
  files.push({ file, data: content.toString(binary ? 'base64' : 'utf8'), ...(binary ? { encoding: 'base64' } : {}) });
  manifest.push({ file, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
}
await mkdir(output, { recursive: true });
let packet = [], packetSize = 0, count = 0;
async function flush() {
  if (!packet.length) return;
  await writeFile(resolve(output, `source-packet-${count++}.json`), JSON.stringify(packet));
  packet = []; packetSize = 0;
}
for (const file of files) {
  const size = JSON.stringify(file).length;
  if (packetSize + size > 80_000) await flush();
  packet.push(file); packetSize += size;
}
await flush();
const snapshot = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
await writeFile(resolve(output, 'source-manifest.json'), JSON.stringify({ snapshot, files: manifest }, null, 2));
console.log(JSON.stringify({ snapshot, files: files.length, packets: count, bytes: manifest.reduce((sum, file) => sum + file.bytes, 0) }));
