// Start-date parsing for form answers.
//
// The form's start-date question began as free text, so the sheet holds a mix
// of MM/DD/YYYY and DD/MM/YYYY. We never guess: a value like "10/02/2025" that
// reads validly both ways comes back as { ambiguous: true } and sync reports
// it so a human can fix the cell. A Date-type form answer read through the
// Sheets API arrives as a day serial number, which is unambiguous.
//
// Caveat for answers given while the question was still free text: Sheets
// auto-converts any text that fits its DD/MM locale into a date serial, so an
// old "10/02/2025" arrives here as 10 Feb 2025 with no sign it was ambiguous.
// Those historic cells must be checked by a human once.

const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30); // Sheets day 0

const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};

// → { iso: 'YYYY-MM-DD' } | { ambiguous: true } | { invalid: true } | null (empty)
export function parseStartDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const dt = new Date(SHEETS_EPOCH_MS + Math.floor(value) * 86400000);
    return { iso: dt.toISOString().slice(0, 10) };
  }
  const s = String(value).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const out = iso(+m[1], +m[2], +m[3]);
    return out ? { iso: out } : { invalid: true };
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return { invalid: true };
  const [a, b, y] = [+m[1], +m[2], +m[3]];
  if (a > 12 && b <= 12) return wrap(iso(y, b, a));         // DD/MM
  if (b > 12 && a <= 12) return wrap(iso(y, a, b));         // MM/DD
  if (a === b) return wrap(iso(y, a, b));                   // same either way
  if (a <= 12 && b <= 12) return { ambiguous: true };
  return { invalid: true };
}

const wrap = v => (v ? { iso: v } : { invalid: true });
