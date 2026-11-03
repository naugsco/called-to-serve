// Entry point — load manifest, mount globe + profile panel, kick off loop.

import { state } from './state.js';
import { mountGlobe, refreshColors } from './globe.js';
import { mountProfile } from './profile.js';
import { runLoop, advance, advanceGroup } from './loop.js';
import { loadStake } from './stake.js';
import { chooseProspects } from './examples.js';

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
  if (feed) feed.addEventListener('click', advance);
  document.getElementById('group-advance')?.addEventListener('click', advanceGroup);
}

async function main() {
  const base = import.meta.env.BASE_URL || '/';
  const res = await fetch(`${base}missionaries.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Manifest load failed: HTTP ${res.status}`);
  state.data = await res.json();
  if (new URLSearchParams(location.search).get('sample') === '1') {
    const sample = await fetch(`${base}returned.sample.json`);
    if (sample.ok) state.data.missionaries.push(await sample.json());
    const called = await fetch(`${base}called.sample.json`);
    if (called.ok) state.data.missionaries.push(await called.json());
  }

  // Prospective missionaries + the stake map. Example cards stand in until the
  // form's first submission (see examples.js); ?sample=1 forces them for review.
  let prospects = [];
  let leaders = [];
  try {
    const readJson = async name => {
      try {
        const r = await fetch(`${base}${name}`, { cache: 'no-cache' });
        return r.ok ? await r.json() : null;
      } catch { return null; }
    };
    const forced = new URLSearchParams(location.search).get('sample') === '1';
    const real = forced ? { submissions: 0 } : await readJson('prospective.json');
    const examples = real?.submissions === 0 ? await readJson('prospective.sample.json') : null;
    prospects = chooseProspects(real, examples);
    const leadership = await readJson(forced ? 'leaders.sample.json' : 'leaders.json');
    leaders = leadership?.leaders ?? [];
    if (prospects.length || leaders.length) await loadStake();
  } catch (err) {
    console.warn('stake tour unavailable:', err.message);
    prospects = [];
  }

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
  const sampleStatus = params.get('sample') === '1' ? params.get('status') : null;
  const sampleIndex = state.data.missionaries.findIndex(m =>
    (sampleStatus === 'called' && m.newlyCalled) ||
    (sampleStatus === 'returned' && m.returnDate) ||
    (sampleStatus === 'serving' && !m.newlyCalled && !m.returnDate));
  const startAt = sampleIndex >= 0 ? sampleIndex : params.has('i') ? Number(params.get('i')) || 0 : (freeze ? 0 : null);
  await runLoop({
    missionaries: state.data.missionaries,
    origin: state.data.origin,
    prospects,
    leaders,
    leaderOnly: params.get('act') === 'leaders',
    stakeOnly: params.get('act') === 'stake',
    startAt,
    freeze,
  });
}

main().catch(err => {
  console.error(err);
  app.innerHTML = `<pre style="padding:2rem;color:#a00">${String(err.stack || err)}</pre>`;
});
