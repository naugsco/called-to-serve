// Entry point — load manifest, mount globe + profile panel, kick off loop.

import { state } from './state.js';
import { mountGlobe, refreshColors } from './globe.js';
import { mountProfile } from './profile.js';
import { runLoop, advance } from './loop.js';

const app = document.getElementById('app');

// The toggle button cycles the three map styles.
const THEME_CYCLE = ['light', 'dark', 'antique'];
const THEME_LABEL = { light: 'LIGHT', dark: 'DARK', antique: 'OLD WORLD' };
let theme = 'light';

function nextTheme(cur) {
  return THEME_CYCLE[(THEME_CYCLE.indexOf(cur) + 1) % THEME_CYCLE.length];
}

function applyState() {
  document.body.classList.toggle('dark', theme === 'dark');
  document.body.classList.toggle('antique', theme === 'antique');
  state.theme = theme;

  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = THEME_LABEL[nextTheme(theme)];
  refreshColors();
}

function initTheme() {
  const params = new URLSearchParams(location.search);
  const savedTheme = params.get('theme') || localStorage.getItem('cts:theme') || 'light';
  theme = THEME_CYCLE.includes(savedTheme) ? savedTheme : 'light';
  applyState();

  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      theme = nextTheme(theme);
      try { localStorage.setItem('cts:theme', theme); } catch {}
      applyState();
    });
  }

  // FEED acts as a manual advance — skip the current hold and jump to the next
  // missionary. Handy for testing and for stepping through on demand.
  const feed = document.getElementById('feed-advance');
  if (feed) feed.addEventListener('click', () => advance());
}

async function main() {
  const base = import.meta.env.BASE_URL || '/';
  const res = await fetch(`${base}missionaries.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Manifest load failed: HTTP ${res.status}`);
  state.data = await res.json();

  const globeRoot = document.createElement('div');
  globeRoot.id = 'globe-root';
  app.append(globeRoot);

  initTheme();
  mountGlobe(globeRoot);
  mountProfile();

  // ?perf=1 — FPS / resolution / per-phase overlay for tuning on the TV.
  if (new URLSearchParams(location.search).get('perf') === '1') {
    (await import('./perf.js')).mountPerf();
  }

  globalThis.__app = { state };

  setTimeout(() => location.reload(), 6 * 60 * 60 * 1000);

  // Review/debug: ?i=N jumps straight to missionary N's profile (skipping the
  // launch); ?freeze=1 stops on it. ?freeze=1 alone freezes on the first.
  const params = new URLSearchParams(location.search);
  const freeze = params.get('freeze') === '1';
  const startAt = params.has('i') ? Number(params.get('i')) || 0 : (freeze ? 0 : null);
  runLoop({
    missionaries: state.data.missionaries,
    origin: state.data.origin,
    startAt,
    freeze,
  });
}

main().catch(err => {
  console.error(err);
  app.innerHTML = `<pre style="padding:2rem;color:#a00">${String(err.stack || err)}</pre>`;
});
