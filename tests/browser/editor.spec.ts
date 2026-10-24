import { test, expect, Page } from '@playwright/test';

async function savedX(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('kora:diagram:v1');
    return raw ? JSON.parse(raw).presentation.nodes.s3?.x : undefined;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Acceptance Test (Sec 22)', exact: true }).click();
  await page.getByRole('button', { name: 'Generate Architecture', exact: true }).click();
  await expect(page.locator('.react-flow__node-aws-service')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Close prompt overlay', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
});

test('native browser autosave persists a drag without pressing Save', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const before = await savedX(page);
  const node = page.getByTestId('rf__node-s3');
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 20, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => savedX(page)).not.toBe(before);
  const saved = await savedX(page);
  await page.reload();
  await expect(node).toBeVisible();
  expect(await savedX(page)).toBe(saved);
  expect(errors).toEqual([]);
});

test('click selection and keyboard movement commit exactly one grid step', async ({ page }) => {
  const before = await savedX(page);
  const node = page.getByTestId('rf__node-s3');
  await node.click({ position: { x: 30, y: 20 } });
  await expect(node).toHaveClass(/selected/);
  await node.press('ArrowRight');
  await expect.poll(() => savedX(page)).toBe(before + 20);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect.poll(() => savedX(page)).toBe(before);
});

test('right drag pans on a cloud container without moving diagram nodes', async ({ page }) => {
  const cloud = (await page.getByTestId('rf__node-cloud-aws').boundingBox())!;
  const viewport = page.locator('.react-flow__viewport');
  const before = await viewport.getAttribute('style');
  const beforeX = await savedX(page);
  await page.mouse.move(cloud.x + 30, cloud.y + 50);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cloud.x + 90, cloud.y + 80, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await expect(viewport).not.toHaveAttribute('style', before!);
  expect(await savedX(page)).toBe(beforeX);
});

test('oversized import is rejected before replacing the current document', async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles({ name: 'oversized.json', mimeType: 'application/json', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 32) });
  await expect(page.getByText('File is too large. Import supports JSON files up to 10 MiB.', { exact: true })).toBeVisible();
  await expect(page.locator('.react-flow__node-aws-service')).toHaveCount(6);
});

test('production liveness, readiness, headers and provider gate stay distinct', async ({ page, request }) => {
  const home = await request.get('/');
  expect(home.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(home.headers()['x-content-type-options']).toBe('nosniff');
  expect((await request.get('/api/health')).status()).toBe(200);
  expect((await request.get('/api/ready')).status()).toBe(503);
  const blocked = await request.post('/api/parse-architecture', { data: { prompt: 'Must not reach a provider.' } });
  expect(blocked.status()).toBe(503);
  await page.getByRole('button', { name: 'Edit Prompt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'DeepSeek (V3)', exact: true })).toBeDisabled();
});

test('SVG and PNG exports remain usable under CSP', async ({ page }) => {
  for (const format of ['SVG', 'PNG 1×']) {
    await page.getByRole('button', { name: 'Export diagram', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: format, exact: true }).click();
    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(format === 'SVG' ? /\.svg$/ : /\.png$/);
    // Image exports keep the menu open; close it before choosing the next format.
    await page.getByRole('button', { name: 'Export diagram', exact: true }).click();
  }
});
