// Closeup HUD card (Phase 4) — DOM overlay shown during state-5 closeups.

import { fetchWeather } from './weather.js';

const el = () => document.getElementById('closeup-card');

export async function showCloseup(m) {
  const card = el();
  if (!card) return;
  const photo = m.bestPhoto
    ? `<img src="${m.bestPhoto}" alt=""/>`
    : `<div class="silhouette">—</div>`;
  card.innerHTML = `
    <div class="card-frame">
      ${photo}
      <div class="card-body">
        <div class="kicker">Currently serving</div>
        <h2>${escape(m.name)}</h2>
        <div class="mission">${escape(m.mission)}</div>
        ${m.bio ? `<p class="bio">${escape(m.bio)}</p>` : ''}
        ${m.fact ? `<div class="fact"><span>FIELD NOTE</span> ${escape(m.fact)}</div>` : ''}
        <div class="weather" id="closeup-weather"><span>WEATHER</span> <em>—</em></div>
      </div>
    </div>
  `;
  card.classList.add('visible');

  const wx = await fetchWeather(m.missionLat, m.missionLng);
  const wEl = document.getElementById('closeup-weather');
  if (wEl && wx) {
    wEl.querySelector('em').textContent = `${wx.c}°C / ${wx.f}°F · ${wx.desc}`;
  }
}

export function hideCloseup() {
  const card = el();
  if (card) card.classList.remove('visible');
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}
