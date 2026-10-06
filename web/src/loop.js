// Master state machine — drives the loop end-to-end with GSAP tweens against state.
//
//   intro   spin freely
//   launch  centre Vancouver; every missionary's dot flies to their mission
//   open    once the LAST dot lands, the globe slides left and the profile opens
//   profile one missionary at a time; the globe turns to each mission
//   close   profile closes, globe recentres and spins up → loop
//
// Smoothness rules learned the hard way:
//   • NEVER hard-set state.globe.{omega, rotateLat, scale, centerX} between
//     phases — always tween. Hard sets read as visible "pops" on the kiosk.
//   • close() must return every globe parameter to intro()'s starting values
//     so the loop seam is invisible.

import gsap from 'gsap';
import { state, ensureMissionEntry } from './state.js';
import { T, SPEED, VIEW, VANCOUVER } from './timings.js';
import { spawnParticleToMission } from './globe.js';
import { openProfile, closeProfile, leaveProfile, showProfile } from './profile.js';

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
  await tweenTo(state.globe, { lambda: cur + delta, rotateLat: -lat, duration: dur, ease });
}

// opts.startAt: jump straight to that missionary (skips intro/launch).
// opts.freeze:  stop on the first missionary shown (review/debug).
export async function runLoop({ missionaries, origin, startAt = null, freeze = false }) {
  const list = missionaries.filter(m => m.missionLat != null);
  if (!list.length) throw new Error('No missionaries with mission coordinates to show');
  let first = startAt == null ? null : Math.max(0, Math.min(startAt, list.length - 1));

  while (true) {
    if (first == null) {
      state.phase = 'intro';
      await intro();
      state.phase = 'launch';
      await launch(list);
    } else {
      // Review entry (?i=N): skip the launch; light every mission directly.
      for (const m of list) ensureMissionEntry(m.missionSlug).highlighted = true;
    }
    state.phase = 'open';
    await open();
    state.phase = 'profile';
    for (let i = first ?? 0; i < list.length; i++) {
      await profile(list, i, origin);
      if (freeze) return;
      await hold(T.profileHold);   // FEED skips to the next missionary
    }
    first = null;
    state.phase = 'close';
    await close();
  }
}

async function intro() {
  // close() already tweened scale/centerX/rotateLat/omega back to these
  // values — the sets below are no-op safety nets for the FIRST iteration.
  state.globe.omega = SPEED.baseOmega;
  state.globe.scale = 1;
  state.globe.centerX = 0.5;
  state.globe.rotateLat = 0;
  clearMissionHighlights();
  await wait(T.introSpin);
}

async function launch(list) {
  await centerOn(VANCOUVER.lng, VANCOUVER.lat, T.centerVancouver);
  list.forEach((m, i) => setTimeout(() => spawnParticleToMission(m), i * T.launchStagger * 1000));
  await wait(list.length * T.launchStagger + 0.1);
  // Wait for the LAST dot to land — globe.js drops each particle on arrival.
  while (state.particles.length) await wait(0.1);
  await wait(T.afterLanding);
}

async function open() {
  openProfile();
  await tweenTo(state.globe, {
    centerX: VIEW.profileCenterX, scale: VIEW.profileScale,
    duration: T.profileOpen, ease: 'power2.inOut',
  });
}

async function profile(list, i, origin) {
  const m = list[i];
  leaveProfile();
  state.missions.activeSlug = m.missionSlug;
  centerOn(m.missionLng, m.missionLat, T.profileTurn);   // turns while the panel swaps
  await wait(T.profileSwap);
  showProfile(m, i, list, origin, T.profileHold);
}

async function close() {
  closeProfile();
  state.missions.activeSlug = null;
  await Promise.all([
    tweenTo(state.globe, {
      centerX: 0.5, scale: 1, rotateLat: 0,
      duration: T.profileClose, ease: 'power2.inOut',
    }),
    tweenTo(state.globe, { omega: SPEED.baseOmega, duration: T.profileClose * 0.65, ease: 'power2.inOut' }),
  ]);
}
