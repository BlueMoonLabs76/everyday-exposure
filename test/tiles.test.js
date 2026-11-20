import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { NO_ROUTE, UNPROVEN, loadResults, packResults, saveResults } from '../src/results.js';
import { PMTilesWriter, buildDirectories, clipLine, encodeTile, lineGeometry, rectGeometry, tileId, worldXY } from '../src/tiles.js';

// A reader for what the writer produces, following PMTiles §4.3.
function varints(buf) {
  let pos = 0;
  return () => {
    let b = buf[pos++];
    let v = b & 0x7f;
    for (let scale = 0x80; b & 0x80; scale *= 0x80) {
      b = buf[pos++];
      v += (b & 0x7f) * scale;
    }
    return v;
  };
}
function readDirectory(gz) {
  const next = varints(gunzipSync(gz));
  const n = next();
  const entries = [];
  let id = 0;
  for (let i = 0; i < n; i++) entries.push({ id: (id += next()) });
  for (const e of entries) e.run = next();
  for (const e of entries) e.length = next();
  entries.forEach((e, i) => {
    const v = next();
    e.offset = v === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : v - 1;
  });
  return entries;
}

test('tile ids follow the Hilbert curves of the PMTiles specification', () => {
  assert.deepEqual([[0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0], [2, 0, 0]].map(([z, x, y]) => tileId(z, x, y)), [0, 1, 2, 3, 4, 5]);
  assert.equal(tileId(12, 3423, 1763), 19078479);
});

test('Web Mercator places the prime meridian and equator at the middle of the world', () => {
  assert.deepEqual(worldXY(0, 0), [0.5, 0.5]);
  const [x, y] = worldXY(-90, 45);
  assert.equal(x, 0.25);
  assert.ok(y > 0.3 && y < 0.36);
});

test('line geometry is a MoveTo and a LineTo with zigzag deltas, and a repeated point is dropped', () => {
  // MoveTo(1) = 9, then (2, 3); LineTo(2) = 18, then (+3, 0) and (0, -1).
  assert.deepEqual(lineGeometry([[2, 3, 2, 3, 5, 3, 5, 2]]), [9, 4, 6, 18, 6, 0, 0, 1]);
  assert.deepEqual(lineGeometry([[1, 1, 1, 1]]), [], 'a part of one point is left out');
});

test('a rectangle is an exterior ring, wound clockwise in tile coordinates, and closed', () => {
  const g = rectGeometry(0, 0, 4, 2);
  assert.deepEqual(g, [9, 0, 0, 26, 8, 0, 0, 4, 7, 0, 15]);
});

test('a line is clipped to a rectangle, split where it leaves and comes back', () => {
  const parts = clipLine([-5, 5, 5, 5, 15, 5, 15, 8, 5, 8], 0, 0, 10, 10);
  assert.deepEqual(parts, [[0, 5, 5, 5, 10, 5], [10, 8, 5, 8]]);
  assert.deepEqual(clipLine([20, 20, 30, 30], 0, 0, 10, 10), []);
});

test('a tile holds each layer with its keys and values shared between features', () => {
  const bytes = encodeTile([{
    name: 'streets',
    extent: 4096,
    features: [
      { id: 7, type: 2, geometry: lineGeometry([[0, 0, 10, 10]]), props: [['name', 'Main Street'], ['grocery', 2], ['unused', null]] },
      { id: 8, type: 2, geometry: lineGeometry([[0, 0, 10, 0]]), props: [['name', 'Main Street'], ['grocery', -1], ['minutes', 4.5]] },
    ],
  }, { name: 'empty', extent: 4096, features: [] }]);
  const text = bytes.toString('latin1');
  assert.equal(text.split('Main Street').length - 1, 1, 'a value repeated between features is stored once');
  assert.equal(text.includes('unused'), false);
  assert.equal(text.includes('empty'), false, 'a layer with no features is left out');
  assert.equal(text.includes('streets'), true);
});

test('directories list every tile, and move into leaf directories when the root would be too large', () => {
  const entries = Array.from({ length: 5000 }, (_, i) => ({ id: i * 3 + 1, offset: i * 100, length: 100, run: 1 }));
  const small = buildDirectories(entries);
  assert.equal(small.leaves.length, 0);
  assert.deepEqual(readDirectory(small.root), entries);

  const { root, leaves } = buildDirectories(entries, 60);
  assert.ok(leaves.length > 1);
  const top = readDirectory(root);
  assert.ok(top.every(e => e.run === 0));
  assert.deepEqual(top.flatMap((e, i) => readDirectory(leaves[i]).map(x => ({ ...x }))), entries);
});

test('an archive has the PMTiles header, its root directory in the first 16 KiB, and each tile where the directory says', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tiles-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'a.pmtiles');
  const w = new PMTilesWriter(path);
  const tiles = [[0, 0, 0, 'zero'], [1, 0, 1, 'two'], [1, 1, 0, 'four']];
  for (const [z, x, y, s] of tiles) w.add(z, x, y, Buffer.from(s));
  assert.throws(() => w.add(1, 0, 0, Buffer.from('one')), /tileId order/);
  w.finish({ metadata: { vector_layers: [] }, bounds: [-125, 24, -66, 50], center: [-98, 39, 4] });

  const file = readFileSync(path);
  assert.equal(file.toString('utf8', 0, 7), 'PMTiles');
  assert.equal(file[7], 3);
  const u64 = o => Number(file.readBigUInt64LE(o));
  const [rootOffset, rootLength, metaOffset, metaLength, , , dataOffset] = [8, 16, 24, 32, 40, 48, 56].map(u64);
  assert.ok(rootOffset + rootLength <= 16384);
  assert.deepEqual(JSON.parse(gunzipSync(file.subarray(metaOffset, metaOffset + metaLength))), { vector_layers: [] });
  const entries = readDirectory(file.subarray(rootOffset, rootOffset + rootLength));
  assert.deepEqual(entries.map(e => e.id), [0, 2, 4]);
  assert.deepEqual(entries.map(e => gunzipSync(file.subarray(dataOffset + e.offset, dataOffset + e.offset + e.length)).toString()), ['zero', 'two', 'four']);
  assert.equal(file.readInt32LE(102), -1250000000);
  assert.deepEqual([file[100], file[101]], [0, 1]);
});

test('results survive saving and loading, with no route and unproven kept apart from a score of 0', t => {
  const dir = mkdtempSync(join(tmpdir(), 'results-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const origins = [0, 1, 2].map(i => ({ storeWay: 10 + i, lonlat: [-77 - i / 10, 38.5] }));
  const results = {
    grocery: [
      { status: 'ok', destination: 3, timeS: 300, lengthM: 4200, cameras: [11, 12] },
      { status: 'none' },
      { status: 'ok', destination: 0, timeS: 60, lengthM: 800, cameras: [] },
    ],
    gas: [{ status: 'unproven' }, { status: 'ok', destination: 1, timeS: 90, lengthM: 1000, cameras: [99] }, { status: 'none' }],
  };
  saveResults(join(dir, 'r.bin'), packResults(origins, results, { osmSnapshot: 'x' }));
  const back = loadResults(join(dir, 'r.bin'));
  assert.equal(back.info.osmSnapshot, 'x');
  assert.deepEqual([...back.arrays.storeWay], [10, 11, 12]);
  assert.deepEqual([...back.categories.grocery.score], [2, NO_ROUTE, 0]);
  assert.deepEqual([...back.categories.gas.score], [UNPROVEN, 1, NO_ROUTE]);
  const g = back.categories.grocery;
  assert.deepEqual([...g.cameraId.subarray(g.cameraStart[0], g.cameraStart[1])], [11, 12]);
  assert.deepEqual([...back.categories.gas.cameraId], [99]);
});
