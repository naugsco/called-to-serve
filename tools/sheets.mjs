// Google Sheets reader. Used by sync.mjs when GOOGLE_SA_JSON is set.
//
// Set up:
//   1. Create a Google Cloud project, enable Sheets API + Drive API.
//   2. Create a service account, generate a JSON key.
//   3. Share both sheets + the Drive uploads folder with the SA email (Viewer).
//   4. Export GOOGLE_SA_JSON to the JSON key (path or raw JSON).
//
// Configure the spreadsheet IDs via env so prod and local can differ:
//   SUBMISSIONS_SHEET_ID   — sheet with columns B/C/D/E (name, photo, perm, bio)
//   ROSTER_SHEET_ID        — master sheet with the "Missionaries" tab

import { getGoogleAuth } from './google-auth.mjs';
import { fetchCsv } from './csv.mjs';

let _sheets;
async function client() {
  if (_sheets) return _sheets;
  const { google } = await import('googleapis');
  const auth = await getGoogleAuth();
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

// One submission row in the photo-submissions sheet. Column C may carry
// MULTIPLE Drive URLs if the Google Form used a multi-file upload question —
// they typically arrive comma- or newline-separated.
//
// Two reader paths:
//   • PUBLIC_SUBMISSIONS_CSV_URL set → fetch via published-CSV (no auth)
//   • else                          → use Sheets API (auth required)
export async function readSubmissions() {
  const csvUrl = process.env.PUBLIC_SUBMISSIONS_CSV_URL;
  if (csvUrl) return readSubmissionsViaCsv(csvUrl);

  const id = process.env.SUBMISSIONS_SHEET_ID;
  if (!id) throw new Error('Neither SUBMISSIONS_SHEET_ID nor PUBLIC_SUBMISSIONS_CSV_URL is set');
  const s = await client();
  // Columns B:E — name, photo link, permission yes/no, bio.
  const r = await s.spreadsheets.values.get({ spreadsheetId: id, range: 'B:E' });
  const rows = r.data.values ?? [];
  return rows
    .filter(row => row[0] && !/^name/i.test(row[0])) // skip header
    .map(row => ({
      name: row[0]?.trim(),
      photoUrls: splitPhotoUrls(row[1] || ''),
      permission: /^y/i.test(row[2] ?? ''),
      bio: row[3]?.trim() || null,
    }));
}

// Published-CSV variant. The CSV columns must mirror the API's B:E shape:
// col0=name, col1=photo link, col2=Yes/No, col3=bio. Sheets' Publish-to-web
// preserves the column order, so just publish the same tab as-is.
async function readSubmissionsViaCsv(url) {
  const rows = await fetchCsv(url);
  // Drop header row (best-effort: drop row 1 if it looks like a header).
  const data = rows.length && /name|missionar/i.test(rows[0][0] || '')
    ? rows.slice(1) : rows;
  return data
    .filter(row => row[0])
    .map(row => ({
      name: (row[0] || '').trim(),
      photoUrls: splitPhotoUrls(row[1] || ''),
      permission: /^y/i.test(row[2] ?? ''),
      bio: (row[3] || '').trim() || null,
    }));
}

function splitPhotoUrls(cell) {
  if (!cell) return [];
  return cell
    .split(/[\s,;\n]+/)
    .map(s => s.trim())
    .filter(s => /https?:\/\/(drive|docs)\.google\.com/i.test(s));
}

// Reads column A of the "Missionaries" tab. Each cell is a free-form string —
// the parser tries dash-split first, then suffix-matches against known mission
// names from the seed/extras (so "Smith Brazil São Paulo South Mission" works
// even without a separator). Pass the known names so we can do the fallback.
export async function readRoster(knownMissionNames = []) {
  const csvUrl = process.env.PUBLIC_ROSTER_CSV_URL;
  if (csvUrl) {
    const rows = await fetchCsv(csvUrl);
    return rows
      .map(row => row[0])
      .filter(v => v && !/^name|^missionar/i.test(v))
      .map(cell => parseRosterCell(cell, knownMissionNames));
  }
  const id = process.env.ROSTER_SHEET_ID;
  if (!id) throw new Error('Neither ROSTER_SHEET_ID nor PUBLIC_ROSTER_CSV_URL is set');
  const s = await client();
  const r = await s.spreadsheets.values.get({ spreadsheetId: id, range: 'Missionaries!A:A' });
  const rows = r.data.values ?? [];
  return rows
    .map(row => row[0])
    .filter(v => v && !/^name|^missionar/i.test(v))
    .map(cell => parseRosterCell(cell, knownMissionNames));
}

export function parseRosterCell(cell, knownMissionNames = []) {
  const raw = cell.trim();
  // Strategy 1: split on an explicit delimiter. This handles known missions
  // and newly discovered mission-looking values so sync can report the exact
  // missing coordinate entry instead of "no mission found".
  const delimited = parseDelimitedRosterCell(raw, knownMissionNames);
  if (delimited) return delimited;

  // Strategy 2: suffix-match any known mission name. Useful when the master
  // sheet has "Elder Smith Brazil São Paulo South Mission" with no separator.
  const folded = fold(raw);
  let best = null;
  for (const m of knownMissionNames) {
    const mf = fold(m);
    const idx = folded.lastIndexOf(mf);
    if (idx < 0) continue;
    if (!best || mf.length > best.foldLen) {
      best = { mission: m, foldLen: mf.length, idx };
    }
  }
  if (best) {
    // Map folded-index back to raw-index by counting normalized chars.
    const rawIdx = unfoldIndex(raw, best.idx);
    const namePart = raw.slice(0, rawIdx).replace(/[\s\-—–,:|]+$/, '').trim();
    return { name: namePart || raw, mission: best.mission, raw };
  }
  return { name: raw, mission: null, raw };
}

function parseDelimitedRosterCell(raw, knownMissionNames) {
  // Dash-separated rows are the expected format. Require surrounding
  // whitespace so hyphenated names do not split.
  const dashParts = raw.split(/\s+[—–-]\s+/);
  const byDash = parseDelimitedParts(raw, dashParts, knownMissionNames, ' - ', 'first');
  if (byDash) return byDash;

  // Some roster rows use "Name, Mission" or similar punctuation.
  const punctuationParts = raw.split(/\s*[,|:]\s*/);
  return parseDelimitedParts(raw, punctuationParts, knownMissionNames, ', ', 'last');
}

function parseDelimitedParts(raw, parts, knownMissionNames, nameJoiner, unknownStrategy) {
  if (parts.length < 2) return null;
  let unknown = null;

  for (let i = parts.length - 1; i > 0; i--) {
    const cand = parts.slice(i).join(nameJoiner).trim();
    if (!looksLikeMission(cand)) continue;
    const name = parts.slice(0, i).join(nameJoiner).trim();
    const known = findKnownMission(cand, knownMissionNames);
    if (known) return { name, mission: known, raw };
    const parsed = { name, mission: cand, raw };
    if (!unknown || unknownStrategy === 'first') unknown = parsed;
  }

  return unknown;
}

function looksLikeMission(s) {
  return /\bmission$/i.test((s || '').trim());
}

function findKnownMission(s, known) {
  const sf = fold(s);
  return known.find(m => fold(m) === sf) || null;
}

// Diacritic-fold + lowercase. "São" → "sao". Preserves position by mapping
// each combining mark to nothing (NFD decomposes "ã" → "a"+"̃").
function fold(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function unfoldIndex(rawStr, foldedIdx) {
  // Walk raw character-by-character, advancing the folded counter when a
  // non-combining char survives. Return the raw index that lines up.
  let i = 0, fi = 0;
  while (i < rawStr.length && fi < foldedIdx) {
    const ch = rawStr[i];
    const decomp = ch.toLowerCase().normalize('NFD');
    for (const dc of decomp) {
      if (dc >= '̀' && dc <= 'ͯ') continue;
      fi++;
      if (fi >= foldedIdx) break;
    }
    i++;
  }
  return i;
}
