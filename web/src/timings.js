// Durations (seconds), speeds, and visual constants for the loop.
// Tune everything here. Pass ?fast=N in the URL to divide durations by N (dev/debug only).

const params = new URLSearchParams(globalThis.location?.search || '');
const FAST = Math.max(1, Number(params.get('fast')) || 1);
const sec = (s) => s / FAST;

export const T = {
  introSpin: sec(12),
  vancouverBurst: sec(8),
  macroTour: sec(10),
  closeupZoomIn: sec(2.2),
  closeupHold: sec(11),
  closeupZoomOut: sec(1.6),
  globeToLeft: sec(4),
  hexMaterialize: sec(4),
  hexHighlightTrace: sec(1.4),
  hexHighlightColor: sec(1.0),
  hexHighlightHold: sec(4),
  hexHighlightCarouselStep: sec(1.6),
  outro: sec(6),
};

export const SPEED = {
  baseOmega: 12 * FAST,     // deg / sec (globe rotation baseline)
  slowOmega: 4 * FAST,      // when hex grid is active
  particleSec: 3.0 / FAST,  // particle traversal time on the globe
};

export const VIEW = {
  globeScaleBase: 0.42,   // base scale as fraction of min(w,h) — fits with margin
  globeScaleZoom: 1.6,    // closeup zoom multiplier
  halfCenterX: 0.22,      // viewport-x fraction when globe shifts left (gives hex grid more room)
};

export const VANCOUVER = { lng: -123.1207, lat: 49.2827 };
