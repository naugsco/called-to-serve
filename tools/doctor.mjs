#!/usr/bin/env node
// Diagnostic script. Tells you what's configured and what's missing.
// Run: node tools/doctor.mjs

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const OK = '\x1b[32m✓\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

// Load tools/.secrets/.env the same way sync.mjs does.
const ENV_FILE = resolve(__dirname, '.secrets/.env');
const envLoaded = existsSync(ENV_FILE);
if (envLoaded) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const header = (title) => console.log(`\n\x1b[1m${title}\x1b[0m`);

console.log('called-to-serve doctor');
console.log('=======================');

// 1. env file
header('Local config');
if (envLoaded) console.log(`  ${OK} tools/.secrets/.env loaded`);
else console.log(`  ${WARN} tools/.secrets/.env not found (using process env only)`);

// 2. auth state
header('Authentication');
const saRaw = process.env.GOOGLE_SA_JSON;
let saKnown = false;
if (saRaw) {
  if (saRaw.trim().startsWith('{')) {
    try { JSON.parse(saRaw); console.log(`  ${OK} GOOGLE_SA_JSON set (inline JSON, parses OK)`); saKnown = true; }
    catch (e) { console.log(`  ${FAIL} GOOGLE_SA_JSON set but JSON parse failed: ${e.message}`); }
  } else if (existsSync(saRaw)) {
    try {
      const j = JSON.parse(readFileSync(saRaw, 'utf8'));
      console.log(`  ${OK} GOOGLE_SA_JSON points at a key file: ${saRaw}`);
      if (j.client_email) console.log(`      service account: ${j.client_email}`);
      saKnown = true;
    } catch (e) { console.log(`  ${FAIL} GOOGLE_SA_JSON points at file but it doesn't parse: ${e.message}`); }
  } else {
    console.log(`  ${FAIL} GOOGLE_SA_JSON set but file doesn't exist: ${saRaw}`);
  }
}
if (!saKnown) {
  console.log(`  ${WARN} no service-account key configured`);
  const adcPath = `${process.env.HOME}/.config/gcloud/application_default_credentials.json`;
  if (existsSync(adcPath)) console.log(`  ${OK} gcloud Application Default Credentials present at ~/.config/gcloud/application_default_credentials.json`);
  else console.log(`  ${FAIL} no gcloud ADC either — auth is NOT configured\n      run:  gcloud auth application-default login`);
}

// 3. live-mode signals
header('Live-mode signals');
const apiIds = process.env.SUBMISSIONS_SHEET_ID && process.env.ROSTER_SHEET_ID;
const csvUrls = process.env.PUBLIC_SUBMISSIONS_CSV_URL && process.env.PUBLIC_ROSTER_CSV_URL;
if (apiIds) {
  console.log(`  ${OK} SUBMISSIONS_SHEET_ID=${shortId(process.env.SUBMISSIONS_SHEET_ID)}`);
  console.log(`  ${OK} ROSTER_SHEET_ID=${shortId(process.env.ROSTER_SHEET_ID)}`);
} else {
  console.log(`  ${process.env.SUBMISSIONS_SHEET_ID ? OK : WARN} SUBMISSIONS_SHEET_ID ${process.env.SUBMISSIONS_SHEET_ID ? '' : 'not set'}`);
  console.log(`  ${process.env.ROSTER_SHEET_ID ? OK : WARN} ROSTER_SHEET_ID ${process.env.ROSTER_SHEET_ID ? '' : 'not set'}`);
}
if (csvUrls) {
  console.log(`  ${OK} PUBLIC_SUBMISSIONS_CSV_URL set`);
  console.log(`  ${OK} PUBLIC_ROSTER_CSV_URL set`);
}
if (!apiIds && !csvUrls) {
  console.log(`  ${WARN} neither API IDs nor CSV URLs configured — sync will use SAMPLE data`);
}

// 4. mission data
header('Mission lookup table');
const seed = JSON.parse(await readFile(resolve(__dirname, 'missions-seed.json'), 'utf8'));
const extra = JSON.parse(await readFile(resolve(__dirname, 'missions-extra.json'), 'utf8'));
console.log(`  ${OK} ${seed.missions.length} seed missions`);
console.log(`  ${OK} ${(extra.missions ?? []).length} extra missions`);

// 5. try a real connection if we have what we need
if (apiIds || csvUrls) {
  header('Connectivity test');
  try {
    const { readRoster, readSubmissions } = await import('./sheets.mjs');
    const known = [...seed.missions, ...(extra.missions ?? [])].map(m => m.name);
    const [roster, subs] = await Promise.all([readRoster(known), readSubmissions()]);
    console.log(`  ${OK} roster: ${roster.length} rows read`);
    console.log(`  ${OK} submissions: ${subs.length} rows read`);

    const unmatched = roster.filter(r => !r.mission);
    const missionLookup = new Map([...seed.missions, ...(extra.missions ?? [])].map(m => [m.name, m]));
    const missingCoords = roster.filter(r => r.mission && !missionLookup.has(r.mission));
    if (unmatched.length) {
      console.log(`  ${WARN} ${unmatched.length} roster row(s) had no recognisable mission in their text:`);
      for (const u of unmatched.slice(0, 5)) console.log(`        "${u.raw}"`);
      if (unmatched.length > 5) console.log(`        ...and ${unmatched.length - 5} more`);
    }
    if (missingCoords.length) {
      console.log(`  ${WARN} ${missingCoords.length} mission(s) referenced by the roster aren't in seed/extra:`);
      for (const m of [...new Set(missingCoords.map(r => r.mission))].slice(0, 8)) {
        console.log(`        ${m}`);
      }
    }
    const permYes = subs.filter(s => s.permission).length;
    const photoCount = subs.reduce((n, s) => n + (s.photoUrls?.length ?? 0), 0);
    console.log(`  ${OK} ${permYes}/${subs.length} submissions have permission=Yes`);
    console.log(`  ${OK} ${photoCount} photo URL(s) total across submissions`);
  } catch (err) {
    console.log(`  ${FAIL} connection test failed: ${err.message}`);
    if (err.message.includes('PERMISSION_DENIED')) {
      console.log(`        likely cause: the service account doesn't have Viewer on one of the sheets/Drive folder`);
    }
  }
}

// 6. next step
header('Next step');
if (!apiIds && !csvUrls) {
  console.log('  Set SUBMISSIONS_SHEET_ID + ROSTER_SHEET_ID (and configure auth) in tools/.secrets/.env');
  console.log('  OR set PUBLIC_*_CSV_URL pair to skip auth entirely (Sheets → File → Share → Publish to web → CSV).');
} else if (!saKnown && !existsSync(`${process.env.HOME}/.config/gcloud/application_default_credentials.json`) && !csvUrls) {
  console.log('  Configure auth:');
  console.log('    A) Put your downloaded SA key at tools/.secrets/sa-key.json');
  console.log('       and set GOOGLE_SA_JSON to that path in tools/.secrets/.env');
  console.log('    B) OR run: gcloud auth application-default login');
} else {
  console.log('  Looks ready. Run:  node tools/sync.mjs');
}
console.log('');

function shortId(s) {
  if (!s) return '';
  return s.length > 16 ? `${s.slice(0, 12)}...${s.slice(-4)}` : s;
}
