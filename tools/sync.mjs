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
import { downloadPhoto, selectBestPhoto } from './photos.mjs';

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

const USE_REAL = process.env.GOOGLE_SA_JSON && process.env.SUBMISSIONS_SHEET_ID && process.env.ROSTER_SHEET_ID;
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
  console.log('[sync] using live Google Sheets + Drive');
  const knownMissions = Array.from(missionByName.keys());
  const [roster, submissions] = await Promise.all([
    readRoster(knownMissions),
    readSubmissions(),
  ]);
  // Group submissions by normalized missionary name — parents may submit
  // multiple times, and each row may carry multiple Drive URLs.
  const subsByName = new Map();
  for (const s of submissions) {
    const key = normalizeName(s.name);
    if (!subsByName.has(key)) subsByName.set(key, []);
    subsByName.get(key).push(s);
  }
  return roster.map(r => {
    const subs = subsByName.get(normalizeName(r.name)) || [];
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
      local.push(`/images/${m.slug}/${i + 1}.svg`);
    } else if (src.kind === 'drive') {
      try {
        const dest = resolve(dir, `${i + 1}.jpg`);
        await downloadPhoto(src.url, dest);
        local.push(`/images/${m.slug}/${i + 1}.jpg`);
      } catch (err) {
        console.warn(`[sync] photo download failed for ${m.name}: ${err.message}`);
      }
    }
  }
  m.photos = local;
  m.bestPhoto = selectBestPhoto(local);
  delete m._sourcePhotos;
}
// Drop the underscored field from rows that had no photos.
for (const m of missionaries) delete m._sourcePhotos;

await writeFile(OUT_JSON, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[sync] wrote ${missionaries.length} missionaries to ${OUT_JSON}`);
