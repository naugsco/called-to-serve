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
let connectorsSvg = null;
let connectors = [];     // [{ line, t1, t2 }]
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
      <linearGradient id="hex-glass-active" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="rgba(232,196,104,0.55)"/>
        <stop offset="50%"  stop-color="rgba(232,196,104,0.22)"/>
        <stop offset="100%" stop-color="rgba(232,196,104,0.06)"/>
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

  // Stagger materialize right→left, plus per-tile random pulse delay/duration.
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
    // Energy pulse: per-tile randomised duration + offset so they don't sync.
    const dur = 5 + Math.random() * 6;       // 5..11 s
    const delay = -Math.random() * dur;      // negative → mid-cycle start
    t.root.style.setProperty('--energy-duration', `${dur.toFixed(2)}s`);
    t.root.style.setProperty('--energy-delay', `${delay.toFixed(2)}s`);
    fieldEl.appendChild(t.root);
  }

  buildConnectors();

  if (missionaryTiles[0]) {
    snapFieldTo(missionaryTiles[0]);
    setActive(missionaryTiles[0]);
    applyDistanceFade(missionaryTiles[0]);
    positionBurst(missionaryTiles[0]);
  }

  window.addEventListener('resize', onResize);
}

// Energy lines run between adjacent hex centres. Drawn UNDER all tiles, so
// only the slivers in the gaps between hexes are visible — exactly the
// "space between the hexagons" the user wants energy on.
function buildConnectors() {
  if (connectorsSvg) connectorsSvg.remove();
  connectorsSvg = document.createElementNS(svgNS, 'svg');
  connectorsSvg.setAttribute('class', 'hex-connectors');
  connectorsSvg.style.position = 'absolute';
  connectorsSvg.style.left = '0';
  connectorsSvg.style.top = '0';
  connectorsSvg.style.width = '1px';
  connectorsSvg.style.height = '1px';
  connectorsSvg.style.overflow = 'visible';
  connectorsSvg.style.pointerEvents = 'none';

  connectors = [];
  const tileMap = new Map(tiles.map(t => [`${t.q},${t.r}`, t]));
  // Only three of six directions, avoiding duplicates: right, lower-right, lower-left.
  const halfDirs = [[1, 0], [0, 1], [-1, 1]];
  for (const t of tiles) {
    for (const [dq, dr] of halfDirs) {
      const n = tileMap.get(`${t.q + dq},${t.r + dr}`);
      if (!n) continue;
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', t.x.toFixed(2));
      line.setAttribute('y1', t.y.toFixed(2));
      line.setAttribute('x2', n.x.toFixed(2));
      line.setAttribute('y2', n.y.toFixed(2));
      line.setAttribute('class', 'connector');
      connectorsSvg.appendChild(line);
      connectors.push({ line, t1: t, t2: n });
    }
  }
  // Insert BEFORE first tile so the lines render under the hex tiles —
  // only the gap slivers between hexes are visible.
  fieldEl.insertBefore(connectorsSvg, fieldEl.firstChild);
}

function applyDistanceFade(centerTile) {
  if (!centerTile) return;
  for (const t of tiles) {
    const d = axialDist({ q: t.q, r: t.r }, { q: centerTile.q, r: centerTile.r });
    let o;
    if (t.isEmpty) {
      o = Math.max(0.04, 0.26 - d * 0.025);
    } else {
      o = Math.max(0.48, 1 - d * 0.10);
    }
    t.root.style.setProperty('--dist-opacity', o.toFixed(3));
    // Outward wave: each tile flashes a fraction of a second after the
    // closer ones, so the burst appears to radiate from the centre.
    const waveDelay = d * 0.22;
    t.root.style.setProperty('--wave-delay', `${waveDelay.toFixed(2)}s`);
    // Energy colour gradient: stroke is gold at the centre (d=0), interpolates
    // to the accent (cyan) by ~ring 4. Drives a color-mix() in CSS.
    const goldMix = Math.max(0, 100 - d * 26);
    t.root.style.setProperty('--gold-mix', `${goldMix}%`);
  }

  // Update the connector energy lines too: each line's distance from the
  // active centre is the average of its two endpoints' distances.
  for (const c of connectors) {
    const d1 = axialDist({ q: c.t1.q, r: c.t1.r }, { q: centerTile.q, r: centerTile.r });
    const d2 = axialDist({ q: c.t2.q, r: c.t2.r }, { q: centerTile.q, r: centerTile.r });
    const dMid = (d1 + d2) / 2;
    const goldMix = Math.max(0, 100 - dMid * 24);
    const waveDelay = dMid * 0.20;
    c.line.style.setProperty('--gold-mix', `${goldMix}%`);
    c.line.style.setProperty('--wave-delay', `${waveDelay.toFixed(2)}s`);
    // Pulse direction: from the endpoint nearer the active centre to the
    // farther one, so energy reads as flowing outward.
    const reverse = d1 > d2;
    c.line.setAttribute('x1', (reverse ? c.t2.x : c.t1.x).toFixed(2));
    c.line.setAttribute('y1', (reverse ? c.t2.y : c.t1.y).toFixed(2));
    c.line.setAttribute('x2', (reverse ? c.t1.x : c.t2.x).toFixed(2));
    c.line.setAttribute('y2', (reverse ? c.t1.y : c.t2.y).toFixed(2));
  }
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

function computeR() {
  // 50% larger hexes (user request). Cluster still fits because the
  // doubled spiral leaves room and we mask soft edges of the field.
  return Math.max(72, Math.min(220, Math.min(window.innerWidth, window.innerHeight) * 0.0825));
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
  // Fit long labels to the path so they don't clip at the edge of the hex side.
  // Path length is ~57.74 viewBox units (one hex side); leave a small margin.
  if (text.length > 9) {
    tp.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    tp.setAttribute('textLength', '52');
  }
  t.appendChild(tp);
  svg.appendChild(t);
}

function splitName(full) {
  const parts = full.split(/\s+/);
  const title = parts[0] || '';
  const surname = parts.slice(1).join(' ');
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
  } else if (!v) {
    burstEl?.classList.remove('on');
  }
}

export function centerOnMissionary(slug, duration = 1.2) {
  const t = missionaryTiles.find(tile => tile.missionary.slug === slug);
  if (!t) return Promise.resolve();
  for (const x of tiles) if (!x.isEmpty) x.root.classList.remove('active');
  t.root.classList.add('arriving');
  applyDistanceFade(t);
  // Hold the burst until the new centre settles, then fire it.
  burstEl?.classList.remove('on');
  return new Promise(resolve => {
    gsap.to(fieldEl, {
      x: -t.x, y: -t.y, duration, ease: 'power3.inOut',
      onComplete: () => {
        t.root.classList.remove('arriving');
        t.root.classList.add('active');
        positionBurst(t);
        resolve();
      },
    });
  });
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
