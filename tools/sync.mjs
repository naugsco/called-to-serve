#!/usr/bin/env node
// Sync job: emits web/public/missionaries.json + web/public/images/<slug>/*.{svg,jpg}.
//
// Modes:
//   - With GOOGLE_SA_JSON + SUBMISSIONS_SHEET_ID + ROSTER_SHEET_ID set, pulls real
//     data via sheets.mjs and downloads photos via photos.mjs.
//   - Otherwise falls back to sample-missionaries.json + generated SVG portraits.

import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portraitSvg } from './portrait.mjs';
import { readSubmissions, readRoster } from './sheets.mjs';
import { downloadPhoto } from './photos.mjs';
import { rankPhotosByFace } from './face.mjs';
import { decorateWithFlags } from './flags.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC_DIR = resolve(ROOT, 'web/public');
const OUT_JSON = resolve(PUBLIC_DIR, 'missionaries.json');
const IMAGES_DIR = resolve(PUBLIC_DIR, 'images');

// Lightweight .env loader so local dev doesn't require `export` gymnastics.
// Loads tools/.secrets/.env if present (gitignored). CI sets env directly.
const ENV_FILE = resolve(__dirname, '.secrets/.env');
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

const slugify = s => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const seedRaw = JSON.parse(await readFile(resolve(__dirname, 'missions-seed.json'), 'utf8'));
const extraRaw = JSON.parse(await readFile(resolve(__dirname, 'missions-extra.json'), 'utf8'));
const factsRaw = JSON.parse(await readFile(resolve(__dirname, 'mission-facts.json'), 'utf8'));

const allMissions = [...seedRaw.missions, ...(extraRaw.missions ?? [])];
for (const m of allMissions) m.slug = slugify(m.name);
const missionByName = new Map(allMissions.map(m => [m.name, m]));

// Live mode if EITHER auth-mode IDs are set OR published-CSV URLs are set.
// Auth options for the API mode are picked up automatically by google-auth.mjs
// (service-account key OR Application Default Credentials).
const HAS_API_IDS  = !!(process.env.SUBMISSIONS_SHEET_ID && process.env.ROSTER_SHEET_ID);
const HAS_CSV_URLS = !!(process.env.PUBLIC_SUBMISSIONS_CSV_URL && process.env.PUBLIC_ROSTER_CSV_URL);
const USE_REAL = HAS_API_IDS || HAS_CSV_URLS;
const sourceRows = USE_REAL ? await loadReal() : await loadSample();

async function loadSample() {
  const s = JSON.parse(await readFile(resolve(__dirname, 'sample-missionaries.json'), 'utf8'));
  return s.missionaries.map(r => ({
    name: r.name, mission: r.mission, permission: !!r.permission, bio: r.bio ?? null,
    sourcePhotos: r.permission && r.photoCount > 0
      ? Array.from({ length: r.photoCount }, (_, i) => ({ kind: 'svg', variant: i }))
      : [],
  }));
}

async function loadReal() {
  // Only call into Google auth if at least one reader path needs the API.
  // CSV-mode readers short-circuit before hitting client(), so going full-CSV
  // works with zero credentials.
  const apiNeeded = !process.env.PUBLIC_ROSTER_CSV_URL
                 || !process.env.PUBLIC_SUBMISSIONS_CSV_URL;
  let label = 'published CSV';
  if (apiNeeded) {
    const { getGoogleAuth, describeAuth } = await import('./google-auth.mjs');
    await getGoogleAuth();
    label = `Sheets API via ${describeAuth()}`;
  }
  console.log(`[sync] using live data (${label})`);
  const knownMissions = Array.from(missionByName.keys());
  const [roster, submissions] = await Promise.all([
    readRoster(knownMissions),
    readSubmissions(),
  ]);
  // Group submissions by normalized missionary name — parents may submit
  // multiple times, and each row may carry multiple Drive URLs.
  //
  // Parents often spell a name slightly differently than the roster —
  // hyphens, spacing, "Jin-Woo" vs "Jinwoo". The roster's "Jin-Woo Chun"
  // normalizes to "jin woo chun" but a submitted "Jinwoo Chun" normalizes to
  // "jinwoo chun", so the exact keys miss. We also index by a "tight" key
  // (spaces removed) and fall back to it when the exact key has no match —
  // but only for submissions that don't already match some other roster
  // entry exactly, so a fallback never steals another missionary's photos.
  const tighten = k => k.replace(/\s+/g, '');
  const subsByName = new Map();
  const subsByTight = new Map();
  const push = (map, key, val) => { (map.get(key) ?? map.set(key, []).get(key)).push(val); };
  for (const s of submissions) {
    const key = normalizeName(s.name);
    push(subsByName, key, s);
    push(subsByTight, tighten(key), s);
  }
  const rosterExactKeys = new Set(roster.map(r => normalizeName(r.name)));
  return roster.map(r => {
    const key = normalizeName(r.name);
    let subs = subsByName.get(key);
    if (!subs) {
      // Orphan submissions (no exact roster match) whose tight key matches.
      const cand = (subsByTight.get(tighten(key)) || [])
        .filter(s => !rosterExactKeys.has(normalizeName(s.name)));
      if (cand.length) {
        subs = cand;
        console.warn(`[sync] "${r.name}" matched submission "${cand[0].name}" by collapsed-spelling fallback — consider aligning the form spelling.`);
      }
    }
    subs = subs || [];
    const allowed = subs.filter(s => s.permission);
    const urls = allowed.flatMap(s => s.photoUrls);
    const bio = (subs.find(s => s.bio)?.bio) || null;
    return {
      name: r.name,
      mission: r.mission,
      raw: r.raw,
      permission: allowed.length > 0,
      bio,
      sourcePhotos: urls.map(u => ({ kind: 'drive', url: u })),
    };
  });
}

function normalizeName(s) {
  return (s || '').toLowerCase()
    .replace(/^(elder|sister)\s+/i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanHq(hq) {
  // Strip US state suffix like ", UT" so the city renders cleanly on the hex.
  return (hq || '').replace(/,\s*[A-Z]{2}\s*$/, '').trim();
}

const unmatched = [];
const missionaries = [];
for (const row of sourceRows) {
  if (!row.mission) {
    // Roster row that didn't parse — column A had no recognisable mission.
    unmatched.push({ raw: row.raw || row.name, why: 'no mission found in cell', name: row.name });
    continue;
  }
  const mission = missionByName.get(row.mission);
  if (!mission) { unmatched.push({ raw: row.raw || row.name, why: 'mission name not in seed/extra', name: row.name, mission: row.mission }); continue; }
  const slug = slugify(row.name);
  // `raw` is a diagnostic field on the source row; not part of the manifest.
  missionaries.push({
    slug,
    name: row.name,
    mission: row.mission,
    missionSlug: mission.slug,
    missionLat: mission.lat,
    missionLng: mission.lng,
    missionCountry: mission.country,
    missionCity: cleanHq(mission.hq),
    permission: !!row.permission,
    bio: row.bio ?? null,
    fact: factsRaw.facts?.[mission.slug] ?? null,
    _sourcePhotos: row.sourcePhotos,
    photos: [],
    bestPhoto: null,
  });
}

if (unmatched.length) {
  console.error(`\n[sync] ERROR: ${unmatched.length} roster row(s) couldn't be matched to a mission:\n`);
  for (const u of unmatched) {
    console.error(`  • ${u.raw}`);
    console.error(`      reason: ${u.why}`);
    if (u.mission) {
      console.error(`      add to tools/missions-extra.json:`);
      console.error(`        { "name": "${u.mission}", "hq": "City, REGION", "country": "Country", "lat": 0.0, "lng": 0.0 }`);
    }
  }
  console.error(`\nFix the master-sheet cells OR add the mission(s) above to tools/missions-extra.json (you'll need lat/lng — Google "<city name> coordinates" works).\n`);
  process.exit(1);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  source: USE_REAL ? 'live (sheets + drive)' : 'sample (no GOOGLE_SA_JSON)',
  origin: { lat: 49.2827, lng: -123.1207, label: 'Vancouver, BC' },
  missionaries,
};

if (dryRun) {
  console.log('[sync] dry-run.');
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}

await mkdir(PUBLIC_DIR, { recursive: true });
await rm(IMAGES_DIR, { recursive: true, force: true });
await mkdir(IMAGES_DIR, { recursive: true });

// Materialize photos. Sample sources write SVG portraits; Drive sources download.
for (const m of missionaries) {
  if (!m._sourcePhotos?.length) continue;
  const dir = resolve(IMAGES_DIR, m.slug);
  await mkdir(dir, { recursive: true });
  const local = [];
  for (let i = 0; i < m._sourcePhotos.length; i++) {
    const src = m._sourcePhotos[i];
    if (src.kind === 'svg') {
      const dest = resolve(dir, `${i + 1}.svg`);
      await writeFile(dest, portraitSvg(m.name, src.variant ?? i));
      local.push(`images/${m.slug}/${i + 1}.svg`);
    } else if (src.kind === 'drive') {
      try {
        const dest = resolve(dir, `${i + 1}.jpg`);
        await downloadPhoto(src.url, dest);
        local.push(`images/${m.slug}/${i + 1}.jpg`);
      } catch (err) {
        console.warn(`[sync] photo download failed for ${m.name}: ${err.message}`);
      }
    }
  }
  // Rank by "best face" so the cleanest solo portrait leads (becomes the main
  // hex image); the rest trail it and feed the gallery hex. Only JPEG (Drive)
  // photos are scored; SVG sample portraits keep their order.
  const jpgRel = local.filter(p => p.endsWith('.jpg'));
  if (jpgRel.length > 1) {
    const absToRel = new Map(jpgRel.map(rel => [resolve(PUBLIC_DIR, rel), rel]));
    const rankedAbs = await rankPhotosByFace([...absToRel.keys()]);
    const rankedRel = rankedAbs.map(abs => absToRel.get(abs));
    const others = local.filter(p => !p.endsWith('.jpg'));
    m.photos = [...rankedRel, ...others];
  } else {
    m.photos = local;
  }
  m.bestPhoto = m.photos[0] ?? null;
  delete m._sourcePhotos;
}
// Drop the underscored field from rows that had no photos.
for (const m of missionaries) delete m._sourcePhotos;

// Country flags: cached per country under web/public/flags/, never wiped.
// Adds countryCode + flag to each missionary; warns about any country we
// don't have an ISO code for yet.
const { missing, failed } = await decorateWithFlags(missionaries, PUBLIC_DIR);
if (missing.length) {
  console.warn(`\n[sync] WARN: no flag for ${missing.length} country/countries — add to tools/country-codes.json:`);
  for (const c of missing) console.warn(`  • "${c}": "xx"   (ISO 3166-1 alpha-2, lowercase)`);
  console.warn('');
}
if (failed.length) {
  console.warn(`[sync] WARN: flag download failed for: ${failed.join(', ')} (flagcdn unreachable?) — those tiles show no flag.\n`);
}

await writeFile(OUT_JSON, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[sync] wrote ${missionaries.length} missionaries to ${OUT_JSON}`);
