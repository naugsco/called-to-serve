// Stake tour map layers — drawn by globe.js into the same canvas as the globe,
// so the world → stake → meetinghouse zoom is one continuous camera move.
//
//   regional  coastline, stake outline, ward territories, meetinghouse pins
//   local     main roads + coast + rivers around the featured meetinghouse
//
// Cost model for the TV: the regional layer is a few hundred projected points.
// The local layer is thousands, so it is built once per building as Path2D in
// flat, pre-scaled degrees and drawn through a canvas transform (no per-point
// projection per frame).

import { state } from './state.js';

const base = import.meta.env.BASE_URL || '/';
const get = name => fetch(`${base}stake/${name}`, { cache: 'no-cache' }).then(r => {
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
});

export async function loadStake() {
  const [data, land, water] = await Promise.all([get('stake.json'), get('land.json'), get('water.json')]);
  state.stake.data = data;
  state.stake.land = land;
  state.stake.water = water;
}

// Fetch + prepare one building's street map. Safe to call repeatedly.
export async function ensureLocal(buildingId) {
  const s = state.stake;
  if (s.local.has(buildingId)) return s.local.get(buildingId);
  const b = s.data.buildings.find(x => x.id === buildingId);
  const raw = await get(`local-${buildingId}.json`);
  const k = Math.cos(b.lat * Math.PI / 180);
  // Flat, isotropic degrees around the building: x = Δlng·cos(lat), y = Δlat.
  const path2d = lines => {
    const p = new Path2D();
    for (const line of lines) {
      line.forEach(([lng, lat], i) => {
        const x = (lng - b.lng) * k, y = lat - b.lat;
        if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
      });
    }
    return p;
  };
  const layers = {
    k, lat0: b.lat, lng0: b.lng,
    motorway: path2d(raw.roads.motorway || []),
    trunk: path2d(raw.roads.trunk || []),
    primary: path2d(raw.roads.primary || []),
    secondary: path2d(raw.roads.secondary || []),
    coast: path2d(raw.coast || []),
    rivers: path2d(raw.rivers || []),
  };
  s.local.set(buildingId, layers);
  return layers;
}

const ss = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// How visible each layer is at a given zoom (multiple of the world-view scale).
export const fades = zoom => ({
  world: 1 - ss(zoom, 3, 16),        // 110m globe lines give way to the regional map
  regional: ss(zoom, 4, 24),
  local: ss(zoom, 260, 900),
});

// Label anchor per building: [dx, dy] px from the pin (scaled by `unit`), text side.
// The southwest cluster is tight at stake zoom, so each label gets its own corner.
const LABEL = {
  'forty-first': [-16, 30, 'w'],
  burnaby:        [18, 34, 'e'],
  coquitlam:      [24, -6, 'e'],
  'north-shore': [-16, -24, 'w'],
  sechelt:        [-16, 0, 'w'],
  squamish:       [16, 0, 'e'],
};

const side0 = () => -1;

function ringPath(ctx, projection, ring) {
  let started = false;
  for (const pt of ring) {
    const p = projection(pt);
    if (!p) continue;
    if (!started) { ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]);
  }
  if (started) ctx.closePath();
}

function setLetterSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }

// ctx is already in CSS-pixel space. `g` is state.globe; r is the globe radius in px.
export function drawStake(ctx, projection, C, { unit, zoom, now, w, h, r, cx, cy }) {
  const s = state.stake;
  if (!s.data) return;
  const f = fades(zoom);
  const o = s.overlay;
  const D = Math.PI / 180;

  const waterA = ss(zoom, 26, 52);
  if (waterA > 0.01) {
    ctx.save();
    ctx.beginPath();
    for (const ring of s.water) ringPath(ctx, projection, ring);
    ctx.clip('evenodd');
    ctx.beginPath();
    for (const ring of s.water.slice(1)) ringPath(ctx, projection, ring);
    // The land casts a soft tint into the water. Clipping keeps the tint
    // off the mainland and islands.
    ctx.fillStyle = C.ink;
    ctx.shadowColor = `rgba(${C.inkRgb}, ${0.27 * waterA})`;
    ctx.shadowBlur = 12 * unit * ctx.getTransform().a;
    ctx.fill('evenodd');
    ctx.restore();
  }

  // --- regional coastline (hands over to the street-level coast when close) ---
  const coastA = f.regional * (1 - f.local);
  if (coastA > 0.01 && s.land) {
    ctx.strokeStyle = `rgba(${C.inkRgb}, ${0.8 * coastA})`;
    ctx.lineWidth = 1.1 * unit;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const line of s.land) {
      let pen = false;
      for (const pt of line) {
        const p = projection(pt);
        if (!p) { pen = false; continue; }
        if (!pen) { ctx.moveTo(p[0], p[1]); pen = true; } else ctx.lineTo(p[0], p[1]);
      }
    }
    ctx.stroke();
  }

  // --- street-level map around the featured building ---
  const active = s.activeBuilding && s.local.get(s.activeBuilding);
  if (active && f.local > 0.01) {
    // Screen centre of the globe view is (-lambda, -rotateLat) in lng/lat.
    const lng = -state.globe.lambda, lat = -state.globe.rotateLat;
    const kPx = r * D;                      // px per flat degree
    const xc = (lng - active.lng0) * active.k, yc = lat - active.lat0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(kPx, -kPx);
    ctx.translate(-xc, -yc);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const stroke = (p, px, color) => { ctx.lineWidth = px * unit / kPx; ctx.strokeStyle = color; ctx.stroke(p); };
    const A = f.local;
    stroke(active.rivers, 1.6, `rgba(${C.accentRgb}, ${0.55 * A})`);
    stroke(active.secondary, 0.9, `rgba(${C.inkRgb}, ${0.28 * A})`);
    stroke(active.primary, 1.3, `rgba(${C.inkRgb}, ${0.42 * A})`);
    stroke(active.trunk, 1.9, `rgba(${C.inkRgb}, ${0.55 * A})`);
    stroke(active.motorway, 2.4, `rgba(${C.inkRgb}, ${0.7 * A})`);
    stroke(active.coast, 1.7, `rgba(${C.inkRgb}, ${0.9 * A})`);
    ctx.restore();
  }

  if (o <= 0.01 || f.regional < 0.01) return;
  const A = o * f.regional;
  const activeUnits = new Set(s.data.units.filter(u => u.building === s.activeBuilding).map(u => u.id));

  // --- ward territories ---
  for (const [id, ring] of Object.entries(s.data.territories)) {
    const lit = s.activeUnit ? s.activeUnit === id : !s.leaderView && activeUnits.has(id);
    ctx.beginPath();
    ringPath(ctx, projection, ring);
    ctx.fillStyle = lit ? `rgba(${C.goldRgb}, ${0.16 * A})` : `rgba(${C.accentRgb}, ${0.05 * A})`;
    ctx.fill();
    ctx.strokeStyle = lit ? `rgba(${C.goldRgb}, ${0.95 * A})` : `rgba(${C.accentRgb}, ${0.5 * A})`;
    ctx.lineWidth = (lit ? 1.8 : 1) * unit;
    ctx.stroke();
  }

  // --- stake outline ---
  ctx.save();
  ctx.setLineDash([9 * unit, 6 * unit]);
  ctx.strokeStyle = `rgba(${C.goldRgb}, ${0.95 * A})`;
  ctx.lineWidth = 2.2 * unit;
  ctx.beginPath();
  ringPath(ctx, projection, s.data.boundary);
  ctx.stroke();
  ctx.restore();

  // --- stake title (only while the whole stake is in view) ---
  const titleA = A * (1 - ss(zoom, 90, 220));
  if (titleA > 0.01) {
    const p = projection([-122.92, 50.3]);
    if (p) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(${C.inkRgb}, ${0.9 * titleA})`;
      ctx.font = `600 ${17 * unit}px 'JetBrains Mono', ui-monospace, monospace`;
      setLetterSpacing(ctx, 6 * unit);
      ctx.fillText('VANCOUVER BC STAKE', p[0], p[1]);
      ctx.font = `${11 * unit}px 'JetBrains Mono', ui-monospace, monospace`;
      setLetterSpacing(ctx, 3 * unit);
      ctx.fillStyle = `rgba(${C.inkRgb}, ${0.55 * titleA})`;
      ctx.fillText(`${s.data.units.length} UNITS · ${s.data.buildings.length} MEETINGHOUSES`, p[0], p[1] + 20 * unit);
      ctx.restore();
    }
  }

  // --- meetinghouse pins ---
  for (const b of s.data.buildings) {
    const p = projection([b.lng, b.lat]);
    if (!p) continue;
    const isActive = b.id === s.activeBuilding;
    if (isActive) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 380);
      const rr = (11 + pulse * 3) * unit * (1 + 0.6 * f.local);
      const grad = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], rr * 2.6);
      grad.addColorStop(0, `rgba(${C.goldRgb}, ${0.8 * A})`);
      grad.addColorStop(1, `rgba(${C.goldRgb}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(p[0], p[1], rr * 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(${C.goldRgb}, ${A})`; ctx.lineWidth = 2 * unit;
      ctx.beginPath(); ctx.arc(p[0], p[1], rr, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = C.gold;
      ctx.beginPath(); ctx.arc(p[0], p[1], 3.4 * unit, 0, Math.PI * 2); ctx.fill();
    } else {
      // Neighbouring meetinghouses recede as the camera closes in on one.
      ctx.globalAlpha = 1 - f.local;
      ctx.strokeStyle = `rgba(${C.accentRgb}, ${0.9 * A})`; ctx.lineWidth = 1.4 * unit;
      ctx.beginPath(); ctx.arc(p[0], p[1], 6 * unit, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(${C.inkRgb}, ${A})`;
      ctx.beginPath(); ctx.arc(p[0], p[1], 2.2 * unit, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Label: name (and address when featured), in its own corner with a leader
    // line when it sits off to the side.
    if (isActive && s.leaderView) continue; // The unit details already label the active pin.
    const [dx, dy, side] = isActive ? [side0(b), 0, side0(b) > 0 ? 'e' : 'w'] : LABEL[b.id] || [16, 0, 'e'];
    const east = side === 'e';
    const gap = isActive ? 22 + 8 * f.local : 0;
    const ax = p[0] + (isActive ? (east ? 1 : -1) * gap : dx * unit);
    const ay = p[1] + (isActive ? 0 : dy * unit);
    ctx.save();
    ctx.globalAlpha = isActive ? Math.max(A, f.local) : A * (1 - f.local);
    if (!isActive && (Math.abs(dy) > 12 || Math.abs(dx) > 20)) {
      ctx.strokeStyle = `rgba(${C.inkRgb}, 0.35)`; ctx.lineWidth = 0.8 * unit;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(ax - (east ? 3 : -3) * unit, ay); ctx.stroke();
    }
    ctx.textAlign = east ? 'left' : 'right';
    ctx.fillStyle = isActive ? C.ink : `rgba(${C.inkRgb}, 0.85)`;
    ctx.font = `600 ${(isActive ? 15 : 12) * unit}px 'JetBrains Mono', ui-monospace, monospace`;
    setLetterSpacing(ctx, 2.4 * unit);
    ctx.fillText(b.name.toUpperCase(), ax, ay + 4 * unit);
    if (isActive) {
      ctx.font = `${11.5 * unit}px 'JetBrains Mono', ui-monospace, monospace`;
      setLetterSpacing(ctx, 1.2 * unit);
      ctx.fillStyle = `rgba(${C.inkRgb}, 0.65)`;
      ctx.fillText(b.address, ax, ay + 22 * unit);
    }
    ctx.restore();
  }
}
