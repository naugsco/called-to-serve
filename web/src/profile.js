// Missionary profile panel — the right-hand half of the second act. One DOM
// panel, rebuilt per missionary; all motion is opacity/transform transitions
// (cheap on TV GPUs — no SVG filters, blur or masks).
//
// loop.js drives it: openProfile() → showProfile(m, i, list, holdSec) per
// missionary → closeProfile().

import { fetchWeather } from './weather.js';
import { T } from './timings.js';

const base = import.meta.env.BASE_URL || '/';
const url = p => base + String(p).replace(/^\//, '');

let panel = null;
let photoTimer = null;
let bioTimer = null;

export function mountProfile() {
  panel = document.createElement('section');
  panel.id = 'profile';
  document.body.append(panel);
}

export function openProfile()  { panel.classList.add('open'); }
export function closeProfile() {
  clearTimeout(photoTimer);
  clearTimeout(bioTimer);
  panel.classList.add('leaving');
  panel.classList.remove('open');
}
// Fade the current content out before the next missionary replaces it.
export function leaveProfile() {
  clearTimeout(photoTimer);
  clearTimeout(bioTimer);
  panel.classList.add('leaving');
}

const DECODE_GLYPHS = '█▓▒░<>/\\|=+*#%&@01';
function decode(el, text, durMs = 700, delayMs = 0) {
  const start = performance.now() + delayMs;
  const frame = now => {
    if (!el.isConnected) return;               // panel rebuilt meanwhile
    const t = (now - start) / durMs;
    if (t >= 1) { el.textContent = text; return; }
    if (t < 0) { el.textContent = ''; requestAnimationFrame(frame); return; }
    const solved = Math.floor(t * text.length);
    let out = text.slice(0, solved);
    for (let i = 0; i < Math.min(text.length - solved, 5); i++) {
      out += DECODE_GLYPHS[(Math.random() * DECODE_GLYPHS.length) | 0];
    }
    el.textContent = out;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function distanceKm(a, b) {
  const R = 6371, D = Math.PI / 180;
  const dLat = (b.lat - a.lat) * D, dLng = (b.lng - a.lng) * D;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtLat = v => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`;
const fmtLng = v => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`;
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SILHOUETTE = `<div class="silhouette"><svg viewBox="0 0 100 100"><circle cx="50" cy="40" r="18"/><path d="M14 100 C14 70, 86 70, 86 100 Z"/></svg></div>`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Serving since" from the form's start date (YYYY-MM-DD). Full-time missions
// run 24 months for elders and 18 for sisters.
function serving(m) {
  if (!m.startDate) return null;
  const [y, mo, d] = m.startDate.split('-').map(Number);
  const total = /^sister\b/i.test(m.name) ? 18 : 24;
  const now = new Date();
  const label = `${MONTHS[mo - 1]} ${y}`;
  const elapsed = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - mo) + (now.getDate() >= d ? 1 : 0);
  if (elapsed <= 0) return { label: `Starts ${label}`, sub: 'Called · not yet in the field', frac: 0 };
  if (elapsed > total) return { label, sub: `Month ${elapsed}`, frac: 1 };
  return { label, sub: `Month ${elapsed} of ${total}`, frac: elapsed / total };
}

// Bio too long for its 6-line window → scroll it once, slowly, so the last
// line is reached shortly before the hold ends. Measured AFTER the entrance
// transitions and web-font load, so the overflow height is final.
const BIO_SCROLL_PX_PER_SEC = 22;   // comfortable reading pace at TV distance
function scheduleBioScroll(holdSec) {
  const wrap = panel.querySelector('.pf-bio-wrap');
  const text = wrap.querySelector('.pf-bio');
  bioTimer = setTimeout(async () => {
    await document.fonts.ready;
    if (!wrap.isConnected) return;
    const overflow = text.scrollHeight - wrap.clientHeight;
    if (overflow <= 1) return;
    wrap.classList.add('overflows');
    // Time left after the start delay, keeping T.profileBioEndPause at the end.
    const available = holdSec - T.profileBioDelay - T.profileBioEndPause;
    const duration = Math.max(1, Math.min(overflow / BIO_SCROLL_PX_PER_SEC, available));
    const anim = text.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(${-overflow}px)` }],
      { duration: duration * 1000, easing: 'ease-in-out', fill: 'forwards' },
    );
    anim.onfinish = () => wrap.classList.add('at-end');
  }, T.profileBioDelay * 1000);
}

export function showProfile(m, idx, list, origin, holdSec) {
  clearTimeout(photoTimer);
  clearTimeout(bioTimer);
  const photos = m.photos?.length ? m.photos : [];
  const km = distanceKm(origin, { lat: m.missionLat, lng: m.missionLng });
  const where = [m.missionCity, m.missionCountry].filter(Boolean).join(', ');
  const sv = serving(m);
  const missing = '<div class="v none">Not submitted yet</div>';
  const next = list[(idx + 1) % list.length];

  panel.innerHTML = `
    <div class="pf-head">
      <div class="pf-photo pf-in" style="--i:0">
        ${photos.length
          ? photos.map((p, i) => `<img src="${url(p)}" alt="" class="${i === 0 ? 'on' : ''}">`).join('')
          : SILHOUETTE}
        ${photos.length > 1 ? `<div class="pf-photo-meta"><span class="pf-count">1 / ${photos.length}</span>
          <span class="pf-dots">${photos.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</span></div>` : ''}
      </div>
      <div class="pf-id">
        <div class="pf-kicker pf-in" style="--i:1">CURRENTLY SERVING</div>
        <h1 class="pf-name"></h1>
        <div class="pf-rule"></div>
        <div class="pf-flagrow pf-in" style="--i:2">
          ${m.flag ? `<img src="${url(m.flag)}" alt="">` : ''}
          <span>${esc((m.missionCountry || '').toUpperCase())}</span>
        </div>
        <div class="pf-mission pf-in" style="--i:3">${esc(m.mission)}</div>
      </div>
    </div>

    <div class="pf-stats pf-in" style="--i:4">
      <div class="pf-stat"><div class="pf-label">FROM HOME</div>
        <div class="v">${Math.round(km).toLocaleString()} km</div>
        <div class="s">${Math.round(km * 0.621371).toLocaleString()} mi from Vancouver</div></div>
      <div class="pf-stat"><div class="pf-label">HEADQUARTERS</div>
        <div class="v">${esc(m.missionCity || '—')}</div>
        <div class="s">${esc(m.missionCountry || '')}</div></div>
      <div class="pf-stat"><div class="pf-label">WEATHER NOW</div>
        <div class="v pf-wx">—</div><div class="s pf-wx-desc">&nbsp;</div></div>
      <div class="pf-stat"><div class="pf-label">COORDINATES</div>
        <div class="v">${fmtLat(m.missionLat)}</div>
        <div class="s">${fmtLng(m.missionLng)}</div></div>
    </div>

    <div class="pf-blocks">
      <div class="pf-block pf-in ${m.fact ? '' : 'empty'}" style="--i:5">
        <div class="pf-label">FIELD NOTE · ${esc(where.toUpperCase())}</div>
        <p>${esc(m.fact || 'No field note for this mission yet.')}</p>
      </div>
      <div class="pf-block pf-in ${m.bio ? '' : 'empty'}" style="--i:6">
        <div class="pf-label">ABOUT</div>
        <div class="pf-bio-wrap"><p class="pf-bio">${esc(m.bio || 'No bio submitted yet.')}</p><i class="pf-bio-fade"></i></div>
      </div>
    </div>

    <div class="pf-facts pf-in" style="--i:7">
      <div><div class="pf-label">SERVING SINCE</div>
        ${sv ? `<div class="v">${sv.label}</div><div class="s">${sv.sub}</div>
          <div class="pf-term"><i style="transform:scaleX(${sv.frac.toFixed(3)})"></i></div>` : missing}</div>
      <div><div class="pf-label">LANGUAGE</div>
        ${m.language ? `<div class="v">${esc(m.language)}</div>` : missing}</div>
      <div><div class="pf-label">HOME WARD</div>
        ${m.homeWard ? `<div class="v">${esc(m.homeWard)}</div>` : missing}</div>
    </div>

    <div class="pf-roster pf-in" style="--i:8">
      <div class="pf-roster-top">
        <span class="pos"><b>${String(idx + 1).padStart(2, '0')}</b> / ${String(list.length).padStart(2, '0')}</span>
        <span class="next">NEXT ▸ ${esc(next.name.toUpperCase())}</span>
      </div>
      <div class="pf-segs">
        ${list.map((_, i) => `<i class="${i < idx ? 'done' : i === idx ? 'cur' : ''}">${i === idx ? '<b></b>' : ''}</i>`).join('')}
      </div>
    </div>
  `;

  panel.classList.remove('leaving', 'shown');
  void panel.offsetWidth;                       // restart the entrance transitions
  panel.classList.add('shown');
  // Non-breaking hyphen so "Jin-Woo" never splits across lines.
  decode(panel.querySelector('.pf-name'), m.name.replace(/-/g, '‑'), 650, 120);

  // The current roster segment fills over the hold — position + time in one cue.
  const fill = panel.querySelector('.pf-segs .cur b');
  fill.style.setProperty('--hold', `${holdSec}s`);
  requestAnimationFrame(() => requestAnimationFrame(() => fill.classList.add('run')));

  fetchWeather(m.missionLat, m.missionLng).then(wx => {
    const v = panel.querySelector('.pf-wx');
    if (!v || !v.isConnected) return;
    if (wx) {
      decode(v, `${wx.c}°C / ${wx.f}°F`, 500);
      panel.querySelector('.pf-wx-desc').textContent = wx.desc;
    } else v.textContent = 'NO SIGNAL';
  });

  scheduleBioScroll(holdSec);

  // Extra photos cross-fade only after the viewer has read the header.
  if (photos.length > 1) {
    const imgs = [...panel.querySelectorAll('.pf-photo img')];
    const dots = [...panel.querySelectorAll('.pf-dots i')];
    const count = panel.querySelector('.pf-count');
    let k = 0;
    photoTimer = setTimeout(function step() {
      imgs[k].classList.remove('on'); dots[k].classList.remove('on');
      k = (k + 1) % imgs.length;
      imgs[k].classList.add('on'); dots[k].classList.add('on');
      count.textContent = `${k + 1} / ${imgs.length}`;
      photoTimer = setTimeout(step, T.profilePhotoStep * 1000);
    }, T.profilePhotoFirst * 1000);
  }
}
