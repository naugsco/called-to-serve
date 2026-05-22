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

import { readFile } from 'node:fs/promises';

let _sheets;
async function client() {
  if (_sheets) return _sheets;
  const { google } = await import('googleapis');
  const raw = process.env.GOOGLE_SA_JSON;
  if (!raw) throw new Error('GOOGLE_SA_JSON not set');
  const creds = raw.trim().startsWith('{')
    ? JSON.parse(raw)
    : JSON.parse(await readFile(raw, 'utf8'));
  const auth = new google.auth.JWT(
    creds.client_email, null, creds.private_key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly',
     'https://www.googleapis.com/auth/drive.readonly']
  );
  await auth.authorize();
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

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
      photoUrl: row[1]?.trim() || null,
      permission: /^y/i.test(row[2] ?? ''),
      bio: row[3]?.trim() || null,
    }));
}

export async function readRoster() {
  const id = process.env.ROSTER_SHEET_ID;
  if (!id) throw new Error('ROSTER_SHEET_ID not set');
  const s = await client();
  // Column A on the "Missionaries" tab. Format observed: "Last, First — Mission Name"
  // or similar. We treat the whole cell as a single string and split heuristically.
  const r = await s.spreadsheets.values.get({ spreadsheetId: id, range: 'Missionaries!A:A' });
  const rows = r.data.values ?? [];
  return rows
    .map(row => row[0])
    .filter(v => v && !/^name|^missionar/i.test(v))
    .map(parseRosterCell);
}

function parseRosterCell(cell) {
  // Heuristic: split on em-dash, en-dash, or " - ". Left side = name, right side = mission.
  const parts = cell.split(/\s*[—–\-]\s*/);
  if (parts.length >= 2) {
    return { name: parts[0].trim(), mission: parts.slice(1).join(' - ').trim() };
  }
  return { name: cell.trim(), mission: null };
}
