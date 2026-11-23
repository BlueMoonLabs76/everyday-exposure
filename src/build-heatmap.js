// State heat map: npm run heatmap -- [<state>]
// Scores every Origin in the state against each Destination Category, piece by piece (ADR 0004), and writes
// out/<state>/results.bin for the national map (`npm run map`), plus exposure.csv and the ODbL notice that travels with it.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvNotice } from './attribution.js';
import { CATEGORY_LABELS as LABELS, COUNTED_TRIP_M, DEFAULT_STATE, PIECE_BUFFERS_M, PIECE_CELL_DEG } from './config.js';
import { findState, usStates } from './geofabrik.js';
import { findOrigins, scoreState, stateCells } from './heatmap.js';
import { packResults, saveResults } from './results.js';
import { loadStore } from './store.js';
import { studyArea } from './study-area.js';

const slug = (process.argv[2] ?? DEFAULT_STATE).split('/').pop().toLowerCase();
const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = join(root, 'data', slug);
let meta;
try {
  meta = JSON.parse(await readFile(join(dataDir, 'meta.json'), 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
  console.error(`Missing data/${slug}/. Run "npm run fetch-data -- ${slug}" first.`);
  process.exit(1);
}

if (meta.pieces?.cellDeg !== PIECE_CELL_DEG || String(meta.pieces?.buffersM) !== String(PIECE_BUFFERS_M)) {
  console.error(`data/${slug}/ was read for other pieces than src/config.js sets. Run "npm run fetch-data -- ${slug}" again.`);
  process.exit(1);
}
const cells = stateCells(findState(await usStates(join(root, 'extracts', 'geofabrik-index.json')), meta.state).polygons, PIECE_CELL_DEG);

const started = performance.now();
const inputs = loadStore(dataDir);
const { roads } = inputs;
const inState = studyArea(inputs.state);
const origins = findOrigins(roads, inState);
const keys = Object.keys(inputs.destinations);
console.log(`${meta.name}: ${origins.length} Origins. Roads near it: ${roads.wayId.length} ways, ${roads.nodeId.length} nodes; longest segment ${inputs.maxSegmentM.toFixed(0)} m.`);
console.log(`OSM snapshot ${meta.osmSnapshot}. Pieces: cells of ${PIECE_CELL_DEG}°, buffers ${PIECE_BUFFERS_M.map(b => b / 1000).join(', ')} km.\n`);

const n = x => x.toLocaleString('en-US');
const { results, pieces } = scoreState(inputs, origins, {
  cellDeg: PIECE_CELL_DEG,
  buffers: PIECE_BUFFERS_M,
  cells,
  log: p => console.log(
    `  piece ${p.rect.south.toFixed(1)}..${p.rect.north.toFixed(1)}N ${(-p.rect.west).toFixed(1)}..${(-p.rect.east).toFixed(1)}W +${p.bufferM / 1000} km: ` +
    `${n(p.origins)} Origins, ${n(p.ways)} road ways, failed ${keys.map(k => `${k} ${p.failed[k] ?? 0}`).join(' / ')}, ` +
    `${p.seconds.toFixed(1)} s, peak ${p.peakMB.toFixed(0)} MB`),
});
console.log(`\nScored in ${((performance.now() - started) / 1000).toFixed(0)} s.`);
for (const bufferM of PIECE_BUFFERS_M) {
  const level = pieces.filter(p => p.bufferM === bufferM);
  const sum = f => level.reduce((s, p) => s + f(p), 0);
  console.log(`  +${bufferM / 1000} km: ${level.length} pieces, ${n(sum(p => p.origins))} Origins, failed ${keys.map(k => `${k} ${n(sum(p => p.failed[k] ?? 0))}`).join(' / ')}, ${sum(p => p.seconds).toFixed(0)} s, largest ${n(Math.max(0, ...level.map(p => p.ways)))} ways, peak ${Math.max(0, ...level.map(p => p.peakMB)).toFixed(0)} MB`);
}

const categories = keys.map(key => ({ key, label: LABELS[key] ?? key, destinations: inputs.destinations[key], results: results[key] }));
console.log('');
for (const c of categories) {
  const status = s => c.results.filter(r => r.status === s).length;
  const scores = c.results.filter(r => r.status === 'ok').map(r => r.cameras.length);
  const histogram = new Map();
  for (const s of scores) histogram.set(s, (histogram.get(s) ?? 0) + 1);
  const long = c.results.filter(r => r.status === 'ok' && r.lengthM > COUNTED_TRIP_M).length;
  console.log(`${c.label}: ${n(scores.length)} of ${n(origins.length)} Origins scored (${n(long)} trips longer than ${COUNTED_TRIP_M / 1000} km, counted over their first ${COUNTED_TRIP_M / 1000} km), ${status('none')} with no reachable destination, ${status('unproven')} unproven. ` +
    `Mean Exposure ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)}, max ${scores.reduce((a, b) => Math.max(a, b), 0)}`);
  console.log(`  Exposure → Origins: ${[...histogram].sort((a, b) => a[0] - b[0]).map(([s, k]) => `${s}:${k}`).join('  ')}`);
}

// Per Selection: the state, then its counties and independent cities.
const selections = [{ name: meta.name, test: inState }, ...inputs.selections.map(s => ({ name: `${s.name} (${s.kind})`, test: studyArea(s) }))];
const selectionOf = origins.map(o => inputs.selections.findIndex((_, k) => selections[k + 1].test(o.lonlat)));
const members = selections.map((_, k) => (k === 0 ? origins.map((_, i) => i) : []));
selectionOf.forEach((sel, i) => { if (sel >= 0) members[sel + 1].push(i); });
console.log(`\nBy Selection: Origins, ALPR Cameras, destinations (${keys.join(', ')}), mean Exposure (${keys.join(', ')})`);
selections.forEach((s, k) => {
  const idx = members[k];
  const inside = list => list.filter(p => s.test([p.lon, p.lat])).length;
  const means = keys.map(key => {
    const scores = idx.map(i => results[key][i]).filter(r => r.status === 'ok').map(r => r.cameras.length);
    return scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : '-';
  });
  console.log(`  ${s.name}: ${n(idx.length)} Origins, ${inside(inputs.cameras)} cameras, ${keys.map(key => inside(inputs.destinations[key])).join(' / ')} destinations, mean ${means.join(' / ')}`);
});
const outside = selectionOf.filter(sel => sel < 0).length;
if (outside) console.log(`  ${n(outside)} Origins lie in no county or independent city.`);

const outDir = join(root, 'out', slug);
await mkdir(outDir, { recursive: true });
const csvCell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const header = ['way_id', 'street', 'lon', 'lat', ...categories.flatMap(c => [`${c.key}_exposure`, `${c.key}_destination`, `${c.key}_minutes`])];
const rows = origins.map((o, i) => [
  o.wayId, o.name, o.lonlat[0].toFixed(6), o.lonlat[1].toFixed(6),
  ...categories.flatMap(c => {
    const r = c.results[i];
    if (r.status !== 'ok') return ['', '', ''];
    const d = c.destinations[r.destination];
    return [r.cameras.length, d.name ?? d.id, (r.timeS / 60).toFixed(1)];
  }),
]);
await writeFile(join(outDir, 'exposure.csv'), [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n') + '\n');
await writeFile(join(outDir, 'exposure.NOTICE.txt'), csvNotice({ file: 'exposure.csv', meta, place: meta.name, relations: [meta.relation], columns: header }));

// The scores for `npm run map`, with each Selection's figures: how many Origins have each Exposure, and how many have
// no route or an unproven one.
const statsOf = idx => Object.fromEntries(keys.map(key => {
  const counts = [];
  let none = 0;
  let unproven = 0;
  for (const i of idx) {
    const r = results[key][i];
    if (r.status === 'ok') counts[r.cameras.length] = (counts[r.cameras.length] ?? 0) + 1;
    else if (r.status === 'none') none++;
    else unproven++;
  }
  return [key, { counts: Array.from(counts, c => c ?? 0), none, unproven }];
}));
const bboxOf = idx => {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const i of idx) {
    const [x, y] = origins[i].lonlat;
    west = Math.min(west, x); east = Math.max(east, x);
    south = Math.min(south, y); north = Math.max(north, y);
  }
  return idx.length ? [west, south, east, north].map(v => Math.round(v * 1e4) / 1e4) : null;
};
const packed = packResults(origins, results, {
  state: meta.state,
  name: meta.name,
  osmSnapshot: meta.osmSnapshot,
  labels: Object.fromEntries(categories.map(c => [c.key, c.label])),
  bbox: bboxOf(members[0]),
  stats: statsOf(members[0]),
  selections: inputs.selections.map((s, k) => ({ name: s.name, kind: s.kind, relation: s.relation, bbox: bboxOf(members[k + 1]), stats: statsOf(members[k + 1]) })),
});
packed.arrays.selection = Int16Array.from(selectionOf);
saveResults(join(outDir, 'results.bin'), packed);
console.log(`\nWrote out/${slug}/results.bin, exposure.csv and exposure.NOTICE.txt. Peak memory ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB.`);
console.log('Run "npm run map" to draw every built state into the national map.');
