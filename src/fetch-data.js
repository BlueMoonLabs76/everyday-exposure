// Builds a state's study inputs in data/<state>/ from Geofabrik extracts (ADR 0003, ADR 0004): the state's own
// extract and those of every state a piece of it can reach, all at one OSM snapshot.
// npm run fetch-data -- [--refresh] [<state>]
// Extracts are downloaded into extracts/ and kept; --refresh downloads them again. data/<state>/ is rebuilt every run.
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_LABELS, categoriesFor, DEFAULT_STATE, PIECE_BUFFERS_M, PIECE_CELL_DEG } from './config.js';
import { download, extractFileName, findState, polygonsMeetRect, usStates } from './geofabrik.js';
import { grow } from './geo.js';
import { cellRect, stateCells } from './heatmap.js';
import { readState, saveStore } from './store.js';
import { mostlyInside, onBoundary, studyArea } from './study-area.js';

const USAGE = 'Usage: npm run fetch-data -- [--refresh] [<state>]';
let refresh = false;
let name = null;
for (const arg of process.argv.slice(2)) {
  if (arg === '--refresh') refresh = true;
  else if (!arg.startsWith('-') && !name) name = arg;
  else {
    console.error(USAGE);
    process.exit(1);
  }
}

const root = fileURLToPath(new URL('../', import.meta.url));
const extractsDir = join(root, 'extracts');
await mkdir(extractsDir, { recursive: true });
const exists = path => access(path).then(() => true, () => false);

const states = await usStates(join(extractsDir, 'geofabrik-index.json'), { refresh, log: console.log });
const state = findState(states, name ?? DEFAULT_STATE);
const slug = state.id.split('/').pop();

// The cells of the piece grid that meet the state, each as far as its widest piece reaches.
const widest = Math.max(...PIECE_BUFFERS_M);
const reach = stateCells(state.polygons, PIECE_CELL_DEG).map(([i, j]) => grow(cellRect(i, j, PIECE_CELL_DEG), widest));
const keep = (w, s, e, n) => reach.some(r => r.west <= e && r.east >= w && r.south <= n && r.north >= s);
const neighbours = states.filter(s => s !== state && reach.some(r => polygonsMeetRect(s.polygons, r)));
console.log(`${state.id}: ${reach.length} cells of ${PIECE_CELL_DEG}°. States within ${widest / 1000} km of them: ${neighbours.map(s => s.id).join(', ') || 'none'}.`);

const extracts = [];
for (const s of [state, ...neighbours]) {
  const path = join(extractsDir, extractFileName(s));
  if (refresh || !(await exists(path))) {
    console.log(`Downloading ${s.url} …`);
    await download(s.url, path);
  }
  console.log(`  extracts/${extractFileName(s)}: ${((await stat(path)).size / 1e6).toFixed(0)} MB`);
  extracts.push({ path, own: s === state });
}

console.log('Reading …');
const started = performance.now();
const read = readState(extracts, { iso: state.iso, keep, categories: categoriesFor(slug), log: console.log });
console.log(`  read in ${((performance.now() - started) / 1000).toFixed(1)} s, peak memory ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);

const inState = studyArea(read.state);
const onStateLine = onBoundary(read.state);
const selections = read.counties.filter(c => mostlyInside(inState, c, onStateLine)).sort((a, b) => a.name.localeCompare(b.name));
const dataDir = join(root, 'data', slug);
await mkdir(dataDir, { recursive: true });
saveStore(dataDir, { roads: read.roads, cameras: read.cameras, destinations: read.destinations, state: read.state, selections });

const ring = read.state.outer.flat();
const meta = {
  name: read.state.name,
  state: state.id,
  iso: state.iso,
  relation: read.state.relation,
  bbox: {
    south: Math.min(...ring.map(p => p[1])), west: Math.min(...ring.map(p => p[0])),
    north: Math.max(...ring.map(p => p[1])), east: Math.max(...ring.map(p => p[0])),
  },
  osmSnapshot: read.osmSnapshot,
  extracts: [state, ...neighbours].map(s => ({ id: s.id, url: s.url })),
  fetchedAt: new Date().toISOString(),
  pieces: { cellDeg: PIECE_CELL_DEG, buffersM: PIECE_BUFFERS_M },
  counts: {
    roads: read.roads.wayId.length, nodes: read.roads.nodeId.length, cameras: read.cameras.length,
    ...Object.fromEntries(Object.entries(read.destinations).map(([c, list]) => [c, list.length])),
    selections: selections.length, skippedWays: read.skippedWays,
  },
  license: 'Map data © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0',
};
await writeFile(join(dataDir, 'meta.json'), JSON.stringify(meta, null, 2));

console.log(`${read.state.name} (relation ${read.state.relation}) with ${selections.length} counties and independent cities.`);
const local = categoriesFor(slug)[3];
console.log(`Saved ${meta.counts.roads} drivable roads, ${meta.counts.cameras} ALPR Cameras, ${meta.counts.grocery} grocery stores, ${meta.counts.gas} gas stations, ${meta.counts.hospital} hospitals and ${meta.counts[local]} ${{ waffle_house: "Waffle Houses", starbucks: "Starbucks stores" }[local] ?? CATEGORY_LABELS[local]} near it to data/${slug}/.`);
const days = Math.floor((Date.now() - Date.parse(read.osmSnapshot)) / 86400000);
console.log(`OSM snapshot ${read.osmSnapshot}, ${days < 1 ? 'less than a day' : days === 1 ? '1 day' : `${days} days`} old.`);
