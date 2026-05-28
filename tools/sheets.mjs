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
export async function readSubmissions() {
  const id = process.env.SUBMISSIONS_SHEET_ID;
  if (!id) throw new Error('SUBMISSIONS_SHEET_ID not set');
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
  const id = process.env.ROSTER_SHEET_ID;
  if (!id) throw new Error('ROSTER_SHEET_ID not set');
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
  // Strategy 1: split on em-dash / en-dash / hyphen. Cheap, handles the common case.
  const parts = raw.split(/\s*[—–\-]\s*/);
  if (parts.length >= 2) {
    const cand = parts.slice(1).join(' - ').trim();
    if (knownMissionNames.length === 0 || matchesKnownMission(cand, knownMissionNames)) {
      return { name: parts[0].trim(), mission: cand, raw };
    }
  }
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

function matchesKnownMission(s, known) {
  const sf = fold(s);
  return known.some(m => fold(m) === sf);
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
