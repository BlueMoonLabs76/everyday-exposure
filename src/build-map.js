// The national map: npm run map [-- [--out <folder>] [<state> ...]]
// Draws every state built with `npm run heatmap` (or only the states named) into out/map/, or into out/<folder>/ with
// --out, so a standalone map of some states leaves the national one alone (ADR 0007): exposure.pmtiles, the page that
// shows it (index.html, opened through `npm run serve`), selections.json with each Selection's figures, and search/,
// the street-name index "Find your street" reads. Each state's tile records are kept in out/<state>/tiles.bin and
// written again only when its results change.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tilesNotice } from './attribution.js';
import { PROJECT_NAME, TAGLINE } from './config.js';
import { CAMERA_MIN_ZOOM, LOCAL_ZOOM, MIN_ZOOM, ROAD_MIN_ZOOM, ROAD_ZOOM, STREET_ZOOM, RecordReader, mergeRecords, placeLabels, searchRows, writeStateLayers } from './map-layers.js';
import { renderMap } from './render-map.js';
import { loadResults, readResultsInfo } from './results.js';
import { loadStore } from './store.js';
import { PMTilesWriter } from './tiles.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const outRoot = join(root, 'out');
const n = x => x.toLocaleString('en-US');
const mb = bytes => (bytes / 1e6).toFixed(0);
const seconds = since => ((performance.now() - since) / 1000).toFixed(0);

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outName = outAt === -1 ? 'map' : args.splice(outAt, 2)[1];
// A map folder's name starts with "map", which no state's does, so a map never lands in a state's own out/<state>/.
if (!/^map[\w-]*$/.test(outName ?? '')) {
  console.error('Usage: npm run map -- [--out <folder>] [<state> ...]\nThe folder is a name inside out/ starting with "map", such as map-virginia.');
  process.exit(1);
}
const mapDir = join(outRoot, outName);
const named = args.map(a => a.split('/').pop().toLowerCase());
const slugs = named.length
  ? named
  : readdirSync(outRoot, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(outRoot, d.name, 'results.bin'))).map(d => d.name).sort();
if (!slugs.length) {
  console.error('No state has been built yet. Run "npm run heatmap -- <state>" first.');
  process.exit(1);
}
const states = slugs.map(slug => {
  const path = join(outRoot, slug, 'results.bin');
  if (!existsSync(path)) {
    console.error(`out/${slug}/results.bin is missing. Run "npm run heatmap -- ${slug}" first.`);
    process.exit(1);
  }
  return { slug, path, info: readResultsInfo(path), records: join(outRoot, slug, 'tiles.bin'), search: join(outRoot, slug, 'search.json') };
});

// One snapshot for every Exposure on the map (ADR 0004).
const snapshots = [...new Set(states.map(s => s.info.osmSnapshot))];
if (snapshots.length > 1) {
  console.error(`These states were built from different OSM snapshots: ${states.map(s => `${s.slug} ${s.info.osmSnapshot}`).join(', ')}.\n` +
    'Every Exposure on one map comes from one snapshot. Download the extracts again on one day, then fetch and build each state again.');
  process.exit(1);
}
const [osmSnapshot] = snapshots;
const keys = states[0].info.categories;
const labels = states[0].info.labels;
if (states.some(s => String(s.info.categories) !== String(keys))) {
  console.error('These states were scored for different Destination Categories. Build them again with "npm run heatmap".');
  process.exit(1);
}
console.log(`${states.length} state${states.length === 1 ? '' : 's'}: ${states.map(s => s.info.name).join(', ')}. OSM snapshot ${osmSnapshot}.\n`);

const started = performance.now();
for (const s of states) {
  const fresh = path => existsSync(path) && statSync(path).mtimeMs >= statSync(s.path).mtimeMs;
  let current = fresh(s.records) && fresh(s.search);
  if (current) {
    try {
      new RecordReader(s.records).close();
    } catch {
      current = false;
    }
  }
  if (current) {
    console.log(`${s.info.name}: tile records are current.`);
    continue;
  }
  const t = performance.now();
  const dataDir = join(root, 'data', s.slug);
  const dataSnapshot = existsSync(join(dataDir, 'meta.json')) && JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf8')).osmSnapshot;
  if (dataSnapshot !== osmSnapshot) {
    console.error(`data/${s.slug}/ ${dataSnapshot ? `holds snapshot ${dataSnapshot}` : 'is missing'}, but out/${s.slug}/results.bin was scored from ${s.info.osmSnapshot}. ` +
      `Run "npm run fetch-data -- ${s.slug}" and "npm run heatmap -- ${s.slug}" again.`);
    process.exit(1);
  }
  const store = loadStore(dataDir);
  const results = loadResults(s.path);
  const counts = writeStateLayers(s.records, { store, results, stateName: s.info.name });
  writeFileSync(s.search, JSON.stringify(searchRows({ store, results })));
  console.log(`${s.info.name}: ${n(counts.streets)} streets, ${n(counts.roads)} other roads, ${n(counts.cameras)} cameras, ${n(counts.destinations)} destinations; ` +
    `${n(counts.records)} tile records, ${mb(counts.bytes)} MB, in ${seconds(t)} s. Peak memory ${mb(process.resourceUsage().maxRSS * 1024)} MB.`);
}

// Tiles.
mkdirSync(mapDir, { recursive: true });
const t = performance.now();
const partial = join(mapDir, 'exposure.pmtiles.partial');
const writer = new PMTilesWriter(partial);
const { tiles, largest } = mergeRecords(states.map(s => new RecordReader(s.records)), writer, keys, { log: console.log });
const boxes = states.map(s => s.info.bbox);
const bounds = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
const categoryFields = suffixes => Object.fromEntries(keys.flatMap(k => suffixes.map(([suffix, type]) => [`${k}${suffix}`, type])));
const written = writer.finish({
  bounds,
  center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2, 5],
  metadata: {
    name: PROJECT_NAME,
    description: TAGLINE,
    attribution: '© OpenStreetMap contributors, ODbL',
    osm_snapshot: osmSnapshot,
    states: states.map(s => s.info.name),
    vector_layers: [
      { id: 'grid', minzoom: MIN_ZOOM, maxzoom: LOCAL_ZOOM - 1, fields: categoryFields([['_n', 'Number'], ['_w', 'Number'], ['_mean', 'Number'], ['_zero', 'Number']]) },
      { id: 'outline', minzoom: MIN_ZOOM, maxzoom: STREET_ZOOM, fields: {} },
      { id: 'roads', minzoom: ROAD_MIN_ZOOM, maxzoom: STREET_ZOOM, fields: { local: 'Number' } },
      { id: 'streets', minzoom: ROAD_ZOOM.primary, maxzoom: STREET_ZOOM, fields: { name: 'String', place: 'String', ...categoryFields([['', 'Number'], ['_min', 'Number'], ['_long', 'Number'], ['_dest', 'String'], ['_dlon', 'Number'], ['_dlat', 'Number'], ['_cams', 'String']]) } },
      { id: 'destinations', minzoom: STREET_ZOOM, maxzoom: STREET_ZOOM, fields: { category: 'String', name: 'String' } },
      { id: 'cameras', minzoom: CAMERA_MIN_ZOOM, maxzoom: STREET_ZOOM, fields: { who: 'String' } },
    ],
  },
});
renameSync(partial, join(mapDir, 'exposure.pmtiles'));
console.log(`\nWrote out/${outName}/exposure.pmtiles: ${n(tiles)} tiles, ${mb(written.bytes)} MB, ${written.leaves} leaf directories, in ${seconds(t)} s. ` +
  `Largest tile ${(largest.bytes / 1e3).toFixed(0)} KB compressed (${largest.z}/${largest.x}/${largest.y}).`);

// Selections: the country (every built state), each state, and each state's counties and independent cities.
const addStats = (into, from) => {
  for (const key of keys) {
    const t = (into[key] ??= { counts: [], none: 0, unproven: 0 });
    from[key].counts.forEach((c, i) => { t.counts[i] = (t.counts[i] ?? 0) + c; });
    t.none += from[key].none;
    t.unproven += from[key].unproven;
  }
  return into;
};
const selections = {
  osmSnapshot,
  categories: keys.map(key => ({ key, label: labels?.[key] ?? key })),
  country: { name: 'United States', bbox: bounds, stats: states.reduce((acc, s) => addStats(acc, s.info.stats), {}) },
  states: states.map(s => ({
    name: s.info.name,
    bbox: s.info.bbox,
    stats: s.info.stats,
    parts: s.info.selections.filter(p => p.bbox).map(p => ({ name: p.name, kind: p.kind, bbox: p.bbox, stats: p.stats })).sort((a, b) => a.name.localeCompare(b.name)),
  })),
};
writeFileSync(join(mapDir, 'selections.json'), JSON.stringify(selections));

// Street names, sharded by the first two characters of each word that isn't a street type or direction, so a search
// reads one small file. A row: [name, place, west, south, east, north (degrees × 1e5), then lowest and highest Exposure
// per category].
const STOP = new Set(('street st road rd avenue ave av drive dr lane ln court ct way place pl boulevard blvd circle cir trail trl ' +
  'parkway pkwy highway hwy terrace ter loop path north south east west n s e w ne nw se sw the of').split(' '));
const places = [];
const shards = new Map();
for (const s of states) {
  const base = places.length;
  places.push(s.info.name, ...placeLabels(s.info, s.info.name));
  for (const row of JSON.parse(readFileSync(s.search, 'utf8'))) {
    row[1] = base + 1 + row[1];
    const shardKeys = new Set(row[0].toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/ +/).filter(w => w && !STOP.has(w)).map(w => w.slice(0, 2)));
    for (const key of shardKeys) {
      if (!shards.has(key)) shards.set(key, []);
      shards.get(key).push(row);
    }
  }
}
const searchDir = join(mapDir, 'search');
rmSync(searchDir, { recursive: true, force: true });
mkdirSync(searchDir, { recursive: true });
let searchBytes = 0;
let biggest = 0;
for (const [key, rows] of shards) {
  const text = JSON.stringify(rows);
  writeFileSync(join(searchDir, `${key}.json`), text);
  searchBytes += text.length;
  biggest = Math.max(biggest, text.length);
}
writeFileSync(join(searchDir, 'places.json'), JSON.stringify(places));
console.log(`Wrote out/${outName}/search/: ${n(shards.size)} files, ${mb(searchBytes)} MB, largest ${mb(biggest)} MB.`);

writeFileSync(join(mapDir, 'index.html'), renderMap({ osmSnapshot, categories: selections.categories, states: selections.states.map(s => s.name), stop: [...STOP] }));
writeFileSync(join(mapDir, 'NOTICE.txt'), tilesNotice({ osmSnapshot, states: selections.states.map(s => s.name) }));
console.log(`Wrote out/${outName}/index.html, selections.json and NOTICE.txt. Done in ${seconds(started)} s; peak memory ${mb(process.resourceUsage().maxRSS * 1024)} MB.`);
console.log(`Run "npm run serve${outName === 'map' ? '' : ` -- ${outName}`}" and open http://localhost:8080/ to see it.`);
