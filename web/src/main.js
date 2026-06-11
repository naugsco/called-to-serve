// Entry point — load manifest, mount globe + hex container, kick off loop.

import { state } from './state.js';
import { mountGlobe, refreshColors, setGlobe3DSync } from './globe.js';
import { mountHex } from './hex.js';
import { runLoop } from './loop.js';

const app = document.getElementById('app');

const THEME_CYCLE = ['light', 'dark', 'color'];
let globeRoot = null;
let globe3dModule = null; // lazy-loaded ./globe3d.js

function nextTheme(cur) {
  return THEME_CYCLE[(THEME_CYCLE.indexOf(cur) + 1) % THEME_CYCLE.length];
}

async function applyTheme(t) {
  document.body.classList.toggle('dark', t === 'dark' || t === 'color');
  document.body.classList.toggle('color', t === 'color');
  state.theme = t;
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = nextTheme(t).toUpperCase();
  refreshColors();

  if (t === 'color') {
    // Lazy-load three.js + the shader globe only when color mode activates.
    if (!globe3dModule) {
      globe3dModule = await import('./globe3d.js');
    }
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
  const saved = localStorage.getItem('cts:theme');
  let initial = params.get('theme') || saved || 'light';
  if (!THEME_CYCLE.includes(initial)) initial = 'light';
  applyTheme(initial);

  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const next = nextTheme(state.theme);
      applyTheme(next);
      try { localStorage.setItem('cts:theme', next); } catch {}
    });
  }

  // Hidden feature: clicking the word SERVE in the brand toggles the
  // old-world antique map. No visual affordance on purpose.
  const word = document.getElementById('antique-word');
  if (word) {
    word.addEventListener('click', () => {
      const on = document.body.classList.toggle('antique');
      try { localStorage.setItem('cts:antique', on ? '1' : '0'); } catch {}
      refreshColors();
    });
  }
  if ((params.get('antique') ?? localStorage.getItem('cts:antique')) === '1') {
    document.body.classList.add('antique');
    refreshColors();
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
