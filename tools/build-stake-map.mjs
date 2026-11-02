// Builds the static map data behind the stake tour (web/public/stake/):
//
//   land.json            regional coastline (Natural Earth 10m via world-atlas),
//                        cut to the stake's bounding box
//   local-<building>.json  main roads + coast + rivers around each meetinghouse
//                        (OpenStreetMap via Overpass), simplified
//
// Run once, commit the output:   node tools/build-stake-map.mjs [--local-only|--land-only]
// The app never calls Overpass; this only needs network when you re-run it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'web/public/stake');
const stake = JSON.parse(fs.readFileSync(path.join(outDir, 'stake.json'), 'utf8'));

const args = new Set(process.argv.slice(2));
const r = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// Douglas–Peucker on an open polyline.
export function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len < 1e-12
      ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
      : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}

// Cut a polyline to a box, returning the runs that lie inside (Liang–Barsky per
// segment). Clipping lines, not polygons, avoids stroking fake edges on the box.
export function clipLine(pts, [x0, y0, x1, y1]) {
  const runs = [];
  let run = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy], q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
    let inside = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) { if (q[k] < 0) { inside = false; break; } continue; }
      const t = q[k] / p[k];
      if (p[k] < 0) { if (t > t1) { inside = false; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { inside = false; break; } if (t < t1) t1 = t; }
    }
    if (!inside) { run = null; continue; }
    const s = [ax + t0 * dx, ay + t0 * dy], e = [ax + t1 * dx, ay + t1 * dy];
    if (!run || t0 > 0) { run = [s]; runs.push(run); }
    run.push(e);
    if (t1 < 1) run = null;
  }
  return runs;
}

async function buildLand() {
  const topo = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/world-atlas/land-10m.json'), 'utf8'));
  const land = feature(topo, topo.objects.land);
  const box = [-125.6, 48.4, -120.9, 51.2];
  const lines = [];
  for (const f of land.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) {
      for (const run of clipLine(ring, box)) {
        const s = simplify(run, 0.0007);
        if (s.length >= 2) lines.push(s.map(([x, y]) => [r(x, 4), r(y, 4)]));
      }
    }
  }
  fs.writeFileSync(path.join(outDir, 'land.json'), JSON.stringify(lines));
  console.log(`land.json: ${lines.length} lines, ${lines.reduce((n, l) => n + l.length, 0)} pts`);
}

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary'];

async function overpass(query) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${OVERPASS}?data=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'called-to-serve-kiosk/1.0 (static map build)', Accept: 'application/json' },
    });
    if (res.ok) return res.json();
    console.warn(`  overpass ${res.status}, retry ${attempt}`);
    await new Promise(r => setTimeout(r, 5000 * attempt));
  }
  throw new Error('Overpass failed');
}

async function buildLocal() {
  for (const b of stake.buildings) {
    const dLat = 0.042, dLng = 0.062;
    const bb = `${b.lat - dLat},${b.lng - dLng},${b.lat + dLat},${b.lng + dLng}`;
    const q = `[out:json][timeout:60];(
      way["highway"~"^(${ROAD_CLASSES.join('|')})$"](${bb});
      way["natural"="coastline"](${bb});
      way["waterway"="river"](${bb});
    );out geom;`;
    const data = await overpass(q);
    const out = { roads: {}, coast: [], rivers: [] };
    for (const el of data.elements) {
      if (!el.geometry || el.geometry.length < 2) continue;
      const pts = el.geometry.map(g => [g.lon, g.lat]);
      const s = simplify(pts, 0.00005).map(([x, y]) => [r(x, 5), r(y, 5)]);
      if (s.length < 2) continue;
      if (el.tags.highway) (out.roads[el.tags.highway] ||= []).push(s);
      else if (el.tags.natural === 'coastline') out.coast.push(s);
      else out.rivers.push(s);
    }
    const file = path.join(outDir, `local-${b.id}.json`);
    fs.writeFileSync(file, JSON.stringify(out));
    const n = Object.values(out.roads).reduce((a, l) => a + l.length, 0);
    console.log(`local-${b.id}.json: ${n} roads, ${out.coast.length} coast, ${out.rivers.length} rivers, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
    await new Promise(r => setTimeout(r, 2500));
  }
}

if (!args.has('--local-only')) await buildLand();
if (!args.has('--land-only')) await buildLocal();
