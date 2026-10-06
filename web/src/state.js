// Shared mutable scene state. The state machine in loop.js writes to it,
// the RAF tick in globe.js reads from it.

import { SPEED } from './timings.js';

export const state = {
  data: null, // missionaries manifest
  phase: 'boot', // current loop stage — set by loop.js, read by the ?perf=1 overlay

  globe: {
    lambda: 0,           // current globe longitude rotation (deg)
    omega: SPEED.baseOmega,
    rotateLat: 0,        // vertical tilt centering (positive = look further north)
    scale: 1,            // multiplier on base scale
    centerX: 0.5,        // viewport-x fraction
    centerY: 0.5,
    landAlpha: 1,
  },

  missions: {
    // mission-slug → state
    // { highlighted: bool, excitedAt: number|null }
    byMission: new Map(),
    activeSlug: null,  // the mission currently featured in the profile panel
  },

  theme: 'light',

  particles: [],         // { interp, missionSlug, startedAt, duration, dotCount }
};

export function ensureMissionEntry(slug) {
  if (!state.missions.byMission.has(slug)) {
    state.missions.byMission.set(slug, { highlighted: false, excitedAt: null });
  }
  return state.missions.byMission.get(slug);
}
