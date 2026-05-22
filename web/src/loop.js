// Master state machine — drives the loop end-to-end with GSAP tweens against state.

import gsap from 'gsap';
import { state } from './state.js';
import { T, SPEED, VIEW, VANCOUVER } from './timings.js';
import { spawnParticleToMission } from './globe.js';
import * as hex from './hex.js';
import { showCloseup, hideCloseup } from './card.js';

const wait = (s) => new Promise(r => setTimeout(r, s * 1000));

function tweenTo(target, vars) {
  return new Promise(resolve => {
    gsap.to(target, { ...vars, onComplete: resolve });
  });
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
  const wasOmega = state.globe.omega;
  state.globe.omega = 0;
  await Promise.all([
    tweenTo(state.globe, { lambda: cur + delta, duration: dur, ease }),
    tweenTo(state.globe, { rotateLat: -lat, duration: dur, ease }),
  ]);
  return wasOmega;
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
  // Hold Vancouver centered while particles fly.
  state.globe.omega = 0;
  for (let i = 0; i < missionaries.length; i++) {
    const m = missionaries[i];
    if (m.missionLat == null) continue;
    setTimeout(() => spawnParticleToMission(m), i * 220);
  }
  await wait(T.vancouverBurst);
  // After the burst, resume spin.
  state.globe.omega = SPEED.baseOmega;
}

async function macroTour() {
  await wait(T.macroTour);
}

async function closeup(m) {
  state.globe.omega = 0;
  state.missions.activeSlug = m.missionSlug;
  await Promise.all([
    centerOn(m.missionLng, m.missionLat, T.closeupZoomIn, 'power3.inOut'),
    tweenTo(state.globe, { scale: VIEW.globeScaleZoom, duration: T.closeupZoomIn, ease: 'power3.inOut' }),
  ]);
  await showCloseup(m);
  await wait(T.closeupHold);
  hideCloseup();
  await tweenTo(state.globe, { scale: 1, duration: T.closeupZoomOut, ease: 'power2.inOut' });
  state.missions.activeSlug = null;
  state.globe.omega = SPEED.baseOmega;
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
  state.globe.omega = SPEED.slowOmega;
}

async function hexHighlight(m) {
  // Translate the whole hex field so this missionary's tile lands at the field center.
  // Simultaneously, rotate the globe so the missionary's mission is centered on the visible disk.
  state.missions.activeSlug = m.missionSlug;
  state.globe.omega = 0;
  await Promise.all([
    hex.centerOnMissionary(m.slug, 1.2),
    centerOn(m.missionLng, m.missionLat, 1.2, 'power2.inOut'),
  ]);
  // Photo monochrome → color for the active (center) tile.
  await tweenTo({ v: 0 }, {
    v: 1, duration: T.hexHighlightColor, ease: 'power2.out',
    onUpdate() { hex.setPhotoColor(m.slug, this.targets()[0].v); },
  });
  if (m.photos && m.photos.length > 1) hex.startCarousel(m.slug);
  await wait(T.hexHighlightHold);
  hex.stopCarousel();
  await tweenTo({ v: 1 }, {
    v: 0, duration: 0.6, ease: 'power2.in',
    onUpdate() { hex.setPhotoColor(m.slug, this.targets()[0].v); },
  });
  state.globe.omega = SPEED.slowOmega;
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
    tweenTo(state.globe, { omega: SPEED.baseOmega, duration: T.outro * 0.5, ease: 'power2.inOut' }),
  ]);
  hex.showHex(false);
}
