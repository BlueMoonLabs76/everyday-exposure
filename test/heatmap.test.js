import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findOrigins, scorePiece } from '../src/heatmap.js';
import { compactRoads } from '../src/network.js';
import { storeInputs } from '../src/store.js';
import { assembleRings, mostlyInside, onBoundary, studyArea } from '../src/study-area.js';

// A ~100 m grid; at(x, y) is x cells east and y cells north of the corner.
const LON = -100;
const LAT = 40;
const STEP = 0.001;
const at = (x, y) => [LON + x * STEP, LAT + y * STEP];
const way = (id, highway, nodes, tags = {}) => ({
  id,
  nodes: nodes.map(([node]) => node),
  coords: nodes.map(([, x, y]) => at(x, y)),
  tags: { highway, ...tags },
});
const rect = (x0, y0, x1, y1) => ({ west: at(x0, 0)[0], south: at(0, y0)[1], east: at(x1, 0)[0], north: at(0, y1)[1] });
const place = (id, x, y) => ({ id: `node/${id}`, lon: at(x, y)[0], lat: at(x, y)[1], name: `store ${id}` });

// A main street of 251 nodes from x = 0 to x = 25, big enough for destinations to snap onto; a side street
// (way 2) leaving it northward at x = 2; and a separate closed block far to the north.
const main = way(1, 'residential', Array.from({ length: 251 }, (_, k) => [1000 + k, k / 10, 0]));
const side = way(2, 'residential', [[1020, 2, 0], [2000, 2, 1]]);
const block = [
  way(3, 'residential', [[3000, 0, 40], [3001, 1, 40]]),
  way(4, 'residential', [[3001, 1, 40], [3002, 1, 41]]),
  way(5, 'residential', [[3002, 1, 41], [3000, 0, 40]]),
];
function inputs({ ways = [main, side, ...block], grocery = [place(1, 24, 0.001)], cameras = [] } = {}) {
  const roads = compactRoads(ways);
  return storeInputs({ roads, cameras, destinations: { grocery } });
}
const originOf = (store, wayId) => findOrigins(store.roads, () => true).find(o => o.wayId === wayId);
const wide = rect(-80, -80, 100, 120);

test('a trip is kept when it is proven to stay inside the piece, and recomputed when it is not', () => {
  const store = inputs();
  const origin = originOf(store, 2);
  const [small] = scorePiece(store, rect(-3, -3, 7, 4), { grocery: [origin] }).results.grocery;
  assert.equal(small.status, 'failed', 'the route leaves a piece that ends at x = 7');
  const [proven] = scorePiece(store, wide, { grocery: [origin] }).results.grocery;
  assert.equal(proven.status, 'ok');
  assert.equal(proven.destination, 0);
});

test('a destination near the edge of a piece does not prove a trip, even when the trip stays inside', () => {
  const store = inputs();
  // The store at x = 24 is well inside this piece's east edge in road time, but closer than 2 km to it.
  const [r] = scorePiece(store, rect(-80, -80, 40, 80), { grocery: [originOf(store, 2)] }).results.grocery;
  assert.equal(r.status, 'failed');
});

test('a street that can reach no destination, and cannot leave the piece, is proven to have none', () => {
  const store = inputs();
  const [r] = scorePiece(store, wide, { grocery: [originOf(store, 3)] }).results.grocery;
  assert.equal(r.status, 'none');
});

test('a destination never snaps onto an isolated fragment of road', () => {
  // A two-node service road right beside the store; the main street is 90 m away.
  const fragment = way(6, 'service', [[4000, 23.5, 0.9], [4001, 24.5, 0.9]]);
  const store = inputs({ ways: [main, side, ...block, fragment], grocery: [place(1, 24, 0.85)] });
  const [r] = scorePiece(store, wide, { grocery: [originOf(store, 2)] }).results.grocery;
  assert.equal(r.status, 'ok', 'the trip ends on the main street, not on a fragment it cannot reach');
});

test('Exposure counts the cameras along the route to the chosen destination only', () => {
  const cameras = [
    { id: 1, lon: at(10, 0)[0], lat: at(10, 0.0002)[1] }, // beside the main street on the way
    { id: 2, lon: at(25, 0)[0], lat: at(25, 0.0002)[1] }, // past the store
  ];
  const store = inputs({ cameras });
  const [r] = scorePiece(store, wide, { grocery: [originOf(store, 2)] }).results.grocery;
  assert.deepEqual(r.cameras, [1]);
});

test('each surface street way inside the area gives one Origin at half its length', () => {
  const roads = compactRoads([
    way(20, 'residential', [[1, 0, 0], [2, 1, 0], [3, 3, 0]]),
    way(21, 'service', [[4, 0, 2], [5, 3, 2]]),
    way(22, 'unclassified', [[6, 10, 0], [7, 12, 0]]),
    way(23, 'secondary', [[8, 0, 4], [9, 3, 4]]),
    way(24, 'motorway_link', [[10, 0, 6], [11, 3, 6]]),
  ]);
  const origins = findOrigins(roads, ([lon]) => lon < at(5, 0)[0]);
  assert.deepEqual(origins.map(o => o.wayId), [20, 23]);
  assert.equal(origins[0].segment, 1);
  assert.ok(Math.abs(origins[0].lonlat[0] - at(1.5, 0)[0]) < 1e-9);
});

// A boundary relation's member ways arrive unordered, split, and sometimes reversed.
const seg = pts => ({ type: 'way', role: 'outer', geometry: pts.map(([x, y]) => ({ lon: at(x, y)[0], lat: at(x, y)[1] })) });
const ring = (x0, y0, x1, y1) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];

test('a boundary ring is stitched from unordered, reversed member ways', () => {
  // A 2x2 square walked as three fragments, one of them backwards and listed out of order.
  const rings = assembleRings([
    seg([[2, 0], [2, 2], [0, 2]]),
    seg([[0, 0], [0, 2]]), // backwards: shares its end with the fragment above
    seg([[0, 0], [2, 0]]),
  ]);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0][0], rings[0].at(-1), 'ring must close');
  assert.equal(rings[0].length, 5);
});

test('an unclosed boundary ring is an error, never a silently open polygon', () => {
  assert.throws(() => assembleRings([seg([[0, 0], [2, 0]]), seg([[2, 2], [0, 2]])]), /does not close/);
});

test('an area holds points inside its outer ring and excludes its holes', () => {
  const inArea = studyArea({ outer: [ring(0, 0, 10, 10)], inner: [ring(4, 4, 6, 6)] });
  assert.equal(inArea(at(5, 1)), true, 'inside the outer ring');
  assert.equal(inArea(at(5, 5)), false, 'inside an enclave');
  assert.equal(inArea(at(20, 5)), false, 'outside the outer ring');
});

test('a boundary of several areas is their union, and a hole belongs only to its own area', () => {
  const inArea = studyArea({
    areas: [
      { relation: 1, name: 'A', outer: [ring(0, 0, 10, 10)], inner: [ring(4, 4, 6, 6)] },
      { relation: 2, name: 'B', outer: [ring(4.5, 4.5, 5.5, 5.5)], inner: [] },
      { relation: 3, name: 'C', outer: [ring(20, 0, 30, 10)], inner: [] },
    ],
  });
  assert.equal(inArea(at(1, 1)), true, 'inside A');
  assert.equal(inArea(at(25, 5)), true, 'inside C');
  assert.equal(inArea(at(4.2, 4.2)), false, 'in the enclave of A and in no other area');
  assert.equal(inArea(at(5, 5)), true, 'in the enclave of A but inside B');
  assert.equal(inArea(at(15, 5)), false, 'between the areas');
});

test('a ring of many points is tested as exactly as a simple one', () => {
  // A circle of 20,000 points, so its edges spread over many bands.
  const circle = Array.from({ length: 20001 }, (_, k) => at(50 + 40 * Math.cos((2 * Math.PI * k) / 20000), 50 + 40 * Math.sin((2 * Math.PI * k) / 20000)));
  const inArea = studyArea({ outer: [circle], inner: [] });
  assert.equal(inArea(at(50, 50)), true);
  assert.equal(inArea(at(50, 89.9)), true);
  assert.equal(inArea(at(50, 90.1)), false);
  assert.equal(inArea(at(79, 79)), false);
});

test('a county sharing the state line belongs to the state that holds most of it', () => {
  const inState = studyArea({ outer: [ring(0, 0, 10, 10)], inner: [] });
  assert.equal(mostlyInside(inState, { outer: [[at(1, 1), at(10, 1), at(10, 3), at(1, 3), at(1, 1)]] }), true);
  assert.equal(mostlyInside(inState, { outer: [[at(10, 1), at(14, 1), at(14, 3), at(10, 3), at(10, 1)]] }), false);
});

test('a county whose state line has more points than its inland edge still belongs to the state', () => {
  // The state's east edge winds through many vertices, as a river border does; the county shares all of them.
  const river = Array.from({ length: 41 }, (_, k) => at(10 + (k % 2) * 0.1, k / 4));
  const state = { outer: [[at(0, 0), ...river, at(0, 10), at(0, 0)]], inner: [] };
  const county = { outer: [[at(8, 0), ...river, at(8, 10), at(8, 0)]] };
  const inState = studyArea(state);
  assert.equal(mostlyInside(inState, county, onBoundary(state)), true);
  const neighbour = { outer: [[at(14, 0), ...river, at(14, 10), at(14, 0)]] };
  assert.equal(mostlyInside(inState, neighbour, onBoundary(state)), false);
});
