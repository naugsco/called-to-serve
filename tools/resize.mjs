// Photo downscaling for the sync pipeline.
//
// Parents submit raw phone photos (up to ~24 MP). The kiosk shows them at a few
// hundred CSS pixels, but a browser decodes the FULL image into memory — ~98 MB
// for a 4284×5712 photo. On a TV that exhausts RAM and locks the page, so every
// downloaded JPEG is shrunk in place before it ships.
//
// 1200 px on the long edge covers the largest use (the closeup card's square
// crop, ~650 device px on a 4K panel) with headroom, at ≤ ~8 MB decoded.
//
// Errors propagate: a photo we can't shrink must fail the sync loudly rather
// than ship a multi-megapixel image to the TV.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const MAX_EDGE = 1200;
const JPEG_QUALITY = 82;

// Shrink one JPEG in place. Applies the EXIF orientation first (sharp drops the
// tag on output, so an un-rotated pixel grid would show sideways), never
// enlarges. Returns { before, after } byte sizes.
export async function shrinkPhoto(absPath, { maxEdge = MAX_EDGE } = {}) {
  const input = await readFile(absPath);
  const output = await sharp(input)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  await writeFile(absPath, output);
  return { before: input.length, after: output.length };
}

// CLI: node tools/resize.mjs <file.jpg> [more.jpg ...]
// Shrinks already-downloaded photos (e.g. web/public/images/**) without a full sync.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node tools/resize.mjs <file.jpg> [more.jpg ...]');
    process.exit(1);
  }
  for (const f of files) {
    const { before, after } = await shrinkPhoto(f);
    console.log(`${f}: ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB`);
  }
}
