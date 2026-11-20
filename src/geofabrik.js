// Geofabrik's extracts of the US states (ADR 0003, ADR 0004): which region a state is, which states lie near it,
// and downloading an extract.
import { createWriteStream } from 'node:fs';
import { access, readFile, rename } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GEOFABRIK_INDEX, USER_AGENT } from './config.js';
import { inRing } from './study-area.js';

const TERRITORIES = new Set(['US-PR', 'US-VI', 'US-GU', 'US-AS', 'US-MP', 'US-UM']);
const exists = path => access(path).then(() => true, () => false);

// The 50 states and DC as { id, iso, url, polygons }, from Geofabrik's index kept at indexPath (downloaded if missing).
// polygons are GeoJSON MultiPolygon coordinates: polygons of rings of [lon, lat].
export async function usStates(indexPath, { refresh = false, log = () => {} } = {}) {
  if (refresh || !(await exists(indexPath))) {
    log(`Downloading ${GEOFABRIK_INDEX} …`);
    await download(GEOFABRIK_INDEX, indexPath);
  }
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  return index.features
    .filter(f => f.properties.id.startsWith('us/') && f.geometry)
    .map(f => ({
      id: f.properties.id,
      iso: [f.properties['iso3166-2']].flat()[0], // Geofabrik has given this as both "US-VA" and ["US-VA"]
      url: f.properties.urls.pbf,
      polygons: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates,
    }))
    .filter(s => /^US-[A-Z]{2}$/.test(s.iso ?? '') && !TERRITORIES.has(s.iso));
}

// A state by region id ("us/virginia"), its last part ("virginia"), or postal code ("VA").
export function findState(states, name) {
  const n = name.toLowerCase();
  const state = states.find(s => s.id === n || s.id === `us/${n}` || s.iso.toLowerCase() === n || s.iso.toLowerCase() === `us-${n}`);
  if (!state) throw new Error(`No US state "${name}". Give a Geofabrik region id such as us/virginia, its last part, or a postal code.`);
  return state;
}

export const extractFileName = state => `${state.id.replaceAll('/', '-')}.osm.pbf`;

// True if any of the polygons meets the rectangle { west, south, east, north }.
export function polygonsMeetRect(polygons, r) {
  for (const polygon of polygons) {
    const outer = polygon[0];
    for (let i = 1; i < outer.length; i++) if (segmentMeetsRect(outer[i - 1], outer[i], r)) return true;
    if (inRing(outer, (r.west + r.east) / 2, (r.south + r.north) / 2)) return true;
  }
  return false;
}

// Liang-Barsky: does the segment from a to b pass through the rectangle?
function segmentMeetsRect([x0, y0], [x1, y1], r) {
  let lo = 0;
  let hi = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - r.west], [dx, r.east - x0], [-dy, y0 - r.south], [dy, r.north - y0]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
      if (lo > hi) return false;
    }
  }
  return true;
}

export async function download(url, path) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${path}.part`));
  await rename(`${path}.part`, path);
}
