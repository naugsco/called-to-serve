// Globe rendering — d3-geo orthographic on a single 2D canvas.
// Reads from state on every RAF tick; mutates only state.globe.lambda from omega.
// Colors are read from CSS custom properties so themes work without recompile.

import { geoOrthographic, geoPath, geoGraticule10, geoInterpolate } from 'd3-geo';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';
import { state, ensureMissionEntry } from './state.js';
import { VIEW, SPEED, VANCOUVER } from './timings.js';

const land = feature(world, world.objects.countries);

const projection = geoOrthographic().clipAngle(90);
const ctxPath = (ctx) => geoPath(projection, ctx);
const graticule = geoGraticule10();

let canvas, ctx, dpr = 1;
let last = performance.now();

// Render styles:
//   hud     — monochrome outline HUD (light/dark themes)
//   color   — 3D shader globe (globe3d.js) renders beneath; this canvas only
//             draws overlays (pins, halos, particles)
//   antique — old-world parchment: botanical country washes, ink lines
function renderStyle() {
  const cl = document.body.classList;
  if (cl.contains('antique')) return 'antique';
  if (cl.contains('color')) return 'color';
  return 'hud';
}

// Hook registered by main.js when color mode is active — keeps three.js out
// of the bundle until someone actually switches to the color globe.
let globe3dSync = null;
export function setGlobe3DSync(fn) { globe3dSync = fn; }

// Botanical washes for the antique style — muted tints from hand-colored
// atlases. Assigned per-country by hashing the feature id so they're stable.
const ANTIQUE_WASHES = [
  'rgba(140, 150, 96, 0.40)',   // sage
  'rgba(187, 142, 92, 0.38)',   // ochre
  'rgba(168, 112, 100, 0.34)',  // dusty rose
  'rgba(110, 130, 140, 0.32)',  // slate blue
  'rgba(165, 150, 100, 0.38)',  // olive gold
  'rgba(130, 110, 130, 0.28)',  // faded violet
];
function washFor(f) {
  const id = String(f.id ?? f.properties?.name ?? '0');
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return ANTIQUE_WASHES[Math.abs(h) % ANTIQUE_WASHES.length];
}

// CSS-var-driven colors. Re-read on theme change.
const C = {
  ink: '#1a1a1a',
  inkRgb: '26,26,26',
  bg: '#F2EFE8',
  accent: '#2c5f5d',
  accentRgb: '44,95,93',
  gold: '#e8c468',
  goldRgb: '232,196,104',
};

export function refreshColors() {
  const cs = getComputedStyle(document.body);
  const get = (n, fallback) => (cs.getPropertyValue(n).trim() || fallback);
  C.ink = get('--ink', C.ink);
  C.inkRgb = get('--ink-rgb', C.inkRgb);
  C.bg = get('--bg', C.bg);
  C.accent = get('--accent', C.accent);
  C.accentRgb = get('--accent-rgb', C.accentRgb);
  C.gold = get('--gold', C.gold);
  C.goldRgb = get('--gold-rgb', C.goldRgb);
}

export function mountGlobe(el) {
  canvas = document.createElement('canvas');
  canvas.id = 'globe-canvas';
  el.appendChild(canvas);
  refreshColors();
  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(tick);
}

function resize() {
  // Allow full device pixel ratio for crisp 4K rendering. Cap at 3 to bound memory.
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  state.globe.lambda += state.globe.omega * dt;
  draw(now);
  requestAnimationFrame(tick);
}

function draw(now) {
  const w = window.innerWidth, h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  const g = state.globe;
  const base = Math.min(w, h) * VIEW.globeScaleBase;
  const r = base * g.scale;
  const cx = w * g.centerX;
  const cy = h * g.centerY;
  // unit scales line widths and pin sizes proportionally to viewport short side.
  const unit = Math.min(w, h) / 900;

  // CRITICAL: projection.rotate([lambda, phi]) centers a point at (lng, lat) when set to [-lng, -lat].
  // state.globe.rotateLat is stored as -lat (set in loop.centerOn). Pass it through directly.
  projection.scale(r).translate([cx, cy]).rotate([g.lambda, g.rotateLat]);

  const style = renderStyle();

  if (style === 'color') {
    // The 3D shader globe (globe3d.js) draws the planet on its own canvas
    // beneath this one — here we only render the overlays on top.
    globe3dSync?.({
      lambda: g.lambda, rotateLat: g.rotateLat,
      scalePx: r, cx, cy, w, h, now,
    });
  } else if (style === 'antique') {
    drawAntiqueBase(now, cx, cy, r, unit);
  } else {
    drawHudBase(now, cx, cy, r, unit);
  }

  drawMissions(now, unit);
  drawParticles(now, unit);
}

function drawHudBase(now, cx, cy, r, unit) {
  const g = state.globe;
  drawWhirl(now, cx, cy, r, unit);

  // Sphere fill (slight wash over background).
  ctx.fillStyle = `rgba(${C.inkRgb}, 0.025)`;
  beginAndPath({ type: 'Sphere' });
  ctx.fill();

  // Graticule.
  ctx.strokeStyle = `rgba(${C.inkRgb}, 0.18)`;
  ctx.lineWidth = 0.6 * unit;
  beginAndPath(graticule);
  ctx.stroke();

  // Land outlines.
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 0.9 * unit;
  ctx.globalAlpha = g.landAlpha;
  beginAndPath(land);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Sphere outline.
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.3 * unit;
  beginAndPath({ type: 'Sphere' });
  ctx.stroke();
}

// Old-world parchment atlas: sea wash, dashed graticule, per-country
// botanical tints with ink coastlines, and a double-ring border like an
// engraved plate.
function drawAntiqueBase(now, cx, cy, r, unit) {
  const g = state.globe;

  // Sea: subtle aged wash, slightly deeper toward the limb (vignette).
  const sea = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
  sea.addColorStop(0, 'rgba(196, 184, 152, 0.30)');
  sea.addColorStop(0.8, 'rgba(176, 160, 124, 0.42)');
  sea.addColorStop(1, 'rgba(150, 132, 96, 0.55)');
  ctx.fillStyle = sea;
  beginAndPath({ type: 'Sphere' });
  ctx.fill();

  // Dashed ink graticule — engraved-plate look.
  ctx.save();
  ctx.setLineDash([3 * unit, 5 * unit]);
  ctx.strokeStyle = `rgba(${C.inkRgb}, 0.34)`;
  ctx.lineWidth = 0.55 * unit;
  beginAndPath(graticule);
  ctx.stroke();
  ctx.restore();

  // Countries: stable botanical washes + fine ink outline.
  ctx.globalAlpha = g.landAlpha;
  for (const f of land.features) {
    ctx.fillStyle = washFor(f);
    beginAndPath(f);
    ctx.fill();
  }
  ctx.strokeStyle = `rgba(${C.inkRgb}, 0.75)`;
  ctx.lineWidth = 0.7 * unit;
  beginAndPath(land);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Double-ring sphere border, like an old engraved plate.
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.6 * unit;
  beginAndPath({ type: 'Sphere' });
  ctx.stroke();
  ctx.strokeStyle = `rgba(${C.inkRgb}, 0.55)`;
  ctx.lineWidth = 0.7 * unit;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5 * unit, 0, Math.PI * 2);
  ctx.stroke();
}

function beginAndPath(obj) {
  ctx.beginPath();
  ctxPath(ctx)(obj);
}

// --- whirl ---
function drawWhirl(now, cx, cy, r, unit) {
  const t = now / 1000;
  ctx.save();
  ctx.translate(cx, cy);
  for (let ring = 0; ring < 3; ring++) {
    const radius = r * (1.06 + ring * 0.07);
    const speed = 0.06 + ring * 0.04;
    const segs = 18 + ring * 4;
    const phase = t * speed * (ring % 2 ? -1 : 1);
    ctx.strokeStyle = `rgba(${C.inkRgb}, ${0.06 + ring * 0.02})`;
    ctx.lineWidth = 0.7 * unit;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2 + phase;
      const len = 0.08 + (i % 5 === 0 ? 0.06 : 0);
      ctx.beginPath();
      ctx.arc(0, 0, radius, a, a + len);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// --- missions ---
function isOnFront(lng, lat) {
  const D = Math.PI / 180;
  const lambda = -state.globe.lambda * D;
  const phi = -state.globe.rotateLat * D;
  const cosc = Math.sin(phi) * Math.sin(lat * D) +
               Math.cos(phi) * Math.cos(lat * D) * Math.cos(lng * D - lambda);
  return cosc >= -0.02;
}

function drawMissions(now, unit) {
  if (!state.data) return;
  const seen = new Set();
  const activeSlug = state.missions.activeSlug;
  // Draw non-active first, active last so it sits on top.
  const pass = (active) => {
    for (const m of state.data.missionaries) {
      if (m.missionLat == null || seen.has(m.missionSlug)) continue;
      const isActive = m.missionSlug === activeSlug;
      if (isActive !== active) continue;
      const entry = ensureMissionEntry(m.missionSlug);
      if (!entry.highlighted && !entry.excitedAt && !isActive) continue;
      if (!isOnFront(m.missionLng, m.missionLat)) continue;
      const p = projection([m.missionLng, m.missionLat]);
      if (!p) continue;
      seen.add(m.missionSlug);
      drawOneMission(now, unit, p, entry, isActive);
    }
  };
  pass(false);
  pass(true);
}

function drawOneMission(now, unit, p, entry, isActive) {
  if (isActive) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 380);
    const baseR = 22 * unit + pulse * 5 * unit;
    // Outer radial glow.
    const grad = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], baseR * 2.6);
    grad.addColorStop(0, `rgba(${C.goldRgb}, 0.85)`);
    grad.addColorStop(0.5, `rgba(${C.goldRgb}, 0.3)`);
    grad.addColorStop(1, `rgba(${C.goldRgb}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p[0], p[1], baseR * 2.6, 0, Math.PI * 2);
    ctx.fill();
    // Outer pulsing ring.
    ctx.strokeStyle = `rgba(${C.goldRgb}, ${0.7 + pulse * 0.3})`;
    ctx.lineWidth = 2 * unit;
    ctx.beginPath();
    ctx.arc(p[0], p[1], baseR, 0, Math.PI * 2);
    ctx.stroke();
    // Inner ring.
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 1.5 * unit;
    ctx.beginPath();
    ctx.arc(p[0], p[1], baseR * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    // Crosshair lines extending past ring.
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 1.2 * unit;
    const ch = baseR * 1.4;
    ctx.beginPath();
    ctx.moveTo(p[0] - ch, p[1]); ctx.lineTo(p[0] - baseR * 0.7, p[1]);
    ctx.moveTo(p[0] + baseR * 0.7, p[1]); ctx.lineTo(p[0] + ch, p[1]);
    ctx.moveTo(p[0], p[1] - ch); ctx.lineTo(p[0], p[1] - baseR * 0.7);
    ctx.moveTo(p[0], p[1] + baseR * 0.7); ctx.lineTo(p[0], p[1] + ch);
    ctx.stroke();
    // Center dot.
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 3 * unit, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Highlighted (but not active).
  if (entry.highlighted) {
    const baseR = 14 * unit + Math.sin(now / 700) * 1.5 * unit;
    const grad = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], baseR * 2.4);
    grad.addColorStop(0, `rgba(${C.accentRgb}, 0.55)`);
    grad.addColorStop(1, `rgba(${C.accentRgb}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p[0], p[1], baseR * 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(${C.accentRgb}, 0.85)`;
    ctx.lineWidth = 1.0 * unit;
    ctx.beginPath();
    ctx.arc(p[0], p[1], baseR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 0.9 * unit;
    ctx.beginPath();
    ctx.moveTo(p[0] - 5 * unit, p[1]); ctx.lineTo(p[0] + 5 * unit, p[1]);
    ctx.moveTo(p[0], p[1] - 5 * unit); ctx.lineTo(p[0], p[1] + 5 * unit);
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 1.6 * unit, 0, Math.PI * 2);
    ctx.fill();
  }

  // Excite ring transient.
  if (entry.excitedAt) {
    const tt = (performance.now() - entry.excitedAt) / 1200;
    if (tt > 1) {
      entry.excitedAt = null;
    } else {
      const rr = 6 * unit + tt * 60 * unit;
      ctx.strokeStyle = `rgba(${C.goldRgb}, ${(1 - tt) * 0.9})`;
      ctx.lineWidth = 2 * unit;
      ctx.beginPath();
      ctx.arc(p[0], p[1], rr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// --- particles ---
export function spawnParticleToMission(missionary) {
  const interp = geoInterpolate(
    [VANCOUVER.lng, VANCOUVER.lat],
    [missionary.missionLng, missionary.missionLat]
  );
  state.particles.push({
    interp,
    missionSlug: missionary.missionSlug,
    startedAt: performance.now(),
    duration: SPEED.particleSec * 1000,
    dotCount: 14,
  });
}

function drawParticles(now, unit) {
  if (!state.particles.length) return;
  const alive = [];
  for (const part of state.particles) {
    const t = (now - part.startedAt) / part.duration;
    if (t >= 1) {
      const entry = ensureMissionEntry(part.missionSlug);
      entry.highlighted = true;
      entry.excitedAt = now;
      continue;
    }
    for (let i = 0; i < part.dotCount; i++) {
      const tt = t - (i / part.dotCount) * 0.18;
      if (tt < 0 || tt > 1) continue;
      const [lng, lat] = part.interp(tt);
      if (!isOnFront(lng, lat)) continue;
      const p = projection([lng, lat]);
      if (!p) continue;
      const alpha = (1 - i / part.dotCount) * 0.9;
      ctx.fillStyle = i === 0 ? `rgba(${C.accentRgb}, 0.95)` : `rgba(${C.accentRgb}, 0.3)`;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p[0], p[1], (i === 0 ? 2.3 : 1.4) * unit, 0, Math.PI * 2);
      ctx.fill();
    }
    alive.push(part);
  }
  ctx.globalAlpha = 1;
  state.particles = alive;
}
