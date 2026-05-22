// Open-Meteo — no key, CORS-friendly. Cached in localStorage for 30 min.

const TTL_MS = 30 * 60 * 1000;

const WMO = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
  95: 'Thunderstorm', 96: 'Thunder w/ hail', 99: 'Thunder w/ hail',
};

export async function fetchWeather(lat, lng) {
  if (lat == null || lng == null) return null;
  const key = `wx:${lat.toFixed(2)},${lng.toFixed(2)}`;
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached && Date.now() - cached.t < TTL_MS) return cached.v;
  } catch {}

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&temperature_unit=celsius`;
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    const j = await r.json();
    const c = Math.round(j?.current?.temperature_2m);
    const f = Math.round(c * 9 / 5 + 32);
    const desc = WMO[j?.current?.weather_code] || '—';
    const v = { c, f, desc };
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
    return v;
  } catch {
    return null;
  }
}
