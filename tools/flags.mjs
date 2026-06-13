// Flag backend — looks up a mission's country flag, caches it once per
// country under web/public/flags/<code>.svg, and stamps `countryCode` +
// `flag` onto each missionary in the manifest.
//
// Cache-by-country: a flag is downloaded once per ISO code and reused for
// every missionary in that country and across runs. When a missionary is
// added whose country we've never seen, decorateWithFlags downloads it
// automatically (and warns loudly if the country name isn't in
// country-codes.json yet).
//
// We store the RAW flag SVG (self-contained, no runtime network). The hex
// SHAPE is applied by the tile at render time via clip-path + object-fit:
// cover — exactly how photos are rendered — so the flag keeps its aspect
// ratio and never stretches. (Embedding the flag inside a hex-clipped SVG
// via a nested <image> looked fine in some renderers and stretched in
// others; clip-path on a plain <img> is rock-solid.)

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CODES = JSON.parse(readFileSync(resolve(__dirname, 'country-codes.json'), 'utf8'));

export function countryCode(countryName) {
  if (!countryName) return null;
  return CODES[countryName] ?? CODES[countryName.trim()] ?? null;
}

// Ensure web/public/flags/<code>.svg exists; download it if not.
// Returns the public-relative path.
async function ensureFlagHex(code, flagsDir, { log = console } = {}) {
  const outPath = resolve(flagsDir, `${code}.svg`);
  const rel = `flags/${code}.svg`;
  if (existsSync(outPath)) return rel;

  const url = `https://flagcdn.com/${code}.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`flag download for "${code}" failed: HTTP ${res.status}`);
  const flagSvg = await res.text();
  await mkdir(flagsDir, { recursive: true });
  await writeFile(outPath, flagSvg);
  log.log?.(`[flags] fetched ${rel}`);
  return rel;
}

// Stamp countryCode + flag onto each missionary; download any new country's
// flag. Returns { missing, failed }:
//   missing — country names with no ISO code mapping yet (add to JSON)
//   failed  — codes whose flag download failed (e.g. flagcdn unreachable)
// Download failures are non-fatal: that missionary just gets flag=null, so a
// flagcdn hiccup never breaks the whole sync/deploy. Committed flags are
// reused from cache (existsSync) and skip the network entirely.
export async function decorateWithFlags(missionaries, publicDir, { log = console } = {}) {
  const flagsDir = resolve(publicDir, 'flags');
  const missing = new Set();
  const failed = new Set();
  const cache = new Map(); // code -> rel path | null (one resolve per code)

  for (const m of missionaries) {
    const code = countryCode(m.missionCountry);
    if (!code) {
      if (m.missionCountry) missing.add(m.missionCountry);
      m.countryCode = null;
      m.flag = null;
      continue;
    }
    m.countryCode = code;
    if (!cache.has(code)) {
      try {
        cache.set(code, await ensureFlagHex(code, flagsDir, { log }));
      } catch (err) {
        log.warn?.(`[flags] ${code}: ${err.message}`);
        failed.add(code);
        cache.set(code, null);
      }
    }
    m.flag = cache.get(code);
  }

  return { missing: [...missing], failed: [...failed] };
}
