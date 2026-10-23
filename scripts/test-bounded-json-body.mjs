import assert from 'node:assert/strict';
import { readBoundedJsonBody } from '../src/core/server/boundedJsonBody.ts';
import { reserveLocalGeneration } from '../src/core/server/localGenerationLimiter.ts';
import { isPublicGenerationLocked } from '../src/core/server/publicGenerationGate.ts';

const withinLimit = await readBoundedJsonBody(
  new Request('http://localhost/api', { method: 'POST', body: '{"prompt":"hello"}' }),
  64
);
assert.deepEqual(withinLimit, { ok: true, text: '{"prompt":"hello"}' });

const oversizedByHeader = await readBoundedJsonBody(
  new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-length': '65' },
    body: 'x'.repeat(65)
  }),
  64
);
assert.deepEqual(oversizedByHeader, { ok: false, reason: 'too-large' });

const oversizedByStream = await readBoundedJsonBody(
  new Request('http://localhost/api', { method: 'POST', body: 'x'.repeat(65) }),
  64
);
assert.deepEqual(oversizedByStream, { ok: false, reason: 'too-large' });

const invalidUtf8 = new Request('http://localhost/api', {
  method: 'POST',
  body: new Uint8Array([0xc3, 0x28])
});
assert.deepEqual(await readBoundedJsonBody(invalidUtf8, 64), { ok: false, reason: 'invalid-encoding' });

assert.equal(isPublicGenerationLocked('production'), true);
assert.equal(isPublicGenerationLocked('development'), false);
assert.equal(isPublicGenerationLocked('test'), false);

const policy = { maxRequests: 2, windowMs: 1_000, maxConcurrent: 1 };
const active = reserveLocalGeneration('test-concurrency', 0, policy);
assert.equal(active.allowed, true);
assert.deepEqual(reserveLocalGeneration('test-concurrency', 100, policy), {
  allowed: false,
  reason: 'concurrency',
  retryAfterSeconds: 1
});
if (active.allowed) active.release();

const second = reserveLocalGeneration('test-rate', 0, policy);
assert.equal(second.allowed, true);
if (second.allowed) second.release();
const third = reserveLocalGeneration('test-rate', 100, policy);
assert.equal(third.allowed, true);
if (third.allowed) third.release();
assert.deepEqual(reserveLocalGeneration('test-rate', 200, policy), {
  allowed: false,
  reason: 'rate',
  retryAfterSeconds: 1
});
const afterWindow = reserveLocalGeneration('test-rate', 1_000, policy);
assert.equal(afterWindow.allowed, true);
if (afterWindow.allowed) afterWindow.release();

const pendingAcrossWindow = reserveLocalGeneration('test-window-active', 0, policy);
assert.equal(pendingAcrossWindow.allowed, true);
assert.deepEqual(reserveLocalGeneration('test-window-active', 1_000, policy), {
  allowed: false,
  reason: 'concurrency',
  retryAfterSeconds: 1
});
if (pendingAcrossWindow.allowed) pendingAcrossWindow.release();
const afterRelease = reserveLocalGeneration('test-window-active', 1_001, policy);
assert.equal(afterRelease.allowed, true);
if (afterRelease.allowed) afterRelease.release();

console.log('Step 7 local request guards passed (15 cases).');
