// Standalone Leaflet page showing one route, its Observation Radius hits, and nearby cameras.
import { OBSERVATION_RADIUS_M, PROJECT_NAME, TAGLINE } from './config.js';
import { CORNER_CREDIT, creditHtml } from './attribution.js';
import { DISCLAIMER } from './disclaimer.js';

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const miles = m => (m / 1609.344).toFixed(1);
const minutes = s => Math.round(s / 60);

export function renderRouteMap({ from, to, route, observed, cameras, meta }) {
  const path = [];
  for (const s of route.segments) {
    for (const [lon, lat] of s.coords) {
      const last = path[path.length - 1];
      if (!last || last[0] !== lat || last[1] !== lon) path.push([lat, lon]);
    }
  }
  const observedIds = new Set(observed.map(o => o.camera.id));
  const data = {
    path,
    radius: OBSERVATION_RADIUS_M,
    from: [from.snap.lonlat[1], from.snap.lonlat[0]],
    to: [to.snap.lonlat[1], to.snap.lonlat[0]],
    cameras: cameras.map(c => ({
      lat: c.lat,
      lon: c.lon,
      observed: observedIds.has(c.id),
      popup: `<a href="https://www.openstreetmap.org/node/${c.id}" target="_blank">node/${c.id}</a><br>` +
        ['operator', 'brand', 'manufacturer', 'direction'].filter(k => c.tags?.[k]).map(k => `${k}: ${esc(c.tags[k])}`).join('<br>'),
    })),
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const list = observed.length
    ? `<ol>${observed.map(o => `<li>${esc(o.camera.tags?.operator ?? o.camera.tags?.brand ?? 'unknown operator')} <span class="dim">· ${o.distanceM.toFixed(0)} m from route</span></li>`).join('')}</ol>`
    : '<p class="dim">No ALPR Cameras within 75 ft of this route.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(PROJECT_NAME)}: route</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>
  html, body { height: 100%; margin: 0; font: 14px/1.4 system-ui, sans-serif; }
  #map { position: absolute; inset: 0; }
  .panel { position: absolute; z-index: 1000; top: 12px; left: 12px; width: min(340px, calc(100% - 24px)); max-height: calc(100% - 24px); overflow: auto;
    background: #fff; color: #111; padding: 12px 14px; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.25); box-sizing: border-box; }
  .score { font-size: 40px; font-weight: 700; line-height: 1; }
  .dim { color: #555; }
  .caveat { font-size: 12px; color: #333; background: #f3f4f6; padding: 6px 8px; border-radius: 6px; }
  summary { cursor: pointer; font-size: 13px; font-weight: 600; }
  .small { font-size: 12px; }
  ol { padding-left: 20px; margin: 6px 0; }
  h1 { font-size: 16px; margin: 0; }
  .tagline { font-size: 13px; color: #555; margin: 2px 0 10px; }
  .label { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 6px; color: #555; }
</style>
</head>
<body>
<div id="map"></div>
<div class="panel">
  <h1>${esc(PROJECT_NAME)}</h1>
  <p class="tagline">${esc(TAGLINE)}</p>
  <div class="label">Exposure</div>
  <div class="score">${observed.length}</div>
  <div class="dim">ALPR Cameras within 75 ft of the route</div>
  <p><b>From</b> ${esc(from.label)}<br><b>To</b> ${esc(to.label)}</p>
  <p class="dim">${miles(route.lengthM)} mi · about ${minutes(route.timeS)} min (demo speed model)</p>
  ${list}
  <p class="caveat">${esc(DISCLAIMER.short)}</p>
  <details>
    <summary>Full disclaimer</summary>
    ${DISCLAIMER.paragraphs.map(p => `<p class="dim small"><b>${esc(p.lead)}</b> ${esc(p.text)}</p>`).join('\n    ')}
    <p class="dim small">${creditHtml(meta)}</p>
  </details>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
const DATA = ${json};
const map = L.map('map');
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: ${JSON.stringify(CORNER_CREDIT)} }).addTo(map);
const line = L.polyline(DATA.path, { color: '#2563eb', weight: 5, opacity: 0.85 }).addTo(map);
for (const c of DATA.cameras) {
  if (c.observed) L.circle([c.lat, c.lon], { radius: DATA.radius, color: '#dc2626', weight: 1, fillOpacity: 0.2 }).addTo(map);
  L.circleMarker([c.lat, c.lon], { radius: c.observed ? 7 : 4, color: c.observed ? '#991b1b' : '#374151', fillColor: c.observed ? '#dc2626' : '#9ca3af', fillOpacity: 0.95, weight: 1 })
    .bindPopup(c.popup).addTo(map);
}
L.circleMarker(DATA.from, { radius: 8, color: '#065f46', fillColor: '#10b981', fillOpacity: 1 }).bindTooltip('From').addTo(map);
L.circleMarker(DATA.to, { radius: 8, color: '#111827', fillColor: '#111827', fillOpacity: 1 }).bindTooltip('To').addTo(map);
map.fitBounds(line.getBounds(), { padding: [40, 40] });
</script>
</body>
</html>
`;
}
