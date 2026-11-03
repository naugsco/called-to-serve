// Prospective-missionary card — rendered into the same right-hand panel as the
// serving-missionary profile (profile.js), so both acts share one frame, one set
// of entrance transitions and one cost model (opacity/transform only).
//
// loop.js drives it: openProfile() → showProspect(...) per person → leaveProfile().

import { getPanel, rosterProgress, animateRosterProgress, setProfileContent, decode, esc, url, SILHOUETTE } from './profile.js';
import { T } from './timings.js';

let scrollTimers = [];
let photoTimer = null;

const GROUP_LABEL = { YM: 'YOUNG MEN', YW: 'YOUNG WOMEN' };
const SCROLL_LINES_PER_SEC = 0.65;   // reading pace, independent of screen size

export function stopProspect() {
  scrollTimers.forEach(clearTimeout);
  scrollTimers = [];
  clearTimeout(photoTimer);
}

// A text window a few lines tall; if the text is longer it scrolls once, slowly,
// arriving at the last line shortly before the hold ends.
function scheduleScroll(panel, wrap, holdSec) {
  const text = wrap.querySelector('.pr-text');
  scrollTimers.push(setTimeout(async () => {
    await document.fonts.ready;
    if (!wrap.isConnected) return;
    const overflow = text.scrollHeight - wrap.clientHeight;
    if (overflow <= 1) return;
    wrap.classList.add('overflows');
    const available = holdSec - T.profileBioDelay - T.profileBioEndPause;
    const pxPerSec = SCROLL_LINES_PER_SEC * parseFloat(getComputedStyle(text).lineHeight);
    const duration = Math.max(1, Math.min(overflow / pxPerSec, available));
    const anim = text.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(${-overflow}px)` }],
      { duration: duration * 1000, easing: 'ease-in-out', fill: 'forwards' },
    );
    anim.onfinish = () => wrap.classList.add('at-end');
  }, T.profileBioDelay * 1000));
}

const win = (cls, label, body, style) => `
  <div class="pr-block pf-in ${cls}" style="${style}">
    <div class="pf-label">${label}</div>
    <div class="pr-win"><p class="pr-text">${esc(body)}</p><i class="pf-bio-fade"></i></div>
  </div>`;

// p: prospect record; building comes from stake.json.
export function showProspect(p, idx, list, building, holdSec) {
  const panel = getPanel();
  stopProspect();
  const photos = p.photos?.length ? p.photos : [];
  const next = list[(idx + 1) % list.length];
  const missing = '';

  setProfileContent('prospective', `
    <div class="pf-head">
      <div class="pf-photo pf-in" style="--i:0">
        ${photos.length
          ? photos.map((src, i) => `<img src="${url(src)}" alt="" class="${i === 0 ? 'on' : ''}">`).join('')
          : SILHOUETTE}
        ${photos.length > 1 ? `<div class="pf-photo-meta"><span class="pf-count">1 / ${photos.length}</span>
          <span class="pf-dots">${photos.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</span></div>` : ''}
      </div>
      <div class="pf-id">
        <h1 class="pf-name"></h1>
        <div class="pf-rule"></div>
        <div class="pf-flagrow pf-in" style="--i:2"><span>${esc(GROUP_LABEL[p.group] || 'YOUTH')}</span></div>
        <div class="pf-mission pf-in" style="--i:3">${esc(p.ward)}</div>
        <div class="pr-meets pf-in" style="--i:3">MEETS AT ${esc(building.name.toUpperCase())}</div>
      </div>
    </div>

    ${p.scripture ? win('pr-quote', 'FAVORITE SCRIPTURE', p.scripture, '--i:4') : missing}

    <div class="pr-cols">
      ${win('pr-why', 'WHY I&rsquo;M CONSIDERING A MISSION', p.why || 'Still thinking about it.', '--i:5')}
      <div class="pr-side">
        ${p.interests ? win('pr-love', 'I LOVE', p.interests, '--i:6') : missing}
        ${p.inspiration ? win('pr-inspire', 'WHO OR WHAT INSPIRES ME', p.inspiration, '--i:7') : missing}
      </div>
    </div>

    ${rosterProgress(idx, list.length, list.length > 1 ? next : null)}
  `);

  panel.classList.add('pr');
  panel.classList.remove('serving', 'returned', 'called', 'leaving', 'shown');
  void panel.offsetWidth;                       // restart the entrance transitions
  panel.classList.add('shown');
  decode(panel.querySelector('.pf-name'), p.name.replace(/-/g, '‑'), 650, 120);

  animateRosterProgress(holdSec);

  panel.querySelectorAll('.pr-win').forEach(w => scheduleScroll(panel, w, holdSec));

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
