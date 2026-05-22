// Shared mutable scene state. The state machine in loop.js writes to it,
// the RAF tick in globe.js reads from it.

import { SPEED } from './timings.js';

export const state = {
  data: null, // missionaries manifest

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
    activeSlug: null,  // the mission currently being featured (closeup or hex highlight)
  },

  theme: 'light',

  particles: [],         // { fromLng, fromLat, toLng, toLat, t, duration, missionSlug, dotCount }

  closeup: {
    visible: false,
    missionary: null,    // full missionary object
    weatherText: null,
    opacity: 0,
  },

  hex: {
    visible: false,
    materialize: 0,      // 0..1 — drives grid + frame fade-in
    photoReveal: 0,      // 0..1 — drives photo materialization (cyan-green stage)
    nameReveal: 0,       // 0..1 — names + mission fade-in
    activeSlug: null,    // which missionary is currently highlighted
    perimeterT: 0,       // 0..1 — perimeter trace progress on active tile
    colorBySlug: new Map(), // slug → 0..1 mono→color amount
    carouselIndex: new Map(), // slug → current photo index for active highlight
  },
};

export function ensureMissionEntry(slug) {
  if (!state.missions.byMission.has(slug)) {
    state.missions.byMission.set(slug, { highlighted: false, excitedAt: null });
  }
  return state.missions.byMission.get(slug);
}
