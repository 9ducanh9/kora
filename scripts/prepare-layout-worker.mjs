import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const target = new URL('../public/vendor/', import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(require.resolve('elkjs/lib/elk-worker.min.js'), new URL('elk-worker.min.js', target));
await copyFile(require.resolve('elkjs/LICENSE.md'), new URL('elkjs-LICENSE.md', target));
