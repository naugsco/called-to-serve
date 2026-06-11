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
  // Offset paths for edge labels: 6 viewBox units outside each top/bottom edge.
  // Path directions chosen so text reads left-to-right when viewed normally.
  // viewBox is 0 0 100 115.47 (pointy-top hex).
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
      <path id="hex-edge-top-left"  d="M -3,24.54 L 47,-4.33"/>
      <path id="hex-edge-top-right" d="M 53,-4.33 L 103,24.54"/>
      <path id="hex-edge-bot-left"  d="M -3,90.93 L 47,119.80"/>
      <path id="hex-edge-bot-right" d="M 53,119.80 L 103,90.93"/>
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

  // Edge labels on the four corners — text along paths defined in hex-defs.
  const { title, surname } = splitName(m.name);
  const country = abbrevCountry(m.missionCountry || '').toUpperCase();
  const city    = (m.missionCity    || '').toUpperCase();
  addEdgeText(svg, 'hex-edge-top-left',  title.toUpperCase(),   'edge-top-left');
  addEdgeText(svg, 'hex-edge-top-right', surname.toUpperCase(), 'edge-top-right');
  addEdgeText(svg, 'hex-edge-bot-left',  country, 'edge-bot-left');
  addEdgeText(svg, 'hex-edge-bot-right', city,    'edge-bot-right');

  root.append(photo, svg);
  return { q, r, root, isEmpty: false, missionary: m, photo, photoImg };
}

function addEdgeText(svg, pathId, text, posClass) {
  if (!text) return;
  const t = document.createElementNS(svgNS, 'text');
  t.setAttribute('class', `edge-label ${posClass}`);
  t.setAttribute('text-anchor', 'middle');
  const tp = document.createElementNS(svgNS, 'textPath');
  tp.setAttribute('href', `#${pathId}`);
  tp.setAttribute('startOffset', '50%');
  tp.textContent = text;
  // Fit long labels to the path. Path is ~57.74 viewBox units; we squeeze to 46
  // so glyph compression leaves comfortable margins at both ends — empirically
  // textLength too close to the path length lets the renderer clip the leading
  // character (the "MINNEAPOLIS" → "INNEAPOLIS" bug).
  if (text.length > 9) {
    tp.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    tp.setAttribute('textLength', '46');
  }
  t.appendChild(tp);
  svg.appendChild(t);
}

function splitName(full) {
  const parts = full.split(/\s+/);
  const title = parts[0] || '';
  // Only the LAST word is the surname — middle/first names appear on the
  // closeup HUD card later, but the hex label has no room for them.
  const surname = parts[parts.length - 1] || '';
  return { title, surname };
}

// Country names longer than ~10 characters overflow the bottom-edge path.
// Shorten the few common ones — the rest are already short enough.
const COUNTRY_ABBREV = {
  'United Kingdom': 'U.K.',
  'United States': 'U.S.A.',
  'Democratic Republic of Congo': 'DR Congo',
  'Democratic Republic of the Congo': 'DR Congo',
  'New Zealand': 'N.Z.',
  'South Korea': 'S. Korea',
  'South Africa': 'S. Africa',
  'El Salvador': 'El Salv.',
  'Hong Kong': 'H.K.',
};
function abbrevCountry(name) {
  return COUNTRY_ABBREV[name] || name;
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

// Pointy-top axial neighbours.
const NEIGHBOR_DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

function revealInfoHexes(activeTile, wxPromise) {
  const m = activeTile.missionary;

  // Preferred placement order: upper-right, lower-right, upper-left,
  // lower-left, left, far-right LAST — the far-right neighbour can clip the
  // viewport edge since the active tile sits right of screen centre.
  const prefOrder = [[1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [1, 0]];
  const empties = [];
  for (const [dq, dr] of prefOrder) {
    const n = tiles.find(x => x.isEmpty && x.q === activeTile.q + dq && x.r === activeTile.r + dr);
    if (n) empties.push(n);
  }

  const blocks = [];
  if (m.bio) blocks.push({ kicker: 'BIO', text: m.bio });
  if (m.fact) blocks.push({ kicker: 'FIELD NOTE', text: m.fact });
  blocks.push({ kicker: 'WEATHER', text: '…', wx: true });

  blocks.slice(0, empties.length).forEach((block, i) => {
    const tile = empties[i];
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
  });
}

export function clearInfoHexes() {
  for (const id of decodeRafIds) cancelAnimationFrame(id);
  decodeRafIds = [];
  for (const tile of infoTiles) {
    tile.root.classList.remove('info');
    tile.root.style.removeProperty('--info-delay');
    tile.root.querySelector('.info-content')?.remove();
  }
  infoTiles = [];
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
