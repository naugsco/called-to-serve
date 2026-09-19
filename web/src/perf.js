// ?perf=1 — on-screen performance overlay for tuning on the TV.
//
// Shows live FPS / worst frame, display + canvas resolution, JS heap (Chromium
// only) and a per-phase table so one pass through the loop tells you WHICH stage
// janks. Loaded lazily from main.js, so it isn't in the normal bundle.

import { state } from './state.js';

const JANK_MS = 33; // a frame slower than ~30 fps

export function mountPerf() {
  const el = document.createElement('pre');
  el.id = 'perf-overlay';
  el.style.cssText = [
    'position:fixed', 'left:12px', 'top:56px', 'z-index:9999', 'margin:0',
    'padding:10px 14px', 'pointer-events:none', 'white-space:pre',
    'background:rgba(0,0,0,0.78)', 'color:#7CFC9A',
    'font:600 clamp(12px,1.05vw,26px)/1.35 ui-monospace,Menlo,monospace',
  ].join(';');
  document.body.appendChild(el);

  const phases = new Map(); // name → { frames, ms, worst, jank }
  let winFrames = 0, winMs = 0, winWorst = 0;   // rolling ~1 s window
  let shownFps = 0, shownWorst = 0;
  let longTasks = 0;
  let last = performance.now();
  let lastDraw = last;
  let lastWinReset = last;

  if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    new PerformanceObserver(list => { longTasks += list.getEntries().length; })
      .observe({ entryTypes: ['longtask'] });
  }

  function frame(now) {
    const dt = now - last;
    last = now;

    let p = phases.get(state.phase);
    if (!p) phases.set(state.phase, p = { frames: 0, ms: 0, worst: 0, jank: 0 });
    p.frames++; p.ms += dt; p.worst = Math.max(p.worst, dt);
    if (dt > JANK_MS) p.jank++;

    winFrames++; winMs += dt; winWorst = Math.max(winWorst, dt);
    if (now - lastWinReset >= 1000) {
      shownFps = winFrames / (winMs / 1000);
      shownWorst = winWorst;
      winFrames = 0; winMs = 0; winWorst = 0; lastWinReset = now;
    }

    if (now - lastDraw >= 500) { lastDraw = now; render(); }
    requestAnimationFrame(frame);
  }

  function render() {
    const cv = document.getElementById('globe-canvas');
    const cw = cv ? cv.width : 0, ch = cv ? cv.height : 0;
    const mem = performance.memory
      ? `  heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}/${(performance.memory.jsHeapSizeLimit / 1048576).toFixed(0)} MB`
      : '';
    const lines = [
      `FPS ${shownFps.toFixed(0).padStart(2)}   worst ${shownWorst.toFixed(0)} ms   long-tasks ${longTasks}`,
      `view ${innerWidth}x${innerHeight} @${devicePixelRatio}x   canvas ${cw}x${ch} (${(cw * ch / 1e6).toFixed(1)} MP)${mem}`,
      `phase: ${state.phase}`,
      '',
      'PHASE          AVG FPS  WORST ms  JANK>33ms',
    ];
    for (const [name, p] of phases) {
      const fps = p.ms ? p.frames / (p.ms / 1000) : 0;
      lines.push(
        `${name.padEnd(14)} ${fps.toFixed(0).padStart(6)}  ${p.worst.toFixed(0).padStart(8)}  ${String(p.jank).padStart(5)}/${p.frames}`);
    }
    el.textContent = lines.join('\n');
  }

  requestAnimationFrame(frame);
}
