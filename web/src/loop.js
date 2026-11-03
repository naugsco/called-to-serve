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
import { geoArea } from 'd3-geo';
import { hideUnitDetails, showLeader } from './leader.js';
import { state, ensureMissionEntry } from './state.js';
import { T, SPEED, VIEW, VANCOUVER, STAKE_VIEW } from './timings.js';
import { spawnParticleToMission } from './globe.js';
import { openProfile, closeProfile, leaveProfile, showProfile, missionaryCategory } from './profile.js';
import { showProspect, stopProspect } from './prospect.js';
import { ensureLocal } from './stake.js';

const wait = (s) => new Promise(r => setTimeout(r, s * 1000));

// Skippable hold — like wait(), but advance() resolves it early so a click on
// FEED jumps straight to the next missionary. Only one hold is ever pending.
let skipHold = null;
let skippingGroup = null;

function skipGroup(category) {
  if (skippingGroup === category) return true;
  skippingGroup = null;
  return false;
}

function hold(s, category, freeze) {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); skipHold = null; resolve(); };
    const timer = freeze ? null : setTimeout(done, s * 1000);
    skipHold = (group) => {
      if (group) skippingGroup = category;
      done();
    };
  });
}
// Wired to the FEED control in the bottom bar (see main.js).
export function advance() { skipHold?.(); }
export function advanceGroup() { skipHold?.(true); }

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
export async function runLoop({ missionaries, origin, prospects = [], leaders = [], startAt = null, freeze = false, stakeOnly = false, leaderOnly = false }) {
  const available = missionaries.filter(m => m.missionLat != null);
  if (!available.length) throw new Error('No missionaries with mission coordinates to show');
  const list = ['called', 'serving', 'returned'].flatMap(category =>
    available.filter(m => missionaryCategory(m) === category));
  const leaderOrder = ['unit', 'auxiliary', 'presidency'];
  const orderedLeaders = leaderOrder.flatMap(group => leaders.filter(leader => leader.group === group));
  let first = startAt == null ? null : list.indexOf(available[Math.max(0, Math.min(startAt, available.length - 1))]);
  const tour = (prospects.length || leaders.length) && !!state.stake.data;

  // ?act=stake — jump straight to the stake tour (review/debug).
  if ((stakeOnly || leaderOnly) && tour) {
    for (const m of list) ensureMissionEntry(m.missionSlug).highlighted = true;
    state.phase = 'open';
    await open();
    const selected = leaders[Math.max(0, startAt ?? 0)];
    const tourLeaders = leaderOnly && selected ? orderedLeaders.slice(orderedLeaders.indexOf(selected)) : orderedLeaders;
    await stakeTour(leaderOnly ? [] : prospects, tourLeaders, freeze);
    first = null;
  }

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
      const category = missionaryCategory(list[i]);
      if (skipGroup(category)) continue;
      await profile(list, i, origin);
      await hold(T.profileHold, category, freeze);
    }
    first = null;
    if (tour) {
      // The tour ends back at the world view, so it replaces close().
      await stakeTour(prospects, orderedLeaders, freeze);
    } else {
      state.phase = 'close';
      await close();
    }
    skippingGroup = null;
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

// One continuous camera move: pan, zoom and slide the globe sideways together.
//   dip   > 0 raises the camera mid-flight (a fly-over between nearby targets)
//   lead  > 0 makes the pan arrive before the zoom finishes (so a world→city
//             dive rotates to the target first, then drops in)
function flyTo({ lng, lat, scale, centerX, dur, ease = 'power2.inOut', dip = 0, lead = 0 }) {
  const g = state.globe;
  const lam0 = g.lambda, lat0 = g.rotateLat, cx0 = g.centerX, ls0 = Math.log(g.scale);
  const lam1 = lam0 + ((((-lng - lam0 + 540) % 360) + 360) % 360) - 180;
  const lat1 = -lat, ls1 = Math.log(scale);
  g.omega = 0;
  const k = { t: 0 };
  return tweenTo(k, {
    t: 1, duration: dur, ease,
    onUpdate() {
      const t = k.t;
      const p = lead ? 1 - Math.pow(1 - t, 1 + lead) : t;
      g.lambda = lam0 + (lam1 - lam0) * p;
      g.rotateLat = lat0 + (lat1 - lat0) * p;
      g.centerX = cx0 + (centerX - cx0) * t;
      g.scale = Math.exp(ls0 + (ls1 - ls0) * t - dip * Math.sin(Math.PI * t));
    },
  });
}

const kmBetween = (a, b) => {
  const D = Math.PI / 180, R = 6371;
  const dLat = (b.lat - a.lat) * D, dLng = (b.lng - a.lng) * D;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// World view → whole stake → each prospective missionary's meetinghouse → back out.
async function stakeTour(prospects, leaders, freeze = false) {
  const S = state.stake, g = state.globe;
  state.phase = 'stake';
  closeProfile();
  state.missions.activeSlug = null;
  S.activeBuilding = null;

  // 1. Dive from the globe into the stake.
  await Promise.all([
    flyTo({ ...STAKE_VIEW.center, scale: STAKE_VIEW.scale, centerX: 0.5, dur: T.stakeZoomIn, lead: 2 }),
    tweenTo(S, { overlay: 1, duration: T.stakeZoomIn * 0.45, delay: T.stakeZoomIn * 0.55 }),
  ]);
  await wait(T.stakeOverview);

  // 2. One card per person, flying to the building where their ward meets.
  let here = STAKE_VIEW.center, atOverview = true;
  for (let i = 0; i < prospects.length; i++) {
    if (skipGroup('prospective')) break;
    const p = prospects[i];
    const b = S.data.buildings.find(x => x.id === p.buildingId);
    if (!b) continue;
    state.phase = 'stake-card';
    if (S.activeBuilding !== b.id) {
      leaveProfile(); stopProspect();
      S.activeBuilding = b.id;
      const loading = ensureLocal(b.id).catch(err => console.warn('stake map:', err.message));
      const km = kmBetween(here, b);
      await flyTo({
        lng: b.lng, lat: b.lat, scale: STAKE_VIEW.buildingScale, centerX: VIEW.profileCenterX,
        dur: T.stakeFly,
        dip: atOverview ? 0 : Math.min(Math.log(STAKE_VIEW.buildingScale / STAKE_VIEW.scale) * 0.95, Math.log(1 + km / 3)),
        lead: atOverview ? 1.5 : 0,
      });
      await loading;
      here = b; atOverview = false;
    } else {
      leaveProfile(); stopProspect();
      await wait(T.profileSwap);
    }
    openProfile();
    showProspect(p, i, prospects, b, T.stakeHold);
    await hold(T.stakeHold, 'prospective', freeze);
  }

  S.leaderView = true;
  for (const leader of leaders) {
    if (skipGroup(leader.group)) continue;
    leaveProfile(); stopProspect(); hideUnitDetails();
    const building = S.data.buildings.find(b => b.id === leader.buildingId);
    const ring = S.data.territories[leader.unitId];
    const view = ring ? wardView(ring) : STAKE_VIEW;
    S.activeBuilding = building?.id ?? null;
    S.activeUnit = leader.unitId ?? null;
    state.phase = 'stake-card';
    await flyTo({ ...view.center, scale: view.scale, centerX: VIEW.profileCenterX, dur: T.stakeFly });
    openProfile();
    const sphere = ring ? geoArea({ type: 'Polygon', coordinates: [ring] }) : 0;
    const area = Math.min(sphere, 4 * Math.PI - sphere) * 6371 ** 2;
    showLeader(leader, building, area, T.stakeHold);
    await hold(T.stakeHold, leader.group, freeze);
  }
  hideUnitDetails();
  S.activeUnit = null;
  S.leaderView = false;

  // 3. Back out to the globe, ready for the intro spin.
  state.phase = 'stake-out';
  leaveProfile(); stopProspect();
  closeProfile();
  await Promise.all([
    flyTo({ lng: -g.lambda, lat: 0, scale: 1, centerX: 0.5, dur: T.stakeZoomOut }),
    tweenTo(S, { overlay: 0, duration: T.stakeZoomOut * 0.5 }),
  ]);
  S.activeBuilding = null;
  await tweenTo(g, { omega: SPEED.baseOmega, duration: 1.2, ease: 'power2.inOut' });
}

function wardView(ring) {
  const lngs = ring.map(([lng]) => lng);
  const lats = ring.map(([, lat]) => lat);
  const lng = (Math.max(...lngs) + Math.min(...lngs)) / 2;
  const lat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const width = (Math.max(...lngs) - Math.min(...lngs)) * Math.cos(lat * Math.PI / 180);
  const height = Math.max(...lats) - Math.min(...lats);
  return { center: { lng, lat }, scale: Math.min(450, 74 / Math.max(width, height)) };
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
