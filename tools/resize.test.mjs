import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import { shrinkPhoto, MAX_EDGE } from './resize.mjs';

async function withTmp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'cts-resize-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const solid = (width, height, extra = {}) =>
  sharp({ create: { width, height, channels: 3, background: '#88aa44' } })
    .jpeg()
    .withMetadata(extra)
    .toBuffer();

test('downscales a large photo so the long edge is MAX_EDGE', async () => {
  await withTmp(async dir => {
    const p = join(dir, 'big.jpg');
    await writeFile(p, await solid(3000, 4000));
    const { before, after } = await shrinkPhoto(p);
    const meta = await sharp(await readFile(p)).metadata();
    assert.equal(meta.height, MAX_EDGE);
    assert.equal(meta.width, MAX_EDGE * 3 / 4);
    assert.ok(after < before);
  });
});

test('never enlarges a photo already under the limit', async () => {
  await withTmp(async dir => {
    const p = join(dir, 'small.jpg');
    await writeFile(p, await solid(640, 480));
    await shrinkPhoto(p);
    const meta = await sharp(await readFile(p)).metadata();
    assert.equal(meta.width, 640);
    assert.equal(meta.height, 480);
  });
});

test('applies EXIF orientation instead of dropping it', async () => {
  await withTmp(async dir => {
    const p = join(dir, 'rotated.jpg');
    // Stored landscape (2000×1000) with orientation 6 = "rotate 90° CW to view",
    // so it must come out portrait (1000×2000 → capped to 600×1200).
    await writeFile(p, await solid(2000, 1000, { orientation: 6 }));
    await shrinkPhoto(p);
    const meta = await sharp(await readFile(p)).metadata();
    assert.equal(meta.width, 600);
    assert.equal(meta.height, 1200);
    assert.ok(!meta.orientation || meta.orientation === 1);
  });
});

test('throws on a file that is not an image', async () => {
  await withTmp(async dir => {
    const p = join(dir, 'bad.jpg');
    await writeFile(p, 'not a jpeg');
    await assert.rejects(() => shrinkPhoto(p));
  });
});
