// Turns prospective-missionary form rows into the cards shown on the kiosk.
// Pure functions (no network) so the matching rules can be tested.

export const slugify = s => String(s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const STOP = new Set(['ward', 'branch', 'the', 'stake']);
const tokens = s => new Set(
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(t => t && !STOP.has(t)));

// Match what a youth typed or picked ("Burnaby", "Vancouver 4th Ward") to a
// unit in stake.json. Exact token match wins; otherwise the answer's words must
// all appear in exactly one best unit. Anything ambiguous returns null so we
// never put someone at the wrong building.
export function matchUnit(text, units) {
  const want = tokens(text);
  if (!want.size) return null;
  const scored = [];
  for (const u of units) {
    const have = tokens(u.name);
    if (![...want].every(t => have.has(t))) continue;
    scored.push({ u, extra: have.size - want.size });
  }
  if (!scored.length) return null;
  const best = Math.min(...scored.map(s => s.extra));
  const top = scored.filter(s => s.extra === best);
  return top.length === 1 ? top[0].u : null;
}

// rows: parseProspectiveRows() output, oldest first. Returns the cards plus a
// list of people we left out and why (sync prints these as warnings).
export function buildProspects(rows, units) {
  const byName = new Map();
  for (const r of rows) byName.set(r.name.toLowerCase().replace(/\s+/g, ' ').trim(), r); // newest wins

  const prospects = [], skipped = [];
  for (const r of byName.values()) {
    if (!r.permission) { skipped.push({ name: r.name, reason: 'no parent/guardian permission' }); continue; }
    const unit = matchUnit(r.ward, units);
    if (!unit) { skipped.push({ name: r.name, reason: `ward "${r.ward}" doesn't match a single unit` }); continue; }
    prospects.push({
      slug: slugify(r.name),
      name: r.name,
      group: r.group,
      ward: unit.name,
      unitId: unit.id,
      buildingId: unit.building,
      scripture: r.scripture,
      interests: r.interests,
      why: r.why,
      inspiration: r.inspiration,
      _sourcePhotos: r.photoUrls.map(url => ({ kind: 'drive', url })),
      photos: [],
      bestPhoto: null,
    });
  }
  // Group the tour by building, in the order buildings appear in stake.json,
  // so the map doesn't zig-zag back and forth across the stake.
  const order = [...new Set(units.map(u => u.building))];
  prospects.sort((a, b) => order.indexOf(a.buildingId) - order.indexOf(b.buildingId) || a.name.localeCompare(b.name));
  return { prospects, skipped };
}
