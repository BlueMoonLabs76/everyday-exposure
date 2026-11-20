// Resolves "lat,lon" directly, or an address through OSM Nominatim (limited to the study extent).
import { USER_AGENT } from './config.js';

const LAT_LON = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
const NOMINATIM_INTERVAL_MS = 1100; // usage policy: at most 1 request per second
let lastRequest = 0;

// meta is data/<state>/meta.json: its bbox bounds the search, and its name names the extent in errors.
export async function geocode(query, meta) {
  const m = LAT_LON.exec(query);
  if (m) return { lat: Number(m[1]), lon: Number(m[2]), label: `${m[1]}, ${m[2]}` };

  const wait = lastRequest + NOMINATIM_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequest = Date.now();

  const { south, west, north, east } = meta.bbox;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'us',
    viewbox: `${west},${north},${east},${south}`,
    bounded: '1',
  });
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim returned HTTP ${res.status} for "${query}"`);
  const [hit] = await res.json();
  if (!hit) throw new Error(`No match inside ${meta.name ?? 'the study extent'} for "${query}"`);
  return { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name };
}
