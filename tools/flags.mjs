// Flag backend — turns a mission's country into a cached, hexagon-shaped
// flag SVG under web/public/flags/<code>.svg, and stamps `countryCode` +
// `flag` onto each missionary in the manifest.
//
// Cache-by-country: a flag is downloaded once per ISO code and reused for
// every missionary in that country and across runs. When a missionary is
// added whose country we've never seen, decorateWithFlags downloads and
// builds the new hex flag automatically (and warns loudly if the country
// name isn't in country-codes.json yet).
//
// The asset is a self-contained SVG: the real flag (fetched from flagcdn)
// is embedded as a base64 data-URI and clipped to the pointy-top hexagon,
// so it needs no network at runtime and drops straight into a hex tile.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CODES = JSON.parse(readFileSync(resolve(__dirname, 'country-codes.json'), 'utf8'));

// Pointy-top hex geometry — must match web/src/hex.js (VBW=100).
const VBW = 100;
const VBH = 200 / Math.sqrt(3); // ≈115.470
const HEX_POINTS = [
  [50, 0], [100, VBH * 0.25], [100, VBH * 0.75],
  [50, VBH], [0, VBH * 0.75], [0, VBH * 0.25],
].map(p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(' ');

export function countryCode(countryName) {
  if (!countryName) return null;
  return CODES[countryName] ?? CODES[countryName.trim()] ?? null;
}

// Build the hex-clipped, self-contained SVG for one flag.
function hexFlagSvg(flagSvgText) {
  const b64 = Buffer.from(flagSvgText, 'utf8').toString('base64');
  // `slice` covers the hex (flags are wider than the tall hex, so the centre
  // band shows — which is where most flags carry their emblem).
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VBW} ${VBH.toFixed(3)}">`,
    `<defs><clipPath id="hx"><polygon points="${HEX_POINTS}"/></clipPath></defs>`,
    `<image clip-path="url(#hx)" x="0" y="0" width="${VBW}" height="${VBH.toFixed(3)}"`,
    ` preserveAspectRatio="xMidYMid slice"`,
    ` href="data:image/svg+xml;base64,${b64}"/>`,
    `</svg>`,
  ].join('');
}

// Ensure web/public/flags/<code>.svg exists; download + build it if not.
// Returns the public-relative path, or null if the code couldn't be resolved.
async function ensureFlagHex(code, flagsDir, { log = console } = {}) {
  const outPath = resolve(flagsDir, `${code}.svg`);
  const rel = `flags/${code}.svg`;
  if (existsSync(outPath)) return rel;

  const url = `https://flagcdn.com/${code}.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`flag download for "${code}" failed: HTTP ${res.status}`);
  const flagSvg = await res.text();
  await mkdir(flagsDir, { recursive: true });
  await writeFile(outPath, hexFlagSvg(flagSvg));
  log.log?.(`[flags] built ${rel}`);
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
