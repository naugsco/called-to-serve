import { decode, esc, getPanel, setProfileContent, SILHOUETTE, url } from './profile.js';
import { koreanOrigin, membershipSnapshot } from './unit-stats.js';
import { fetchWeather } from './weather.js';

let details;

export function hideUnitDetails() {
  details?.remove();
  details = null;
}

export function showLeader(leader, building, area, holdSec) {
  const panel = getPanel();
  const fields = [
    ['Birthplace', leader.birthplace], ['Favorite scripture', leader.scripture],
    ['Hobbies', leader.hobbies], ['Family', leader.family], ['Favorite hymn', leader.hymn],
  ].filter(([, answer]) => answer);
  setProfileContent(leader.group, `
    <div class="pf-head">
      <div class="pf-photo pf-in" style="--i:0">${leader.bestPhoto
        ? `<img class="on" src="${esc(url(leader.bestPhoto))}" alt="">` : SILHOUETTE}</div>
      <div class="pf-id">
        <h1 class="pf-name"></h1>
        <div class="pf-rule"></div>
        <div class="pf-kicker pf-in" style="--i:1">${esc(leader.role.toUpperCase())}</div>
        <div class="pf-mission pf-in" style="--i:2">${esc(leader.ward || 'Vancouver BC Stake')}</div>
        ${leader.mission ? `<div class="pf-flagrow pf-in" style="--i:3">${leader.flag
          ? `<img src="${esc(url(leader.flag))}" alt="${esc(leader.missionCountry)}">` : ''}
          <span>Served in ${esc(leader.mission)}</span></div>` : ''}
      </div>
    </div>
    <div class="pf-blocks leader-fields pf-in" style="--i:4"><div class="leader-grid">
      ${fields.map(([label, answer]) =>
        `<div><div class="pf-label">${label}</div><p>${esc(answer)}</p></div>`).join('')}
    </div></div>`);

  panel.classList.remove('pr', 'serving', 'returned', 'called', 'leaving', 'shown');
  void panel.offsetWidth;
  panel.classList.add('shown');
  decode(panel.querySelector('.pf-name'), leader.name);

  const block = panel.querySelector('.leader-fields');
  const overflow = block.scrollHeight - block.clientHeight;
  if (overflow > 0) block.firstElementChild.animate(
    [{ transform: 'translateY(0)' }, { transform: `translateY(-${overflow}px)` }],
    { duration: holdSec * 700, delay: holdSec * 150, fill: 'forwards' },
  );

  if (!building) return;
  const note = document.createElement('aside');
  note.className = 'unit-details';
  const count = membershipSnapshot.counts[leader.unitId];
  note.innerHTML = `
    <div class="pf-label">MEETINGHOUSE</div>
    <strong>${esc(building.name)}</strong>
    <div>${esc(building.address)}</div>
    ${area ? `<div>Mapped area · ≈ ${Math.round(area).toLocaleString()} km²</div>` : ''}
    ${Number.isInteger(count) ? `<div>${count.toLocaleString()} unit members · StakeOS, ${membershipSnapshot.date}</div>` : ''}
    ${leader.unitId === 'vancouver-5' ? `<div>${koreanOrigin}</div>` : ''}
    <div class="unit-weather"></div>`;
  document.body.append(note);
  details = note;
  fetchWeather(building.lat, building.lng).then(weather => {
    if (note.isConnected && Number.isFinite(weather?.c)) {
      note.querySelector('.unit-weather').textContent = `${weather.c} °C · ${weather.desc}`;
    }
  });
}
