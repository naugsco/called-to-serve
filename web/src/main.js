// Entry point — load manifest, mount globe + hex container, kick off loop.

import { state } from './state.js';
import { mountGlobe, refreshColors, setGlobe3DSync } from './globe.js';
import { mountHex } from './hex.js';
import { runLoop } from './loop.js';

const app = document.getElementById('app');

// The visible toggle button cycles the three "map" styles. The COLOR 3D globe
// is intentionally NOT in this list — it's the hidden gem, revealed by
// clicking the word SERVE in the brand.
const THEME_CYCLE = ['light', 'dark', 'antique'];
const THEME_LABEL = { light: 'LIGHT', dark: 'DARK', antique: 'OLD WORLD' };
let theme = 'light';   // light | dark | antique  (driven by the toggle button)
let colorOn = false;   // 3D globe overlay        (driven by clicking SERVE)
let globeRoot = null;
let globe3dModule = null; // lazy-loaded ./globe3d.js

function nextTheme(cur) {
  return THEME_CYCLE[(THEME_CYCLE.indexOf(cur) + 1) % THEME_CYCLE.length];
}

// Single source of truth: paint body classes + manage the 3D globe from the
// current { theme, colorOn } state. COLOR wins over the map style while on.
async function applyState() {
  document.body.classList.toggle('color', colorOn);
  // Color rides on the dark chrome palette (deep-space background).
  document.body.classList.toggle('dark', colorOn || theme === 'dark');
  document.body.classList.toggle('antique', !colorOn && theme === 'antique');
  state.theme = colorOn ? 'color' : theme;

  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = THEME_LABEL[nextTheme(theme)];
  refreshColors();

  if (colorOn) {
    // Lazy-load three.js + the shader globe only when color mode activates.
    if (!globe3dModule) globe3dModule = await import('./globe3d.js');
    if (!document.getElementById('globe3d-canvas') && globeRoot) {
      // Insert BEFORE the 2D canvas so overlays paint on top.
      const cv = globe3dModule.mountGlobe3D(globeRoot);
      globeRoot.insertBefore(cv, globeRoot.firstChild);
    }
    setGlobe3DSync(globe3dModule.syncGlobe3D);
  } else {
    setGlobe3DSync(null);
    if (globe3dModule && document.getElementById('globe3d-canvas')) {
      globe3dModule.disposeGlobe3D();
    }
  }
}

function initTheme() {
  const params = new URLSearchParams(location.search);
  const savedTheme = params.get('theme') || localStorage.getItem('cts:theme') || 'light';
  theme = THEME_CYCLE.includes(savedTheme) ? savedTheme : 'light';
  colorOn = (params.get('color') ?? localStorage.getItem('cts:color')) === '1';
  applyState();

  // Toggle button: step through light → dark → old world. Always leaves the
  // hidden color globe (the button is for the normal map styles).
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      colorOn = false;
      theme = nextTheme(theme);
      try {
        localStorage.setItem('cts:theme', theme);
        localStorage.setItem('cts:color', '0');
      } catch {}
      applyState();
    });
  }

  // Hidden feature: clicking the word SERVE toggles the COLOR 3D globe.
  const word = document.getElementById('antique-word');
  if (word) {
    word.addEventListener('click', () => {
      colorOn = !colorOn;
      try { localStorage.setItem('cts:color', colorOn ? '1' : '0'); } catch {}
      applyState();
    });
  }
}

async function main() {
  const base = import.meta.env.BASE_URL || '/';
  const res = await fetch(`${base}missionaries.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Manifest load failed: HTTP ${res.status}`);
  state.data = await res.json();

  globeRoot = document.createElement('div');
  globeRoot.id = 'globe-root';
  const hexRoot = document.createElement('div');
  hexRoot.id = 'hex-root';
  const card = document.createElement('div');
  card.id = 'closeup-card';
  app.append(globeRoot, hexRoot, card);

  initTheme();
  mountGlobe(globeRoot);
  mountHex(hexRoot);

  globalThis.__app = { state };

  setTimeout(() => location.reload(), 6 * 60 * 60 * 1000);

  // ?freeze=1 halts the run loop for debugging — the field stays where it is.
  const params = new URLSearchParams(location.search);
  if (params.get('freeze') === '1') {
    const hexModule = await import('./hex.js');
    const { buildField, showHex, showFrames, showPhotos, showNames } = hexModule;
    globalThis.__hex = hexModule; // debug access to the live module instance
    buildField(state.data.missionaries);
    showHex(true); showFrames(true); showPhotos(true); showNames(true);
    state.globe.centerX = 0.22;
    state.globe.scale = 0.9;
    state.globe.omega = 0;
    return;
  }
  runLoop({ missionaries: state.data.missionaries });
}

main().catch(err => {
  console.error(err);
  app.innerHTML = `<pre style="padding:2rem;color:#a00">${String(err.stack || err)}</pre>`;
});
