import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { NO_TAGS, openExtract, scan } from '../src/pbf.js';
import { readState } from '../src/store.js';

// A minimal protobuf writer, enough to build small PBF files for the reader to read back.
const varint = n => {
  const out = [];
  for (; n >= 0x80; n = Math.floor(n / 0x80)) out.push((n % 0x80) | 0x80);
  out.push(n);
  return out;
};
const zigzag = n => (n < 0 ? -2 * n - 1 : 2 * n);
const int = (field, n) => [...varint(field * 8), ...varint(n)];
const bytes = (field, data) => [...varint(field * 8 + 2), ...varint(data.length), ...data];
const str = (field, s) => bytes(field, [...Buffer.from(s)]);
const packed = (field, values) => bytes(field, values.flatMap(varint));
const deltas = values => values.map((v, i) => zigzag(v - (values[i - 1] ?? 0)));
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

// A PrimitiveBlock. fill(sid) returns its groups, where sid(string) is the string's index in the block's table.
// Granularity and offsets are written after the groups, as the format allows fields in any order.
function block(fill, { granularity = 100, latOffset = 0, lonOffset = 0 } = {}) {
  const strings = [''];
  const sid = s => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1);
  const groups = fill(sid);
  const table = strings.flatMap(s => str(1, s));
  return [...bytes(1, table), ...groups.flatMap(g => bytes(2, g)), ...int(17, granularity), ...int(19, latOffset), ...int(20, lonOffset)];
}
const keys = (sid, tags = {}) => Object.keys(tags).map(sid);
const vals = (sid, tags = {}) => Object.values(tags).map(sid);
const denseNodes = (sid, nodes) =>
  bytes(2, [
    ...packed(1, deltas(nodes.map(n => n.id))),
    ...packed(8, deltas(nodes.map(n => n.lat))),
    ...packed(9, deltas(nodes.map(n => n.lon))),
    ...packed(10, nodes.flatMap(n => [...Object.entries(n.tags ?? {}).flatMap(([k, v]) => [sid(k), sid(v)]), 0])),
  ]);
const plainNodes = (sid, nodes) =>
  nodes.flatMap(n =>
    bytes(1, [...int(1, zigzag(n.id)), ...packed(2, keys(sid, n.tags)), ...packed(3, vals(sid, n.tags)), ...int(8, zigzag(n.lat)), ...int(9, zigzag(n.lon))]),
  );
const ways = (sid, list) =>
  list.flatMap(w => bytes(3, [...int(1, w.id), ...packed(2, keys(sid, w.tags)), ...packed(3, vals(sid, w.tags)), ...packed(8, deltas(w.refs))]));
const relations = (sid, list) =>
  list.flatMap(r =>
    bytes(4, [
      ...int(1, r.id),
      ...packed(2, keys(sid, r.tags)),
      ...packed(3, vals(sid, r.tags)),
      ...packed(8, r.members.map(m => sid(m.role))),
      ...packed(9, deltas(r.members.map(m => m.ref))),
      ...packed(10, r.members.map(m => ['node', 'way', 'relation'].indexOf(m.type))),
    ]),
  );

// Writes a PBF file: a raw header block, then the data blocks, alternately zlib-compressed and raw.
function writePbf(path, { timestamp, blocks }) {
  const blob = (type, data, zlib) => {
    const body = zlib ? [...int(2, data.length), ...bytes(3, [...deflateSync(Buffer.from(data))])] : bytes(1, data);
    const head = [...str(1, type), ...int(3, body.length)];
    return [...u32(head.length), ...head, ...body];
  };
  const header = [...str(4, 'OsmSchema-V0.6'), ...str(4, 'DenseNodes'), ...int(32, timestamp)];
  writeFileSync(path, Buffer.from([...blob('OSMHeader', header, false), ...blocks.flatMap((b, i) => blob('OSMData', b, i % 2 === 0))]));
}

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pbf-test-'));
  try {
    return fn(name => join(dir, name));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The same ~100 m grid as the other tests, with coordinates as OSM stores them: 7 decimals.
const round7 = x => Math.round(x * 1e7) / 1e7;
const at = (x, y) => [round7(-100 + x * 0.001), round7(40 + y * 0.001)];
const node = (id, x, y, tags) => ({ id, lon: Math.round(at(x, y)[0] * 1e7), lat: Math.round(at(x, y)[1] * 1e7), tags });
const SNAPSHOT = '2026-09-14T20:21:51Z';
const timestamp = Date.parse(SNAPSHOT) / 1000;

// A state 10x10 cells, drawn by a boundary relation of two member ways, with an independent city inside it.
const ALPR = { man_made: 'surveillance', 'surveillance:type': 'ALPR' };
const STATE_TAGS = { type: 'boundary', boundary: 'administrative', admin_level: '4', 'ISO3166-2': 'US-TS', name: 'Testland' };
const TOWN = {
  nodes: [
    node(1, 0, 0), node(2, 10, 0), node(3, 10, 10), node(4, 0, 10),
    node(10, 2, 2), node(11, 4, 2), node(12, 8, 5), node(13, 15, 5), node(14, 15, 6), node(15, 16, 6),
    node(30, 5, 5, { shop: 'supermarket', brand: 'Kroger', name: 'Kroger Marketplace' }),
    node(31, 5, 4, { shop: 'supermarket', name: 'Corner Market' }), // not one of the grocery chains
    node(32, 4, 5, { amenity: 'fuel', brand: 'Kroger', name: 'Kroger Fuel Center' }), // gas, not grocery
    node(33, 6, 4, { amenity: 'hospital', name: 'Smallton General' }),
    node(34, 4, 6, { amenity: 'restaurant', brand: 'Waffle House' }),
    node(40, 6, 6), node(41, 7, 6), node(42, 7, 8), node(43, 6, 8),
    node(50, 1, 8), node(51, 2, 8), node(52, 2, 9),
    node(60, 1, 1), node(61, 3, 1), node(62, 3, 3),
  ],
  plainNodes: [node(20, 3, 3, ALPR), node(21, 20, 20, ALPR)],
  ways: [
    { id: 100, refs: [10, 11], tags: { highway: 'residential', name: 'Elm St' } },
    { id: 101, refs: [12, 13], tags: { highway: 'primary' } }, // leaves the state's surroundings
    { id: 102, refs: [14, 15], tags: { highway: 'residential' } }, // wholly outside them
    { id: 103, refs: [10, 11], tags: { highway: 'footway' } },
    { id: 104, refs: [40, 41, 42, 43, 40], tags: { amenity: 'fuel', brand: 'Fuel Co' } },
    { id: 105, refs: [50, 51, 52, 50] },
    { id: 106, refs: [1, 2, 3] },
    { id: 107, refs: [1, 4, 3] },
    { id: 108, refs: [60, 61, 62, 60] },
    { id: 109, refs: [10, 11], tags: { highway: 'service', access: 'private' } },
  ],
  relations: [
    { id: 200, tags: { type: 'multipolygon', shop: 'grocery', name: 'Aldi' }, members: [{ type: 'way', ref: 105, role: 'outer' }] },
    {
      id: 300,
      tags: STATE_TAGS,
      members: [
        { type: 'way', ref: 106, role: 'outer' },
        { type: 'node', ref: 4, role: 'label' },
        { type: 'way', ref: 107, role: 'outer' },
      ],
    },
    {
      id: 400,
      tags: { type: 'boundary', boundary: 'administrative', admin_level: '6', border_type: 'city', name: 'Smallton' },
      members: [{ type: 'way', ref: 108, role: 'outer' }],
    },
  ],
};
const townBlocks = (town = TOWN) => [
  block(sid => [denseNodes(sid, town.nodes)]),
  block(sid => [plainNodes(sid, town.plainNodes)]),
  block(sid => [ways(sid, town.ways)]),
  block(sid => [relations(sid, town.relations)]),
];
// The state's surroundings: the 10x10 square.
const keep = (w, s, e, n) => w <= at(10, 0)[0] && e >= at(0, 0)[0] && s <= at(0, 10)[1] && n >= at(0, 0)[1];
const read = (paths, options = {}) => readState(paths.map((path, i) => ({ path, own: i === 0 })), { iso: 'US-TS', keep, ...options });

test('the reader decodes dense and plain nodes, ways, relations, tags, and the snapshot time', () => {
  withDir(file => {
    const path = file('test.osm.pbf');
    writePbf(path, { timestamp, blocks: townBlocks() });
    const extract = openExtract(path);
    const seen = { nodes: new Map(), ways: new Map(), relations: new Map() };
    scan(extract, {
      node: (id, lon, lat, tags) => seen.nodes.set(id, { lon, lat, tags }),
      way: (id, refs, tags) => seen.ways.set(id, { refs, tags }),
      relation: (id, members, tags) => seen.relations.set(id, { members, tags }),
    });
    extract.close();
    assert.equal(extract.osmSnapshot, SNAPSHOT);
    assert.equal(seen.nodes.size, TOWN.nodes.length + TOWN.plainNodes.length);
    assert.deepEqual(seen.nodes.get(12), { lon: at(8, 5)[0], lat: at(8, 5)[1], tags: NO_TAGS });
    assert.deepEqual(seen.nodes.get(31).tags, { shop: 'supermarket', name: 'Corner Market' });
    assert.deepEqual(seen.nodes.get(21), { lon: at(20, 20)[0], lat: at(20, 20)[1], tags: ALPR });
    assert.deepEqual(seen.ways.get(104), { refs: [40, 41, 42, 43, 40], tags: { amenity: 'fuel', brand: 'Fuel Co' } });
    assert.equal(seen.ways.get(105).tags, NO_TAGS);
    assert.deepEqual(seen.relations.get(300).members[1], { type: 'node', ref: 4, role: 'label' });
  });
});

test('coordinates honour a block granularity and offsets other than the defaults', () => {
  withDir(file => {
    const path = file('test.osm.pbf');
    // 40.0000002 = (200 + 1000 × 40000000) nanodegrees; -99.9999997 = (300 + 1000 × -100000000) nanodegrees.
    const nodes = [{ id: 7, lat: 40000000, lon: -100000000 }];
    writePbf(path, { timestamp, blocks: [block(sid => [denseNodes(sid, nodes)], { granularity: 1000, latOffset: 200, lonOffset: 300 })] });
    const extract = openExtract(path);
    const seen = [];
    scan(extract, { node: (id, lon, lat) => seen.push([id, lon, lat]) });
    extract.close();
    assert.deepEqual(seen, [[7, -99.9999997, 40.0000002]]);
  });
});

test("a state's inputs are its drivable roads, cameras and destinations near it, its boundary and its counties", () => {
  withDir(file => {
    const path = file('test.osm.pbf');
    writePbf(path, { timestamp, blocks: townBlocks() });
    const inputs = read([path]);
    assert.equal(inputs.osmSnapshot, SNAPSHOT);

    assert.equal(inputs.state.name, 'Testland');
    assert.equal(inputs.state.relation, 300);
    assert.equal(inputs.state.outer[0].length, 5);
    assert.deepEqual(inputs.state.outer[0][0], inputs.state.outer[0].at(-1));
    assert.deepEqual(inputs.counties.map(c => [c.relation, c.name, c.kind]), [[400, 'Smallton', 'city']]);

    // Footways, private roads and roads wholly outside are left out; a road leaving keeps its whole geometry.
    const { roads } = inputs;
    assert.deepEqual([...roads.wayId], [100, 101]);
    const coords = w => Array.from(roads.wayRefs.subarray(roads.wayStart[w], roads.wayStart[w + 1]), n => [roads.nodeLon[n] / 1e7, roads.nodeLat[n] / 1e7]);
    assert.deepEqual(coords(0), [at(2, 2), at(4, 2)]);
    assert.deepEqual(coords(1), [at(8, 5), at(15, 5)]);
    assert.equal(roads.names[roads.wayName[0]], 'Elm St');
    assert.deepEqual(inputs.cameras, [{ id: 20, lon: at(3, 3)[0], lat: at(3, 3)[1], tags: ALPR }]);

    // Destinations mapped as ways and relations sit at the centre of their bounding box.
    const place = (type, osmId, [lon, lat], tags) => ({ id: `${type}/${osmId}`, type, osmId, lat, lon, name: tags.name ?? tags.brand ?? null, tags });
    // Grocery is only the named chains' stores, not their fuel centers.
    assert.deepEqual(inputs.destinations.grocery, [
      place('node', 30, at(5, 5), { shop: 'supermarket', brand: 'Kroger', name: 'Kroger Marketplace' }),
      place('relation', 200, at(1.5, 8.5), { type: 'multipolygon', shop: 'grocery', name: 'Aldi' }),
    ]);
    assert.deepEqual(inputs.destinations.gas, [
      place('node', 32, at(4, 5), { amenity: 'fuel', brand: 'Kroger', name: 'Kroger Fuel Center' }),
      place('way', 104, at(6.5, 7), { amenity: 'fuel', brand: 'Fuel Co' }),
    ]);
    assert.deepEqual(inputs.destinations.hospital, [place('node', 33, at(6, 4), { amenity: 'hospital', name: 'Smallton General' })]);
    assert.deepEqual(inputs.destinations.waffle_house, [place('node', 34, at(4, 6), { amenity: 'restaurant', brand: 'Waffle House' })]);
  });
});

test('a way held by two overlapping extracts is read once', () => {
  withDir(file => {
    writePbf(file('a.osm.pbf'), { timestamp, blocks: townBlocks() });
    writePbf(file('b.osm.pbf'), { timestamp, blocks: townBlocks({ ...TOWN, relations: [] }) });
    const inputs = read([file('a.osm.pbf'), file('b.osm.pbf')]);
    assert.deepEqual([...inputs.roads.wayId], [100, 101]);
    assert.equal(inputs.roads.nodeId.length, 4);
    assert.equal(inputs.destinations.grocery.length, 2);
  });
});

test('extracts from different OSM snapshots are refused', () => {
  withDir(file => {
    writePbf(file('a.osm.pbf'), { timestamp, blocks: townBlocks() });
    writePbf(file('b.osm.pbf'), { timestamp: timestamp + 86400, blocks: townBlocks() });
    assert.throws(() => read([file('a.osm.pbf'), file('b.osm.pbf')]), /not one OSM snapshot/);
  });
});

test('a state boundary the extract does not hold whole is an error, never a partial Study Area', () => {
  withDir(file => {
    const path = file('test.osm.pbf');
    writePbf(path, { timestamp, blocks: townBlocks({ ...TOWN, ways: TOWN.ways.filter(w => w.id !== 107) }) });
    assert.throws(() => read([path]), /boundary relation 300 \(US-TS\) is incomplete/);
    assert.throws(() => read([path], { iso: 'US-XX' }), /no boundary relation tagged admin_level=4 and ISO3166-2=US-XX/);
  });
});

test('a file that is not PBF, such as an HTML error page, is refused', () => {
  withDir(file => {
    const path = file('test.osm.pbf');
    writeFileSync(path, '<html><body>302 Found</body></html>');
    assert.throws(() => openExtract(path), /is not an OSM PBF file/);
  });
});
