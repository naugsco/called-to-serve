// Pointy-top honeycomb field. Always centered on the active missionary.
// Each hex is a "glass pane" (translucent gradient fill, thin clean stroke)
// with an energy pulse traveling along its edge, desynced per cell.
//
// Coordinates: pointy-top axial (q, r):
//   x = (q + r/2) * pitchX
//   y = r * pitchY
//   pitchX = SQ3 * R * GAP
//   pitchY = 1.5  * R * GAP

import gsap from 'gsap';
import { fetchWeather } from './weather.js';

const SQ3 = Math.sqrt(3);
const svgNS = 'http://www.w3.org/2000/svg';

// Normalised hex viewBox lets us share one CSS keyframe across every tile.
const VBW = 100;           // viewBox width
const VBH = (2 * VBW) / SQ3; // pointy-top: height = 2/sqrt(3) * width
const HEX_PERIMETER = 6 * (VBW / SQ3); // side length = width / sqrt(3)

// Vertex coords in the normalised viewBox.
const HEX_POINTS = [
  [VBW * 0.5, 0],
  [VBW,        VBH * 0.25],
  [VBW,        VBH * 0.75],
  [VBW * 0.5,  VBH],
  [0,          VBH * 0.75],
  [0,          VBH * 0.25],
];
const HEX_POINTS_ATTR = HEX_POINTS.map(p => p.join(',')).join(' ');
const HEX_CLIP_PATH = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

// Visual gap between adjacent tiles.
const GAP = 1.07;
// Spread missionaries on a doubled spiral so every pair has at least one
// empty hex between them. Empties between missionaries form a "halo" that
// can later host extra photos of the centred missionary.
const SPREAD = 2;

let containerEl;
let fieldEl;
let burstEl = null;
// Energy graph: vertices and edges of the (ideal) hex lattice. Lines along
// these edges are the "spaces between hexagons" the energy travels through.
let energySvg = null;
let energyVertices = new Map();  // vkey -> { x, y, key, edgeKeys[], sumX, sumY, count }
let energyEdges = new Map();     // edgeKey -> { v1Key, v2Key, line }
let tileCornerKeys = new Map();  // tile -> [6 vertex keys]
// Cluster outline: the running gold highlight traced around the combined
// perimeter of the active missionary's hexes (photo + info hexes), treated
// as one shape. Replaces the old per-hex gold borders.
let clusterSvg = null;
let clusterAnims = [];
let tiles = [];
let missionaryTiles = [];
let R = 80, pitchX, pitchY;
let lastCarouselSlug = null;
let carouselTimer = null;

export function mountHex(el) {
  containerEl = el;
  fieldEl = document.createElement('div');
  fieldEl.className = 'hex-field';
  containerEl.appendChild(fieldEl);
  // Radial energy burst element — repositioned onto the active tile.
  burstEl = document.createElement('div');
  burstEl.className = 'energy-burst';
  fieldEl.appendChild(burstEl);
  ensureDefs();
}

// One shared <svg><defs/></svg> for gradients + filters every tile references.
function ensureDefs() {
  if (document.getElementById('hex-defs')) return;
  const defs = document.createElementNS(svgNS, 'svg');
  defs.id = 'hex-defs';
  defs.setAttribute('width', '0');
  defs.setAttribute('height', '0');
  defs.style.position = 'absolute';
  defs.style.pointerEvents = 'none';
  // Shared gradients every tile's glass fill references. viewBox 0 0 100 115.47.
  defs.innerHTML = `
    <defs>
      <linearGradient id="hex-glass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="rgba(91,192,190,0.42)"/>
        <stop offset="50%"  stop-color="rgba(91,192,190,0.18)"/>
        <stop offset="100%" stop-color="rgba(91,192,190,0.04)"/>
      </linearGradient>
      <!-- Active glass tint runs 30% lighter than the original (alphas ×0.7)
           so the missionary's photo reads in natural color; the gold frame
           and glow outside the photo carry the highlight instead. -->
      <linearGradient id="hex-glass-active" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="rgba(232,196,104,0.385)"/>
        <stop offset="50%"  stop-color="rgba(232,196,104,0.154)"/>
        <stop offset="100%" stop-color="rgba(232,196,104,0.042)"/>
      </linearGradient>
      <linearGradient id="hex-glass-empty" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="rgba(91,192,190,0.16)"/>
        <stop offset="100%" stop-color="rgba(91,192,190,0.02)"/>
      </linearGradient>
    </defs>
  `;
  document.body.appendChild(defs);
}

export function buildField(missionaries) {
  fieldEl.innerHTML = '';
  tiles = [];
  missionaryTiles = [];

  R = computeR();
  pitchX = SQ3 * R * GAP;
  pitchY = 1.5 * R * GAP;

  // Doubled-spiral positions: every missionary has at least one empty hex between them.
  const positions = spiral(missionaries.length).map(p => ({ q: p.q * SPREAD, r: p.r * SPREAD }));

  for (let i = 0; i < missionaries.length; i++) {
    const { q, r } = positions[i];
    const t = createMissionaryTile(missionaries[i], q, r);
    tiles.push(t);
    missionaryTiles.push(t);
  }

  // Surround disk fills the gaps between missionaries and extends a ring or
  // two beyond the cluster so the field bleeds into the void.
  const radius = Math.max(...positions.map(p => axialDist(p, { q: 0, r: 0 }))) + 2;
  for (const cell of disk(radius)) {
    if (positions.some(p => p.q === cell.q && p.r === cell.r)) continue;
    tiles.push(createEmptyTile(cell.q, cell.r));
  }

  // Stagger materialize right→left so the field "fills in" from the rightmost cells.
  let maxX = -Infinity, minX = Infinity;
  for (const t of tiles) {
    positionTile(t);
    if (t.x > maxX) maxX = t.x;
    if (t.x < minX) minX = t.x;
  }
  const span = Math.max(1, maxX - minX);
  for (const t of tiles) {
    const norm = (maxX - t.x) / span;
    const stagger = norm * 700 + Math.abs(t.y) * 0.1;
    t.root.style.setProperty('--stagger', `${Math.max(0, stagger).toFixed(0)}ms`);
    fieldEl.appendChild(t.root);
  }

  buildEnergyGraph();

  if (missionaryTiles[0]) {
    snapFieldTo(missionaryTiles[0]);
    setActive(missionaryTiles[0]);
    applyDistanceFade(missionaryTiles[0]);
    updateEnergyFlow(missionaryTiles[0]);
    // No firePulse() here — discharge fires when the field actually appears
    // (showHex) or when a new missionary is centred (centerOnMissionary).
  }

  window.addEventListener('resize', onResize);
}

// Build a graph of vertices (hex corners, deduped) + edges (hex sides) for
// the whole field. Adjacent rendered hexes' facing corners are within ~0.12·R
// of each other; we group them by a coarse grid so they collapse to one node
// and the resulting edges visually run along the spaces between hexes.
function buildEnergyGraph() {
  if (energySvg) energySvg.remove();
  energySvg = document.createElementNS(svgNS, 'svg');
  energySvg.setAttribute('class', 'hex-energy');
  energySvg.style.position = 'absolute';
  energySvg.style.left = '0';
  energySvg.style.top = '0';
  energySvg.style.width = '1px';
  energySvg.style.height = '1px';
  energySvg.style.overflow = 'visible';
  energySvg.style.pointerEvents = 'none';

  energyVertices = new Map();
  energyEdges = new Map();
  tileCornerKeys = new Map();

  // Dedupe vertices by IDEAL (no-gap) grid position so corners shared by 3
  // tiles collapse to one node exactly. Render position is the centroid of
  // the contributing RENDERED corners — that lands in the visible gap.
  const idealPitchX = SQ3 * R;
  const idealPitchY = 1.5 * R;
  const grain = Math.max(R * 0.02, 0.5);
  const vkey = (x, y) => `${Math.round(x / grain)}|${Math.round(y / grain)}`;

  for (const tile of tiles) {
    const idealCx = (tile.q + tile.r / 2) * idealPitchX;
    const idealCy = tile.r * idealPitchY;
    const keys = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2; // top, top-right, bottom-right, bottom, bottom-left, top-left
      const ix = idealCx + R * Math.cos(angle);
      const iy = idealCy + R * Math.sin(angle);
      const rx = tile.x   + R * Math.cos(angle);
      const ry = tile.y   + R * Math.sin(angle);
      const key = vkey(ix, iy);
      let v = energyVertices.get(key);
      if (!v) {
        v = { x: rx, y: ry, key, edgeKeys: [], sumX: rx, sumY: ry, count: 1 };
        energyVertices.set(key, v);
      } else {
        v.sumX += rx; v.sumY += ry; v.count++;
        v.x = v.sumX / v.count;
        v.y = v.sumY / v.count;
      }
      keys.push(key);
    }
    tileCornerKeys.set(tile, keys);

    for (let i = 0; i < 6; i++) {
      const k1 = keys[i];
      const k2 = keys[(i + 1) % 6];
      const ek = [k1, k2].sort().join('--');
      if (!energyEdges.has(ek)) {
        // Two layers per edge: a dim "trail" wake (behind, blurred) and a
        // bright "core" head (in front, sharp+glow). Both move together;
        // the core's leading edge is aligned with the trail's leading edge.
        const trail = document.createElementNS(svgNS, 'line');
        trail.setAttribute('class', 'energy-line trail');
        trail.style.opacity = '0';
        energySvg.appendChild(trail);
        const core = document.createElementNS(svgNS, 'line');
        core.setAttribute('class', 'energy-line core');
        core.style.opacity = '0';
        energySvg.appendChild(core);
        energyEdges.set(ek, { v1Key: k1, v2Key: k2, core, trail });
        energyVertices.get(k1).edgeKeys.push(ek);
        energyVertices.get(k2).edgeKeys.push(ek);
      }
    }
  }

  // Now that all centroids are settled, write the line coordinates onto both layers.
  for (const [, e] of energyEdges) {
    const v1 = energyVertices.get(e.v1Key);
    const v2 = energyVertices.get(e.v2Key);
    const x1 = v1.x.toFixed(2), y1 = v1.y.toFixed(2);
    const x2 = v2.x.toFixed(2), y2 = v2.y.toFixed(2);
    e.core .setAttribute('x1', x1); e.core .setAttribute('y1', y1);
    e.core .setAttribute('x2', x2); e.core .setAttribute('y2', y2);
    e.trail.setAttribute('x1', x1); e.trail.setAttribute('y1', y1);
    e.trail.setAttribute('x2', x2); e.trail.setAttribute('y2', y2);
  }

  // Append AT THE END of fieldEl so the energy lines render ABOVE every
  // tile bbox (otherwise rectangular tile divs hide most of the lines that
  // run along hex edges). Lines are thin and only touch the hex perimeter,
  // so they don't significantly cover photos.
  fieldEl.appendChild(energySvg);
}

// BFS from the 6 corners of the active hex, then animate only the outward
// edges (level diff of exactly 1). Each level loses 20% intensity and shifts
// colour from gold toward cyan.
function updateEnergyFlow(activeTile) {
  if (!activeTile || !tileCornerKeys.has(activeTile)) return;
  const sourceKeys = tileCornerKeys.get(activeTile);

  const levels = new Map();
  const queue = [];
  for (const k of sourceKeys) {
    levels.set(k, 0);
    queue.push(k);
  }
  let head = 0;
  while (head < queue.length) {
    const k = queue[head++];
    const lvl = levels.get(k);
    const v = energyVertices.get(k);
    if (!v) continue;
    for (const ek of v.edgeKeys) {
      const e = energyEdges.get(ek);
      const adjK = (e.v1Key === k) ? e.v2Key : e.v1Key;
      if (!levels.has(adjK)) {
        levels.set(adjK, lvl + 1);
        queue.push(adjK);
      }
    }
  }

  for (const [, e] of energyEdges) {
    const l1 = levels.get(e.v1Key);
    const l2 = levels.get(e.v2Key);
    if (l1 == null || l2 == null || Math.abs(l1 - l2) !== 1) {
      e.core.style.opacity = '0';
      e.trail.style.opacity = '0';
      e.core.style.removeProperty('--wave-delay');
      e.trail.style.removeProperty('--wave-delay');
      continue;
    }
    const reverse = l1 > l2;
    const lower = reverse ? l2 : l1;
    const fromV = energyVertices.get(reverse ? e.v2Key : e.v1Key);
    const toV   = energyVertices.get(reverse ? e.v1Key : e.v2Key);
    const x1 = fromV.x.toFixed(2), y1 = fromV.y.toFixed(2);
    const x2 = toV.x.toFixed(2),   y2 = toV.y.toFixed(2);
    e.core .setAttribute('x1', x1); e.core .setAttribute('y1', y1);
    e.core .setAttribute('x2', x2); e.core .setAttribute('y2', y2);
    e.trail.setAttribute('x1', x1); e.trail.setAttribute('y1', y1);
    e.trail.setAttribute('x2', x2); e.trail.setAttribute('y2', y2);

    const intensity = Math.pow(0.8, lower);   // -20% per split
    const goldMix   = Math.max(0, 100 - lower * 22);
    const delay     = lower * 0.4;             // tight cascade for burst feel
    for (const l of [e.core, e.trail]) {
      l.style.setProperty('--energy-opacity', intensity.toFixed(3));
      l.style.setProperty('--gold-mix', `${goldMix}%`);
      l.style.setProperty('--wave-delay', `${delay.toFixed(2)}s`);
      l.style.opacity = '';
    }
  }
}

function applyDistanceFade(centerTile) {
  if (!centerTile) return;
  for (const t of tiles) {
    const d = axialDist({ q: t.q, r: t.r }, { q: centerTile.q, r: centerTile.r });
    if (t.isEmpty) {
      // Only the empty surround fades by distance. Person tiles stay at full
      // brightness so they don't appear to flicker as the centre moves.
      const o = Math.max(0.04, 0.26 - d * 0.025);
      t.root.style.setProperty('--dist-opacity', o.toFixed(3));
    } else {
      t.root.style.setProperty('--dist-opacity', '1');
    }
  }
  updateEnergyFlow(centerTile);
}

function positionBurst(centerTile) {
  if (!burstEl || !centerTile) return;
  burstEl.style.left = `${centerTile.x}px`;
  burstEl.style.top  = `${centerTile.y}px`;
  // Re-trigger the burst CSS animation by toggling the class.
  burstEl.classList.remove('on');
  void burstEl.offsetWidth;
  burstEl.classList.add('on');
}

// One-shot electric discharge along the BFS tree of energy edges. Each edge
// has TWO layers — a bright "core" head and a longer dim "trail" wake. The
// core's leading edge is aligned with the trail's leading edge (trail's
// dashoffset = core's offset + (trail_dash − core_dash)).
//
// Easing is cubic ease-OUT: the pulse blasts out fast and decelerates as it
// fades, giving the "burst of energy" feel rather than a smooth slide.
const ENERGY_DURATION_MS = 1600;
const ENERGY_CORE_DASH   = 18;
const ENERGY_TRAIL_DASH  = 110;
const ENERGY_DASH_FROM   = ENERGY_CORE_DASH;             // dash trailing edge just before path 0
const ENERGY_DASH_TO     = -(ENERGY_CORE_DASH + 360);    // dash fully past line end (max R ≈ 340)
const TRAIL_LAG          = ENERGY_TRAIL_DASH - ENERGY_CORE_DASH;
let energyRafId = 0;
let energyStartMs = 0;

function firePulse() {
  if (!energySvg) return;
  cancelAnimationFrame(energyRafId);
  energyStartMs = performance.now();
  // `.firing` is what flips opacity from 0 to var(--energy-opacity) per line
  // (see CSS). Without it the JS-animated dashoffset would be invisible.
  energySvg.classList.add('firing');
  for (const [, e] of energyEdges) {
    if (!e.core.style.getPropertyValue('--wave-delay')) continue;
    e.core .style.strokeDashoffset = String(ENERGY_DASH_FROM);
    e.trail.style.strokeDashoffset = String(ENERGY_DASH_FROM + TRAIL_LAG);
  }
  energyRafId = requestAnimationFrame(tickEnergy);
}

function tickEnergy(now) {
  const elapsed = now - energyStartMs;
  let stillRunning = false;
  for (const [, e] of energyEdges) {
    const delayStr = e.core.style.getPropertyValue('--wave-delay');
    if (!delayStr) continue;
    const delayMs = parseFloat(delayStr) * 1000;
    const local = elapsed - delayMs;
    if (local < 0) {
      stillRunning = true;
      continue; // still in delay phase, leave at FROM
    }
    if (local >= ENERGY_DURATION_MS) {
      e.core .style.strokeDashoffset = String(ENERGY_DASH_TO);
      e.trail.style.strokeDashoffset = String(ENERGY_DASH_TO + TRAIL_LAG);
      continue;
    }
    stillRunning = true;
    const t = local / ENERGY_DURATION_MS;
    const eased = easeOut(t);
    const off = ENERGY_DASH_FROM + (ENERGY_DASH_TO - ENERGY_DASH_FROM) * eased;
    e.core .style.strokeDashoffset = off.toFixed(1);
    e.trail.style.strokeDashoffset = (off + TRAIL_LAG).toFixed(1);
  }
  if (stillRunning) {
    energyRafId = requestAnimationFrame(tickEnergy);
  } else {
    energyRafId = 0;
  }
}

// Cubic ease-out — fast start, slow end. The "burst then decelerate" curve
// that makes the discharge read as kinetic energy rather than a slide.
function easeOut(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

function computeR() {
  // Another +50% on the previous size (≈ 2.25× the original scaffold).
  return Math.max(108, Math.min(330, Math.min(window.innerWidth, window.innerHeight) * 0.12375));
}

function onResize() {
  const ms = missionaryTiles.map(t => t.missionary);
  if (ms.length) buildField(ms);
}

function axialDist(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

function ring(k) {
  if (k === 0) return [{ q: 0, r: 0 }];
  const cells = [];
  let q = -k, r = k;
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (const [dq, dr] of dirs) {
    for (let i = 0; i < k; i++) {
      cells.push({ q, r });
      q += dq; r += dr;
    }
  }
  return cells;
}

function disk(radius) {
  const out = [];
  for (let k = 0; k <= radius; k++) out.push(...ring(k));
  return out;
}

function spiral(n) {
  const out = [];
  let k = 0;
  while (out.length < n) {
    for (const cell of ring(k)) {
      if (out.length >= n) break;
      out.push(cell);
    }
    k++;
  }
  return out;
}

function positionTile(t) {
  // Pointy-top axial → cartesian.
  t.x = (t.q + t.r / 2) * pitchX;
  t.y = t.r * pitchY;
  // Tile bounding box: width = SQ3*R, height = 2*R; centered on (t.x, t.y).
  const W = SQ3 * R, H = 2 * R;
  t.root.style.left = `${t.x - W / 2}px`;
  t.root.style.top  = `${t.y - H / 2}px`;
  t.root.style.width = `${W}px`;
  t.root.style.height = `${H}px`;
}

function snapFieldTo(tile) {
  gsap.set(fieldEl, { x: -tile.x, y: -tile.y });
}

function makeHexSvg() {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'hex-frame');
  svg.setAttribute('viewBox', `0 0 ${VBW} ${VBH.toFixed(3)}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  return svg;
}

function makePoly(cls, extraAttrs = {}) {
  const p = document.createElementNS(svgNS, 'polygon');
  p.setAttribute('points', HEX_POINTS_ATTR);
  p.setAttribute('class', cls);
  for (const [k, v] of Object.entries(extraAttrs)) p.setAttribute(k, v);
  return p;
}

function createEmptyTile(q, r) {
  const root = document.createElement('div');
  root.className = 'hex-tile empty';

  const svg = makeHexSvg();
  svg.appendChild(makePoly('glass-fill empty-fill'));
  svg.appendChild(makePoly('frame-base'));
  svg.appendChild(makePoly('frame-energy'));
  root.appendChild(svg);

  return { q, r, root, isEmpty: true };
}

function createMissionaryTile(m, q, r) {
  const root = document.createElement('div');
  root.className = 'hex-tile filled';

  // Photo layer, clipped to the pointy-top hex shape.
  const photo = document.createElement('div');
  photo.className = 'hex-photo';
  photo.style.clipPath = HEX_CLIP_PATH;
  let photoImg = null;
  if (m.bestPhoto) {
    const img = document.createElement('img');
    img.src = m.bestPhoto;
    img.alt = '';
    photo.appendChild(img);
    photoImg = img;
  } else {
    photo.classList.add('silhouette');
    photo.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><circle cx="50" cy="40" r="18"/><path d="M14 100 C14 70, 86 70, 86 100 Z"/></svg>`;
  }

  const svg = makeHexSvg();
  svg.appendChild(makePoly('glass-fill'));
  svg.appendChild(makePoly('frame-base'));
  svg.appendChild(makePoly('frame-energy'));
  svg.appendChild(makePoly('frame-glow'));
  svg.appendChild(makePoly('frame-active'));

  // Name / mission are no longer drawn around the tile edges — they appear in
  // the info hex to the left of the photo on slam (see revealInfoHexes).

  root.append(photo, svg);
  return { q, r, root, isEmpty: false, missionary: m, photo, photoImg };
}

function setActive(tile) {
  for (const t of tiles) {
    if (t.isEmpty) continue;
    t.root.classList.toggle('active', t === tile);
  }
}

export function showFrames(v) { containerEl?.classList.toggle('show-frames', !!v); }
export function showPhotos(v) { containerEl?.classList.toggle('show-photos', !!v); }
export function showNames(v)  { containerEl?.classList.toggle('show-names', !!v); }
export function showHex(v) {
  containerEl?.classList.toggle('visible', !!v);
  if (v && missionaryTiles[0]) {
    snapFieldTo(missionaryTiles[0]);
    setActive(missionaryTiles[0]);
    applyDistanceFade(missionaryTiles[0]);
    positionBurst(missionaryTiles[0]);
    firePulse();
  } else if (!v) {
    burstEl?.classList.remove('on');
    energySvg?.classList.remove('firing');
    clearInfoHexes();
  }
}

export function centerOnMissionary(slug, duration = 1.2) {
  const t = missionaryTiles.find(tile => tile.missionary.slug === slug);
  if (!t) return Promise.resolve();
  for (const x of tiles) if (!x.isEmpty) x.root.classList.remove('active');
  t.root.classList.add('arriving');
  applyDistanceFade(t);
  // Hold both the burst and the electric discharge until the new centre
  // settles, then trigger both as a single blast.
  burstEl?.classList.remove('on');
  energySvg?.classList.remove('firing');
  clearInfoHexes();
  // Pre-fetch the weather during the flight so it's ready by the slam.
  const wxPromise = (t.missionary.missionLat != null)
    ? fetchWeather(t.missionary.missionLat, t.missionary.missionLng).catch(() => null)
    : Promise.resolve(null);
  return new Promise(resolve => {
    gsap.to(fieldEl, {
      x: -t.x, y: -t.y, duration, ease: 'power3.inOut',
      onComplete: () => {
        t.root.classList.remove('arriving');
        t.root.classList.add('active');
        positionBurst(t);
        firePulse();
        revealInfoHexes(t, wxPromise);
        resolve();
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Info hexes — when the active tile slams down, the empty cells around it
// light up with the missionary's details (bio / field note / live weather),
// each decoding in with a glyph-scramble animation.

let infoTiles = [];        // currently populated empty tiles
let decodeRafIds = [];

const DECODE_GLYPHS = '█▓▒░<>/\\|=+*#%&@01';

function decodeInto(el, text, durMs = 900, delayMs = 0) {
  const start = performance.now() + delayMs;
  const len = text.length;
  function frame(now) {
    const t = (now - start) / durMs;
    if (t < 0) { decodeRafIds.push(requestAnimationFrame(frame)); return; }
    if (t >= 1) { el.textContent = text; return; }
    const solved = Math.floor(t * len);
    let out = text.slice(0, solved);
    // A short "boiling" window of scramble glyphs ahead of the solve point.
    const boil = Math.min(len - solved, 6);
    for (let i = 0; i < boil; i++) {
      out += DECODE_GLYPHS[(Math.random() * DECODE_GLYPHS.length) | 0];
    }
    el.textContent = out;
    decodeRafIds.push(requestAnimationFrame(frame));
  }
  decodeRafIds.push(requestAnimationFrame(frame));
}

function revealInfoHexes(activeTile, wxPromise) {
  const m = activeTile.missionary;
  const at = (dq, dr) => tiles.find(x =>
    x.isEmpty && x.q === activeTile.q + dq && x.r === activeTile.r + dr);

  // Anchored slots (pointy-top axial offsets from the active tile):
  //   LEFT  [-1, 0] → name + mission        RIGHT [1, 0] → country flag
  const left = at(-1, 0);
  if (left) addIdentityHex(left, m, 0);
  const right = at(1, 0);
  if (right && m.flag) addFlagHex(right, m, 120);

  // The four diagonals carry the decoded detail blocks.
  const diagOrder = [[1, -1], [0, 1], [0, -1], [-1, 1]]; // UR, LR, UL, LL
  const empties = diagOrder.map(([dq, dr]) => at(dq, dr)).filter(Boolean);
  const blocks = [];
  if (m.bio) blocks.push({ kicker: 'BIO', text: m.bio });
  if (m.fact) blocks.push({ kicker: 'FIELD NOTE', text: m.fact });
  blocks.push({ kicker: 'WEATHER', wx: true });
  blocks.slice(0, empties.length).forEach((block, i) =>
    addInfoBlock(empties[i], block, i, wxPromise));

  // Trace the running gold highlight around the whole cluster's outer edge.
  buildClusterHighlight(activeTile);
}

// ---------------------------------------------------------------------------
// Cluster perimeter highlight. The active missionary's hexes (photo + info)
// form one shape; we light only its OUTER edge with a running gold pulse and
// drop every per-hex highlight (gold cast, active border, info accent). The
// outline is traced at radius R*GAP so the corners of adjacent rendered hexes
// coincide into a clean continuous polygon hugging just outside the cluster.

// Pointy-top axial neighbour dirs → the two hex-corner indices of the edge
// facing that neighbour. Corner i sits at angle (-90 + 60*i)°.
const CLUSTER_DIRS = [
  { d: [1, 0],   e: [1, 2] }, // right
  { d: [0, 1],   e: [2, 3] }, // lower-right
  { d: [-1, 1],  e: [3, 4] }, // lower-left
  { d: [-1, 0],  e: [4, 5] }, // left
  { d: [0, -1],  e: [5, 0] }, // upper-left
  { d: [1, -1],  e: [0, 1] }, // upper-right
];

function hexCorner(cx, cy, i, rad) {
  const a = (-90 + 60 * i) * Math.PI / 180;
  return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
}

function buildClusterHighlight(activeTile) {
  clearClusterHighlight();
  const cluster = [activeTile, ...infoTiles];
  const inSet = new Set(cluster.map(t => `${t.q},${t.r}`));
  const rad = R * GAP;

  // Collect outer (boundary) edges: a hex side whose neighbour isn't in the
  // cluster. Interior (shared) edges are skipped entirely.
  const edges = [];
  for (const t of cluster) {
    for (const { d, e } of CLUSTER_DIRS) {
      if (inSet.has(`${t.q + d[0]},${t.r + d[1]}`)) continue;
      edges.push([hexCorner(t.x, t.y, e[0], rad), hexCorner(t.x, t.y, e[1], rad)]);
    }
  }
  if (!edges.length) return;

  clusterSvg = document.createElementNS(svgNS, 'svg');
  clusterSvg.setAttribute('class', 'cluster-outline');
  clusterSvg.style.cssText =
    'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;';

  for (const loop of chainLoops(edges)) {
    const d = loop.map((p, i) =>
      `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ') + ' Z';
    const base = document.createElementNS(svgNS, 'path');
    base.setAttribute('class', 'cl-base');
    base.setAttribute('d', d);
    const run = document.createElementNS(svgNS, 'path');
    run.setAttribute('class', 'cl-run');
    run.setAttribute('d', d);
    clusterSvg.append(base, run);

    // One bright comet circulating the loop: dash on for `dash`, off for the
    // rest, animated once around per cycle (seamless — period == path length).
    const len = base.getTotalLength?.() || pathLenFallback(loop);
    const dash = Math.max(len * 0.16, 160);
    run.style.strokeDasharray = `${dash.toFixed(1)} ${(len - dash).toFixed(1)}`;
    clusterAnims.push(run.animate(
      [{ strokeDashoffset: 0 }, { strokeDashoffset: -len }],
      { duration: Math.max(2000, len * 1.6), iterations: Infinity, easing: 'linear' },
    ));
  }

  fieldEl.appendChild(clusterSvg);
  containerEl.classList.add('cluster-on');
}

function pathLenFallback(loop) {
  let L = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

// Chain boundary edges into ordered closed loop(s). Shared corners coincide
// (radius R*GAP), so each vertex has degree 2 and the walk is unambiguous.
function chainLoops(edges) {
  const key = p => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  const adj = new Map();
  const pts = new Map();
  const addAdj = (k, v) => { (adj.get(k) ?? adj.set(k, []).get(k)).push(v); };
  for (const [a, b] of edges) {
    const ka = key(a), kb = key(b);
    pts.set(ka, a); pts.set(kb, b);
    addAdj(ka, kb); addAdj(kb, ka);
  }
  const eKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const usedEdge = new Set();
  const seen = new Set();
  const loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let cur = start, prev = null, guard = 0;
    do {
      loop.push(pts.get(cur));
      seen.add(cur);
      let nxt = null;
      for (const cand of adj.get(cur)) {
        if (cand === prev) continue;
        if (usedEdge.has(eKey(cur, cand))) continue;
        nxt = cand; break;
      }
      if (nxt == null) break;
      usedEdge.add(eKey(cur, nxt));
      prev = cur; cur = nxt;
    } while (cur !== start && guard++ < 2000);
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function clearClusterHighlight() {
  for (const a of clusterAnims) a.cancel?.();
  clusterAnims = [];
  clusterSvg?.remove();
  clusterSvg = null;
  containerEl?.classList.remove('cluster-on');
}

// Empty tile → decoded kicker + body (bio / field note / weather).
function addInfoBlock(tile, block, i, wxPromise) {
  const content = document.createElement('div');
  content.className = 'info-content';
  content.style.clipPath = HEX_CLIP_PATH;
  const kicker = document.createElement('div');
  kicker.className = 'info-kicker';
  const body = document.createElement('div');
  body.className = 'info-body';
  content.append(kicker, body);
  tile.root.appendChild(content);
  tile.root.classList.add('info');
  tile.root.style.setProperty('--info-delay', `${i * 180}ms`);
  infoTiles.push(tile);

  decodeInto(kicker, block.kicker, 350, i * 180);
  if (block.wx) {
    wxPromise.then(wx => {
      if (!tile.root.classList.contains('info')) return; // cleared meanwhile
      decodeInto(body, wx ? `${wx.c}°C / ${wx.f}°F\n${wx.desc}` : 'NO SIGNAL', 700, 0);
    });
  } else {
    decodeInto(body, block.text, 900, i * 180 + 250);
  }
}

// LEFT tile → identity card: name (large/bold) above mission (smaller).
function addIdentityHex(tile, m, delayMs) {
  const content = document.createElement('div');
  content.className = 'info-content identity';
  content.style.clipPath = HEX_CLIP_PATH;
  const nameEl = document.createElement('div');
  nameEl.className = 'id-name';
  const missionEl = document.createElement('div');
  missionEl.className = 'id-mission';
  content.append(nameEl, missionEl);
  tile.root.appendChild(content);
  tile.root.classList.add('info', 'info-identity');
  tile.root.style.setProperty('--info-delay', `${delayMs}ms`);
  infoTiles.push(tile);

  decodeInto(nameEl, m.name.toUpperCase(), 650, delayMs);
  decodeInto(missionEl, shortMission(m.mission).toUpperCase(), 850, delayMs + 320);
}

// RIGHT tile → country flag filling the hexagon.
function addFlagHex(tile, m, delayMs) {
  const base = import.meta.env.BASE_URL || '/';
  const wrap = document.createElement('div');
  wrap.className = 'hex-flag';
  wrap.style.clipPath = HEX_CLIP_PATH;
  const img = document.createElement('img');
  img.src = base + m.flag.replace(/^\//, '');
  img.alt = '';
  wrap.appendChild(img);
  tile.root.appendChild(wrap);
  tile.root.classList.add('info', 'info-flag');
  tile.root.style.setProperty('--info-delay', `${delayMs}ms`);
  infoTiles.push(tile);
}

export function clearInfoHexes() {
  for (const id of decodeRafIds) cancelAnimationFrame(id);
  decodeRafIds = [];
  for (const tile of infoTiles) {
    tile.root.classList.remove('info', 'info-identity', 'info-flag');
    tile.root.style.removeProperty('--info-delay');
    tile.root.querySelector('.info-content')?.remove();
    tile.root.querySelector('.hex-flag')?.remove();
  }
  infoTiles = [];
  clearClusterHighlight();
}

export function setPhotoColor(slug, amount) {
  const t = missionaryTiles.find(tile => tile.missionary.slug === slug);
  if (!t) return;
  t.root.style.setProperty('--colorize', amount);
  t.root.classList.toggle('colorize', amount > 0.05);
}

export function startCarousel(slug) {
  stopCarousel();
  lastCarouselSlug = slug;
  const t = missionaryTiles.find(tile => tile.missionary.slug === slug);
  if (!t?.photoImg) return;
  const photos = t.missionary.photos;
  if (!photos || photos.length < 2) return;
  let i = 0;
  carouselTimer = setInterval(() => {
    i = (i + 1) % photos.length;
    t.photoImg.style.opacity = '0';
    setTimeout(() => { t.photoImg.src = photos[i]; t.photoImg.style.opacity = '1'; }, 220);
  }, 1600);
}

export function stopCarousel() {
  if (carouselTimer) clearInterval(carouselTimer);
  carouselTimer = null;
  if (lastCarouselSlug) {
    const t = missionaryTiles.find(tile => tile.missionary.slug === lastCarouselSlug);
    if (t?.photoImg && t.missionary.photos[0]) {
      t.photoImg.src = t.missionary.photos[0];
      t.photoImg.style.opacity = '1';
    }
  }
  lastCarouselSlug = null;
}

// Expose for any modules that want it.
export const HEX = { PERIMETER: HEX_PERIMETER };

function stripPrefix(s) { return s.replace(/^(Elder|Sister)\s+/, m => m.trim() + ' '); }
function shortMission(s) { return s.replace(/\s+Mission$/, ''); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}
