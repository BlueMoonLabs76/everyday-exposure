// One scored trip, laid out for checking against the real world: npm run trip -- [<state>] <category> <OSM way id>
// Prints the route street by street, each camera counted and each one just missed, with Google Maps and
// Street View links to compare against, and writes out/route.html. The trip is scored as the heat map scores it.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTED_TRIP_M, DEFAULT_STATE, OBSERVATION_RADIUS_M, PIECE_BUFFERS_M, PIECE_CELL_DEG } from './config.js';
import { countedPart, observations } from './exposure.js';
import { grow, inRect, pointToSegment, projector } from './geo.js';
import { cellOf, cellRect, findOrigins, scorePiece } from './heatmap.js';
import { renderRouteMap } from './render.js';
import { loadStore } from './store.js';
import { studyArea } from './study-area.js';

const NEAR_MISS_M = 300 * 0.3048;
const MI = 1609.344;
const FT = 0.3048;

const args = process.argv.slice(2);
if (args.length === 2) args.unshift(DEFAULT_STATE);
const [stateArg, key, wayArg] = args;
if (args.length !== 3) {
  console.error('Usage: npm run trip -- [<state>] <grocery|gas|hospital|waffle_house|starbucks> <OSM way id of the street>');
  process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = join(root, 'data', stateArg.split('/').pop().toLowerCase());
const meta = JSON.parse(await readFile(join(dataDir, 'meta.json'), 'utf8'));
const inputs = loadStore(dataDir);
const destinations = inputs.destinations[key];
if (!destinations) {
  console.error(`Unknown category "${key}".`);
  process.exit(1);
}
const origin = findOrigins(inputs.roads, studyArea(inputs.state)).find(o => o.wayId === Number(wayArg));
if (!origin) {
  console.error(`Way ${wayArg} is not a scored street in ${meta.name}.`);
  process.exit(2);
}

let scored;
let bufferM;
for (bufferM of PIECE_BUFFERS_M) {
  const rect = grow(cellRect(...cellOf(origin.lonlat, PIECE_CELL_DEG), PIECE_CELL_DEG), bufferM);
  scored = scorePiece(inputs, rect, { [key]: [origin] }, { keepRoutes: true }).results[key][0];
  if (scored.status !== 'failed') break;
}
if (scored.status === 'failed') {
  console.error(`This street's trip is not proven even in the widest piece (+${bufferM / 1000} km).`);
  process.exit(2);
}
if (scored.status === 'none') {
  console.error('No destination in this category can be reached from this street.');
  process.exit(2);
}
const r = scored.route;
const dest = { ...destinations[scored.destination], snap: scored.snap };
// Only the first COUNTED_TRIP_M of the route counts (ADR 0006); cameras past it are listed apart.
const counting = countedPart(r.segments);
const counted = observations(counting, inputs.cameras);
const countedIds = new Set(counted.map(o => o.camera.id));
const missed = observations(counting, inputs.cameras, NEAR_MISS_M).filter(o => !countedIds.has(o.camera.id));
const beyond = r.lengthM > COUNTED_TRIP_M ? observations(r.segments, inputs.cameras).filter(o => !countedIds.has(o.camera.id)) : [];

const at = ([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
const streetLabel = s => s.name ?? `unnamed ${s.highway}`;

// The street on the route that passes closest to a camera.
function closestStreet(camera) {
  const project = projector(camera.lat);
  const p = project([camera.lon, camera.lat]);
  let best = { distance: Infinity };
  for (const s of r.segments) {
    for (let k = 1; k < s.coords.length; k++) {
      const { distance } = pointToSegment(p, project(s.coords[k - 1]), project(s.coords[k]));
      if (distance < best.distance) best = { distance, street: streetLabel(s) };
    }
  }
  return best.street;
}

function describe(o, i) {
  const t = o.camera.tags ?? {};
  const who = t.operator ?? t.brand ?? t.manufacturer ?? 'no operator/brand';
  return [
    `  ${i + 1}. node/${o.camera.id}  ${(o.distanceM / FT).toFixed(0)} ft from route on ${closestStreet(o.camera)}  (${who}${t.direction ? `, faces ${t.direction}°` : ''})`,
    `     Street View: https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${at([o.camera.lon, o.camera.lat])}`,
  ].join('\n');
}

const streets = [];
for (const s of r.segments) {
  const last = streets[streets.length - 1];
  if (last && last.label === streetLabel(s)) last.lengthM += s.lengthM;
  else streets.push({ label: streetLabel(s), highway: s.highway, lengthM: s.lengthM });
}

console.log(`Category: ${key}`);
console.log(`From:     ${origin.name ?? 'unnamed street'} [${origin.highway}], way/${origin.wayId}, midpoint ${at(origin.lonlat)}`);
console.log(`To:       ${dest.name ?? dest.id} at ${at(dest.snap.lonlat)}`);
console.log(`Route:    ${(r.lengthM / MI).toFixed(2)} mi, about ${Math.round(r.timeS / 60)} min (demo speed model), proven in a piece +${bufferM / 1000} km`);
for (const s of streets) console.log(`          ${s.label} [${s.highway}] ${(s.lengthM / MI).toFixed(2)} mi`);
console.log(`Google:   https://www.google.com/maps/dir/?api=1&origin=${at(origin.lonlat)}&destination=${at(dest.snap.lonlat)}&travelmode=driving`);
console.log(`\nExposure: ${counted.length} camera${counted.length === 1 ? '' : 's'} within ${(OBSERVATION_RADIUS_M / FT).toFixed(0)} ft`);
counted.forEach((o, i) => console.log(describe(o, i)));
console.log(`\nJust missed (${(OBSERVATION_RADIUS_M / FT).toFixed(0)}–${(NEAR_MISS_M / FT).toFixed(0)} ft from route): ${missed.length}`);
missed.forEach((o, i) => console.log(describe(o, i)));
if (r.lengthM > COUNTED_TRIP_M) {
  console.log(`\nPast the first ${(COUNTED_TRIP_M / MI).toFixed(0)} mi (${COUNTED_TRIP_M / 1000} km), not counted: ${beyond.length}`);
  beyond.forEach((o, i) => console.log(describe(o, i)));
}

// The page shows the cameras around the route, not the whole state's.
const lons = r.segments.flatMap(s => s.coords.map(c => c[0]));
const lats = r.segments.flatMap(s => s.coords.map(c => c[1]));
const around = grow({ west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) }, 1000);
const outDir = join(root, 'out');
await mkdir(outDir, { recursive: true });
const from = { label: `${origin.name ?? 'Unnamed street'} (way/${origin.wayId})`, snap: origin };
const to = { label: dest.name ?? dest.id, snap: dest.snap };
await writeFile(join(outDir, 'route.html'), renderRouteMap({ from, to, route: r, observed: counted, cameras: inputs.cameras.filter(c => inRect(around, c.lon, c.lat)), meta }));
console.log('\nMap:      out/route.html');
