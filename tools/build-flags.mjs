#!/usr/bin/env node
// Standalone flag populator — reads the existing web/public/missionaries.json,
// builds/caches a hex flag for every country present, and writes the
// countryCode + flag fields back in. Useful between full syncs (no Google
// auth needed). The full sync runs the same step automatically.
//
//   node tools/build-flags.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decorateWithFlags } from './flags.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '../web/public');
const OUT = resolve(PUBLIC_DIR, 'missionaries.json');

const manifest = JSON.parse(await readFile(OUT, 'utf8'));
const { missing, failed } = await decorateWithFlags(manifest.missionaries, PUBLIC_DIR);

if (missing.length) {
  console.warn(`\n[build-flags] no ISO code for: ${missing.join(', ')}`);
  console.warn('Add to tools/country-codes.json, then re-run.\n');
}
if (failed.length) {
  console.warn(`[build-flags] download failed for: ${failed.join(', ')} (flagcdn unreachable?)\n`);
}

await writeFile(OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[build-flags] stamped flags onto ${manifest.missionaries.length} missionaries`);
