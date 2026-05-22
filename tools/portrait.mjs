// Procedural SVG portraits for sample missionaries.
// Produces a colorful avatar with initials. Will be replaced by real Drive photos
// once Google Sheets sync is wired up.

const PALETTES = [
  ['#2c5f5d', '#e8c468'],
  ['#7a4e2d', '#f4a261'],
  ['#3a506b', '#5bc0be'],
  ['#6a4c93', '#f7b801'],
  ['#1d3557', '#e63946'],
  ['#264653', '#e9c46a'],
  ['#bc4749', '#f2e8cf'],
  ['#386641', '#a7c957'],
];

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name) {
  return name
    .replace(/^(Elder|Sister)\s+/i, '')
    .split(/\s+/)
    .map(p => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function portraitSvg(name, variant = 0) {
  const h = hashString(name + variant);
  const [bg, fg] = PALETTES[h % PALETTES.length];
  const init = initials(name);
  const rotate = ((h >> 3) % 12) - 6; // -6..+5 deg jitter so multi-photo variants differ
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="g${h}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${shade(bg, -20)}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#g${h})"/>
  <g transform="rotate(${rotate} 200 200)">
    <circle cx="200" cy="160" r="70" fill="${fg}" opacity="0.92"/>
    <path d="M80 380 C80 280, 320 280, 320 380 Z" fill="${fg}" opacity="0.92"/>
  </g>
  <text x="200" y="225" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="700"
        font-size="84" fill="${bg}" opacity="0.85" letter-spacing="6">${init}</text>
</svg>`;
}

function shade(hex, percent) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + Math.round(255 * percent / 100)));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + Math.round(255 * percent / 100)));
  const b = Math.min(255, Math.max(0, (n & 0xff) + Math.round(255 * percent / 100)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
