// Lightweight CSV reader for "Publish to web → CSV" URLs.
// Bypasses Google auth entirely — useful when the org policy blocks SA keys
// AND the user doesn't want to install gcloud. Trade-off: the sheet you
// publish becomes readable by anyone with the URL.

// Tiny CSV parser. Handles quoted fields with commas and "" escapes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      /* swallow */
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export async function fetchCsv(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`CSV fetch failed: ${r.status} for ${url}`);
  const text = await r.text();
  if (text.includes('<!DOCTYPE html')) {
    throw new Error(
      `CSV fetch returned HTML, not CSV. The URL likely isn't published.\n` +
      `In Sheets: File → Share → Publish to web → Comma-separated values (.csv) → Publish.`
    );
  }
  return parseCsv(text);
}
