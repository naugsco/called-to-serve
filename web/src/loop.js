// Master state machine — drives the loop end-to-end with GSAP tweens against state.
//
// Smoothness rules learned the hard way:
//   • NEVER hard-set state.globe.{omega, rotateLat, scale, centerX} between
//     phases — always tween. Hard sets read as visible "pops" on the kiosk.
//   • outro() must return every globe parameter to introSpin()'s starting
//     values so the loop seam is invisible.

import gsap from 'gsap';
import { state } from './state.js';
import { T, SPEED, VIEW, VANCOUVER } from './timings.js';
import { spawnParticleToMission } from './globe.js';
import * as hex from './hex.js';
import { showCloseup, hideCloseup } from './card.js';

const wait = (s) => new Promise(r => setTimeout(r, s * 1000));

// Skippable hold — like wait(), but advance() resolves it early so a click on
// FEED jumps straight to the next missionary. Only one hold is ever pending.
let skipHold = null;
function hold(s) {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); skipHold = null; resolve(); };
    const timer = setTimeout(done, s * 1000);
    skipHold = done;
  });
}
// Wired to the FEED control in the bottom bar (see main.js).
export function advance() { skipHold?.(); }

function tweenTo(target, vars) {
  return new Promise(resolve => {
    gsap.to(target, { ...vars, onComplete: resolve });
  });
}

// Ease rotation speed instead of stepping it — kills the "rotation pop".
function tweenOmega(target, dur = 1.2) {
  return tweenTo(state.globe, { omega: target, duration: dur, ease: 'power2.inOut' });
}

function clearMissionHighlights() {
  for (const entry of state.missions.byMission.values()) {
    entry.highlighted = false;
    entry.excitedAt = null;
  }
  state.missions.activeSlug = null;
}

// Center projection on a (lng, lat). Pauses rotation while tweening.
async function centerOn(lng, lat, dur, ease = 'power2.inOut') {
  const target = -lng;
  const cur = state.globe.lambda;
  const delta = ((target - cur + 540) % 360) - 180; // shortest path
  state.globe.omega = 0; // tick stops adding; the lambda tween takes over seamlessly
  await Promise.all([
    tweenTo(state.globe, { lambda: cur + delta, duration: dur, ease }),
    tweenTo(state.globe, { rotateLat: -lat, duration: dur, ease }),
  ]);
}

export async function runLoop({ missionaries }) {
  // Pre-build the hex field once. Field is shown/hidden, not rebuilt each loop.
  hex.buildField(missionaries);
  while (true) {
    await introSpin();
    await vancouverBurst(missionaries);
    await macroTour();
    for (const m of missionaries) {
      if (m.missionLat == null) continue;
      await closeup(m);
    }
    await globeToLeft();
    await hexMaterialize();
    for (const m of missionaries) {
      if (m.missionLat == null) continue;
      await hexHighlight(m);
    }
    await outro();
  }
}

async function introSpin() {
  // outro() already tweened scale/centerX/rotateLat/omega back to these
  // values — the sets below are no-op safety nets for the FIRST iteration
  // (or a mid-loop hot reload), not transitions.
  state.globe.omega = SPEED.baseOmega;
  state.globe.scale = 1;
  state.globe.centerX = 0.5;
  state.globe.rotateLat = 0;
  hex.showHex(false);
  hideCloseup();
  clearMissionHighlights();
  await wait(T.introSpin);
}

async function vancouverBurst(missionaries) {
  // Center Vancouver dead-center, stop spinning, then launch particles outward.
  await centerOn(VANCOUVER.lng, VANCOUVER.lat, 2.0);
  for (let i = 0; i < missionaries.length; i++) {
    const m = missionaries[i];
    if (m.missionLat == null) continue;
    setTimeout(() => spawnParticleToMission(m), i * 220);
  }
  await wait(T.vancouverBurst);
  // Ease back up to cruise speed rather than snapping.
  await tweenOmega(SPEED.baseOmega, 1.4);
}

async function macroTour() {
  await wait(T.macroTour);
}

async function closeup(m) {
  state.missions.activeSlug = m.missionSlug;
  await Promise.all([
    centerOn(m.missionLng, m.missionLat, T.closeupZoomIn, 'power3.inOut'),
    tweenTo(state.globe, { scale: VIEW.globeScaleZoom, duration: T.closeupZoomIn, ease: 'power3.inOut' }),
  ]);
  await showCloseup(m);
  await hold(T.closeupHold);   // FEED skips to the next mission
  hideCloseup();
  await tweenTo(state.globe, { scale: 1, duration: T.closeupZoomOut, ease: 'power2.inOut' });
  state.missions.activeSlug = null;
  await tweenOmega(SPEED.baseOmega, 1.0);
}

async function globeToLeft() {
  await Promise.all([
    tweenTo(state.globe, { centerX: VIEW.halfCenterX, duration: T.globeToLeft, ease: 'power2.inOut' }),
    tweenTo(state.globe, { scale: 0.9, duration: T.globeToLeft, ease: 'power2.inOut' }),
  ]);
}

async function hexMaterialize() {
  hex.showHex(true);
  // Force layout pass so initial-state transitions kick in after class flips.
  void document.getElementById('hex-root').offsetWidth;
  hex.showFrames(true);
  await wait(T.hexMaterialize * 0.45);
  hex.showPhotos(true);
  await wait(T.hexMaterialize * 0.35);
  hex.showNames(true);
  await wait(T.hexMaterialize * 0.2);
  await tweenOmega(SPEED.slowOmega, 1.0);
}

async function hexHighlight(m) {
  // Translate the whole hex field so this missionary's tile lands at the field center.
  // Simultaneously, rotate the globe so the missionary's mission is centered on the visible disk.
  state.missions.activeSlug = m.missionSlug;
  await Promise.all([
    hex.centerOnMissionary(m.slug, 1.2),
    centerOn(m.missionLng, m.missionLat, 1.2, 'power2.inOut'),
  ]);
  // Photo monochrome → color for the active (center) tile.
  await tweenTo({ v: 0 }, {
    v: 1, duration: T.hexHighlightColor, ease: 'power2.out',
    onUpdate() { hex.setPhotoColor(m.slug, this.targets()[0].v); },
  });
  // Extra photos cross-fade in their own gallery hex (built on slam), so the
  // main portrait stays put while the missionary is on screen.
  await hold(T.hexHighlightHold);   // FEED skips to the next mission
  await tweenTo({ v: 1 }, {
    v: 0, duration: 0.6, ease: 'power2.in',
    onUpdate() { hex.setPhotoColor(m.slug, this.targets()[0].v); },
  });
  await tweenOmega(SPEED.slowOmega, 0.8);
}

async function outro() {
  state.missions.activeSlug = null;
  hex.showNames(false);
  await wait(T.outro * 0.15);
  hex.showPhotos(false);
  await wait(T.outro * 0.2);
  hex.showFrames(false);
  await Promise.all([
    tweenTo(state.globe, { centerX: 0.5, scale: 1, duration: T.outro * 0.7, ease: 'power2.inOut' }),
    // rotateLat back to equator-view here — otherwise introSpin()'s hard
    // reset visibly snapped the globe from the last mission's latitude.
    tweenTo(state.globe, { rotateLat: 0, duration: T.outro * 0.7, ease: 'power2.inOut' }),
    tweenTo(state.globe, { omega: SPEED.baseOmega, duration: T.outro * 0.5, ease: 'power2.inOut' }),
  ]);
  hex.showHex(false);
}
