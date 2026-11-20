import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { findOrigins } from '../src/heatmap.js';
import { LOCAL_ZOOM, MIN_ZOOM, ROAD_ZOOM, STREET_ZOOM, RecordReader, mergeRecords, searchRows, writeStateLayers } from '../src/map-layers.js';
import { compactRoads } from '../src/network.js';
import { loadResults, packResults, saveResults } from '../src/results.js';
import { storeInputs } from '../src/store.js';
import { PMTilesWriter, tileId } from '../src/tiles.js';

// A tiny state straddling the edge between two zoom-12 tiles, at 99.66796875°W.
const EDGE = -180 + 914 * (360 / 4096);
const LAT = 40.001;
const at = (dx, dy) => [EDGE + dx * 0.0001, LAT + dy * 0.0001];
const way = (id, highway, nodes, name) => ({ id, nodes: nodes.map(([n]) => n), coords: nodes.map(([, x, y]) => at(x, y)), tags: { highway, ...(name ? { name } : {}) } });

function build(dir) {
  const ways = [
    way(1, 'residential', [[10, -20, 0], [11, -5, 0], [12, 5, 0], [13, 20, 0]], 'Edge Street'),
    way(2, 'residential', [[14, -20, 5], [15, -10, 5]], 'Edge Street'),
    way(3, 'motorway', [[20, -20, -10], [21, 20, -10]]),
    way(4, 'service', [[30, 0, 8], [31, 1, 8]]),
  ];
  const ring = [at(-30, -30), at(30, -30), at(30, 30), at(-30, 30), at(-30, -30)];
  const store = storeInputs({
    roads: compactRoads(ways),
    cameras: [{ id: 500, lon: at(1, 0)[0], lat: LAT, tags: { operator: 'Town Police' } }],
    destinations: { grocery: [{ id: 'node/9', osmId: 9, lon: at(15, 1)[0], lat: at(15, 1)[1], name: 'Corner Market' }] },
    state: { outer: [ring], inner: [] },
  });
  const origins = findOrigins(store.roads, () => true);
  const results = {
    grocery: origins.map(o => (o.wayId === 1
      ? { status: 'ok', destination: 0, timeS: 120, lengthM: 45000, cameras: [500] }
      : { status: 'none' })),
  };
  const packed = packResults(origins, results, { osmSnapshot: 'test', selections: [{ name: 'Test County', kind: 'county' }] });
  packed.arrays.selection = Int16Array.from(origins, () => 0);
  saveResults(join(dir, 'results.bin'), packed);
  return { store, results: loadResults(join(dir, 'results.bin')) };
}

// Every record's tile, in file order.
function recordTiles(path) {
  const r = new RecordReader(path);
  const seen = [];
  while (r.head) {
    seen.push({ id: r.head.id, z: r.head.z, x: r.head.x, y: r.head.y, layer: r.head.layer });
    r.advance();
  }
  return seen;
}

test('a state becomes tile records in tile order: streets and roads at street zoom, a grid below it, service roads left out', t => {
  const dir = mkdtempSync(join(tmpdir(), 'map-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { store, results } = build(dir);
  const counts = writeStateLayers(join(dir, 'tiles.bin'), { store, results, stateName: 'Testland' });
  assert.equal(counts.streets, 2);
  assert.equal(counts.roads, 1, 'the motorway is drawn gray; the service road is not drawn');
  assert.equal(counts.cameras, 1);
  assert.equal(counts.destinations, 1);

  const records = recordTiles(join(dir, 'tiles.bin'));
  assert.ok(records.every((r, i) => i === 0 || records[i - 1].id <= r.id), 'records are in tile id order');
  const zooms = layer => [...new Set(records.filter(r => r.layer === layer).map(r => r.z))].sort((a, b) => a - b);
  const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
  assert.deepEqual(zooms(3), range(LOCAL_ZOOM - 1, STREET_ZOOM + 1), 'residential streets are lines from one zoom before LOCAL_ZOOM in, to cross-fade with the grid');
  assert.deepEqual(zooms(2), range(ROAD_ZOOM.motorway, STREET_ZOOM + 1), 'the motorway is drawn from far enough out to show across a state');
  const streets = records.filter(r => r.layer === 3 && r.z === STREET_ZOOM);
  assert.deepEqual([...new Set(streets.map(r => r.x))].sort(), [913, 914], 'a street crossing a tile edge is in both tiles');
  assert.deepEqual(zooms(0), range(MIN_ZOOM, LOCAL_ZOOM), 'the grid colors the land below');
  for (let z = MIN_ZOOM; z < LOCAL_ZOOM; z++) {
    assert.ok(records.filter(r => r.layer === 0 && r.z === z).length >= 9, `at zoom ${z} a cell with streets also colors the cells around it`);
  }
});

test('merged records make one archive whose street tile carries the trip the page shows', t => {
  const dir = mkdtempSync(join(tmpdir(), 'map-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { store, results } = build(dir);
  writeStateLayers(join(dir, 'tiles.bin'), { store, results, stateName: 'Testland' });
  const writer = new PMTilesWriter(join(dir, 'a.pmtiles'));
  const { tiles } = mergeRecords([new RecordReader(join(dir, 'tiles.bin'))], writer, ['grocery']);
  writer.finish({ metadata: { vector_layers: [] }, bounds: [-100, 39, -99, 41], center: [-99.7, 40, 5] });
  const ids = new Set(recordTiles(join(dir, 'tiles.bin')).map(r => r.id));
  assert.equal(tiles, ids.size, 'one tile per tile id with records');

  const file = readFileSync(join(dir, 'a.pmtiles'));
  const dataOffset = Number(file.readBigUInt64LE(56));
  // Find the zoom-12 tile east of the edge by reading the root directory.
  const dir0 = gunzipSync(file.subarray(Number(file.readBigUInt64LE(8)), Number(file.readBigUInt64LE(8)) + Number(file.readBigUInt64LE(16))));
  let pos = 0;
  const next = () => {
    let b = dir0[pos++];
    let v = b & 0x7f;
    for (let s = 0x80; b & 0x80; s *= 0x80) { b = dir0[pos++]; v += (b & 0x7f) * s; }
    return v;
  };
  const count = next();
  const e = [];
  let id = 0;
  for (let i = 0; i < count; i++) e.push({ id: (id += next()) });
  for (const x of e) x.run = next();
  for (const x of e) x.length = next();
  e.forEach((x, i) => { const v = next(); x.offset = v === 0 && i ? e[i - 1].offset + e[i - 1].length : v - 1; });
  const y = Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + (LAT * Math.PI) / 360)) / Math.PI) / 2 * 4096);
  const entry = e.find(x => x.id === tileId(STREET_ZOOM, 914, y));
  assert.ok(entry, 'the street tile east of the edge is in the archive');
  const tile = gunzipSync(file.subarray(dataOffset + entry.offset, dataOffset + entry.offset + entry.length)).toString('latin1');
  for (const s of ['streets', 'Edge Street', 'Test County, Testland', 'Corner Market', 'grocery_long', 'Town Police', 'cameras']) {
    assert.ok(tile.includes(s), `the tile holds ${s}`);
  }
  const lineEntry = e.find(x => x.id === tileId(LOCAL_ZOOM, 914 / 2, Math.floor(y / 2)));
  assert.ok(lineEntry, 'the street is drawn in its tile at LOCAL_ZOOM');
  const lineTile = gunzipSync(file.subarray(dataOffset + lineEntry.offset, dataOffset + lineEntry.offset + lineEntry.length)).toString('latin1');
  assert.ok(lineTile.includes('Edge Street'), 'a line carries its street name');
  assert.ok(!lineTile.includes('grocery_dest'), 'but not its trip, which waits for STREET_ZOOM');
});

test('street names are grouped per Selection, with the range of Exposure along them', t => {
  const dir = mkdtempSync(join(tmpdir(), 'map-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rows = searchRows(build(dir));
  assert.equal(rows.length, 1, 'both Edge Street ways are one row');
  const [name, sel, west, , east, , lo, hi] = rows[0];
  assert.equal(name, 'Edge Street');
  assert.equal(sel, 0);
  assert.ok(west < EDGE * 1e5 && east > EDGE * 1e5);
  assert.deepEqual([lo, hi], [1, 1], 'the way with no route does not widen the range');
});
