// Two-point query: npm run query -- [<state>] "<from address | lat,lon>" "<to address | lat,lon>"
// Routes the fastest drive between them over the roads near the state and reports its Exposure.
// The route is searched within the widest piece buffer around the two points.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTED_TRIP_M, DEFAULT_STATE, PIECE_BUFFERS_M } from './config.js';
import { countedPart, observations } from './exposure.js';
import { geocode } from './geocode.js';
import { grow, inRect } from './geo.js';
import { pieceNetwork } from './heatmap.js';
import { route, snap } from './network.js';
import { renderRouteMap } from './render.js';
import { loadStore } from './store.js';

const SNAP_WARN_M = 200;
const args = process.argv.slice(2);
if (args.length === 2) args.unshift(DEFAULT_STATE);
const [stateArg, fromArg, toArg] = args;
if (args.length !== 3) {
  console.error('Usage: npm run query -- [<state>] "<from address | lat,lon>" "<to address | lat,lon>"');
  process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = join(root, 'data', stateArg.split('/').pop().toLowerCase());
let meta;
try {
  meta = JSON.parse(await readFile(join(dataDir, 'meta.json'), 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
  console.error(`Missing ${dataDir}. Run "npm run fetch-data -- ${stateArg}" first.`);
  process.exit(1);
}
const places = [];
for (const q of [fromArg, toArg]) places.push(await geocode(q, meta));
const inputs = loadStore(dataDir);
const rect = grow({
  west: Math.min(...places.map(p => p.lon)), east: Math.max(...places.map(p => p.lon)),
  south: Math.min(...places.map(p => p.lat)), north: Math.max(...places.map(p => p.lat)),
}, PIECE_BUFFERS_M.at(-1));
const net = pieceNetwork(inputs, rect);

const describeSnap = s => `${s.distance.toFixed(0)} m to ${s.name ?? 'unnamed road'} [${s.highway}]`;
const ends = places.map((place, i) => {
  const s = snap(net, [place.lon, place.lat]);
  if (!s) {
    console.error(`No drivable road near "${[fromArg, toArg][i]}".`);
    process.exit(2);
  }
  if (s.distance > SNAP_WARN_M) console.warn(`Warning: "${[fromArg, toArg][i]}" is ${s.distance.toFixed(0)} m from the nearest drivable road.`);
  return { ...place, snap: s };
});
const [from, to] = ends;

const r = route(net, from.snap, to.snap);
if (!r) {
  console.error('No drivable route between those points.');
  process.exit(2);
}
const cameras = inputs.cameras.filter(c => inRect(rect, c.lon, c.lat));
// Only the first COUNTED_TRIP_M of the route counts (ADR 0006).
const observed = observations(countedPart(r.segments), cameras);
const beyond = r.lengthM > COUNTED_TRIP_M ? observations(r.segments, cameras).length - observed.length : 0;

const byClass = new Map();
for (const s of r.segments) byClass.set(s.highway, (byClass.get(s.highway) ?? 0) + s.lengthM);
const classes = [...byClass].sort((x, y) => y[1] - x[1]).map(([h, m]) => `${h} ${(m / 1609.344).toFixed(2)} mi`).join(', ');

console.log(`From:     ${from.label}\n          snapped ${describeSnap(from.snap)}`);
console.log(`To:       ${to.label}\n          snapped ${describeSnap(to.snap)}`);
console.log(`Route:    ${(r.lengthM / 1609.344).toFixed(2)} mi, about ${Math.round(r.timeS / 60)} min, ${r.segments.length} segments`);
console.log(`          ${classes}`);
console.log(`Exposure: ${observed.length} ALPR Camera${observed.length === 1 ? '' : 's'} within 75 ft` +
  (r.lengthM > COUNTED_TRIP_M ? ` in the first ${COUNTED_TRIP_M / 1000} km; ${beyond} more past it, not counted` : ''));
for (const [i, o] of observed.entries()) {
  const t = o.camera.tags ?? {};
  const who = ['operator', 'brand', 'manufacturer'].filter(k => t[k]).map(k => `${k}=${t[k]}`).join(' ') || 'no operator/brand tags';
  console.log(`  ${i + 1}. node/${o.camera.id}  ${o.distanceM.toFixed(0)} m from route  ${who}`);
}

const outDir = join(root, 'out');
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'route.html'), renderRouteMap({ from, to, route: r, observed, cameras: cameras.filter(c => inRect(grow(rect, -PIECE_BUFFERS_M.at(-1) + 1000), c.lon, c.lat)), meta }));
console.log('Map:      out/route.html');
