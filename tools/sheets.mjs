// Google Sheets reader. Used by sync.mjs when GOOGLE_SA_JSON is set.
//
// Set up:
//   1. Create a Google Cloud project, enable Sheets API + Drive API.
//   2. Create a service account, generate a JSON key.
//   3. Share both sheets + the Drive uploads folder with the SA email (Viewer).
//   4. Export GOOGLE_SA_JSON to the JSON key (path or raw JSON).
//
// Configure the spreadsheet IDs via env so prod and local can differ:
//   SUBMISSIONS_SHEET_ID   — form response sheet (columns found by header text)
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

// The "Missionary Photos" Google Form writes one row per submission. The
// photo cell may carry MULTIPLE Drive URLs (multi-file upload question),
// comma- or newline-separated.
//
// Columns are found by their HEADER text (the form question), not position:
// adding a question to the form appends a column, and the form owner may
// reorder questions. Each pattern must match exactly one header.
const SUBMISSION_COLUMNS = {
  name:       { re: /missionary.s name/i,  required: true },
  photo:      { re: /^photo/i,             required: true },
  permission: { re: /permission/i,         required: true },
  bio:        { re: /\bbio\b/i,            required: false },
  startDate:  { re: /start date/i,         required: false },
  language:   { re: /language/i,           required: false },
  homeWard:   { re: /\bward\b/i,           required: false },
};

// Two reader paths:
//   • PUBLIC_SUBMISSIONS_CSV_URL set → fetch via published-CSV (no auth)
//   • else                          → use Sheets API (auth required)
export async function readSubmissions() {
  const csvUrl = process.env.PUBLIC_SUBMISSIONS_CSV_URL;
  if (csvUrl) return parseSubmissionRows(await fetchCsv(csvUrl));

  const id = process.env.SUBMISSIONS_SHEET_ID;
  if (!id) throw new Error('Neither SUBMISSIONS_SHEET_ID nor PUBLIC_SUBMISSIONS_CSV_URL is set');
  const s = await client();
  // UNFORMATTED + SERIAL_NUMBER: a Date-type answer arrives as a day serial,
  // which is unambiguous (a formatted "10/02/2025" is not).
  const r = await s.spreadsheets.values.get({
    spreadsheetId: id,
    range: 'A:Z',
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  return parseSubmissionRows(r.data.values ?? []);
}

// rows[0] is the header row. Returns one object per submission with a name.
// startDateRaw is passed through untouched (string or day serial) — sync.mjs
// parses it with dates.mjs so it can report ambiguous values by missionary.
export function parseSubmissionRows(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(h => String(h ?? '').trim());
  const col = {};
  for (const [key, { re, required }] of Object.entries(SUBMISSION_COLUMNS)) {
    const hits = header.flatMap((h, i) => (re.test(h) ? [i] : []));
    if (hits.length > 1) {
      throw new Error(`Submissions sheet: ${hits.length} columns match "${key}" (${re}): ` +
        hits.map(i => `"${header[i]}"`).join(', '));
    }
    if (!hits.length && required) {
      throw new Error(`Submissions sheet: no column matches "${key}" (${re}). Headers: ` +
        header.map(h => `"${h}"`).join(', '));
    }
    col[key] = hits.length ? hits[0] : -1;
  }
  const cell = (row, key) => (col[key] < 0 ? '' : row[col[key]] ?? '');
  const text = (row, key) => String(cell(row, key)).trim() || null;
  return rows.slice(1)
    .filter(row => text(row, 'name'))
    .map(row => ({
      name: text(row, 'name'),
      photoUrls: splitPhotoUrls(String(cell(row, 'photo'))),
      permission: /^y/i.test(String(cell(row, 'permission'))),
      bio: text(row, 'bio'),
      startDateRaw: cell(row, 'startDate') === '' ? null : cell(row, 'startDate'),
      language: text(row, 'language'),
      homeWard: text(row, 'homeWard'),
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
