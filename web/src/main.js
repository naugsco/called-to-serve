// Entry point — load manifest, mount globe + hex container, kick off loop.

import { state } from './state.js';
import { mountGlobe, refreshColors } from './globe.js';
import { mountHex } from './hex.js';
import { runLoop } from './loop.js';

const app = document.getElementById('app');

function initTheme() {
  const params = new URLSearchParams(location.search);
  const saved = localStorage.getItem('cts:theme');
  const initial = params.get('theme') || saved || 'light';
  applyTheme(initial);

  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const next = document.body.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('cts:theme', next); } catch {}
    });
  }
}

function applyTheme(t) {
  document.body.classList.toggle('dark', t === 'dark');
  state.theme = t;
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? 'LIGHT' : 'DARK';
  refreshColors();
}

async function main() {
  initTheme();

  const base = import.meta.env.BASE_URL || '/';
  const res = await fetch(`${base}missionaries.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Manifest load failed: HTTP ${res.status}`);
  state.data = await res.json();

  const globeRoot = document.createElement('div');
  globeRoot.id = 'globe-root';
  const hexRoot = document.createElement('div');
  hexRoot.id = 'hex-root';
  const card = document.createElement('div');
  card.id = 'closeup-card';
  app.append(globeRoot, hexRoot, card);

  mountGlobe(globeRoot);
  mountHex(hexRoot);

  globalThis.__app = { state };

  setTimeout(() => location.reload(), 6 * 60 * 60 * 1000);

  // ?freeze=1 halts the run loop for debugging — the field stays where it is.
  const params = new URLSearchParams(location.search);
  if (params.get('freeze') === '1') {
    const { buildField, showHex, showFrames, showPhotos, showNames } = await import('./hex.js');
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
