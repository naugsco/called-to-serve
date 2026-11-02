// Durations (seconds), speeds, and visual constants for the loop.
// Tune everything here. Pass ?fast=N in the URL to divide durations by N (dev/debug only).

const params = new URLSearchParams(globalThis.location?.search || '');
const FAST = Math.max(1, Number(params.get('fast')) || 1);
const sec = (s) => s / FAST;

export const T = {
  introSpin: sec(6),
  centerVancouver: sec(2),
  launchStagger: sec(0.22),     // between each missionary's dot leaving Vancouver
  afterLanding: sec(1.2),       // let the last landing ring finish
  profileOpen: sec(2.2),        // globe slides left as the panel opens
  profileHold: sec(14),         // time on each missionary
  profileTurn: sec(1.4),        // globe turn to the next mission
  profileSwap: sec(0.45),       // old content fades before the new one builds
  profilePhotoFirst: sec(4),    // before extra photos start cycling
  profilePhotoStep: sec(3.5),   // per extra photo
  profileBioDelay: sec(3),      // before a too-long bio starts scrolling
  profileBioEndPause: sec(1.5), // bio rests on its last line before the next missionary
  profileClose: sec(2.4),       // globe recentres as the panel closes

  // Stake tour (prospective missionaries)
  stakeZoomIn: sec(5),          // world → whole-stake view
  stakeOverview: sec(5),        // rest on the stake outline, wards and buildings
  stakeFly: sec(3.6),           // stake/building → next building
  stakeHold: sec(14),           // time on each prospective missionary
  stakeZoomOut: sec(4.5),       // last building → back out to the globe
};

export const SPEED = {
  baseOmega: 12 * FAST,     // deg / sec (globe rotation baseline)
  particleSec: 3.0 / FAST,  // particle traversal time on the globe
};

export const VIEW = {
  globeScaleBase: 0.42,   // base scale as fraction of min(w,h) — fits with margin
  profileCenterX: 0.26,   // viewport-x fraction of the globe while the profile panel is open
  profileScale: 0.95,     // globe scale while the profile panel is open
};

export const VANCOUVER = { lng: -123.1207, lat: 49.2827 };

// Camera zoom for the stake tour, as a multiple of the world-view globe scale
// (screen px per km scales with min(w,h), so these hold on any screen).
export const STAKE_VIEW = {
  center: { lng: -122.875, lat: 49.77 },   // middle of the stake boundary
  scale: 62,                               // whole stake fits the height with margin
  buildingScale: 1650,                     // ~7 km of street map around a meetinghouse
};
