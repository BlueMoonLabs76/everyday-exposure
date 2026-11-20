import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observations } from '../src/exposure.js';
import { buildNetwork, compactRoads, route, routeViaTree, snap, treeToward } from '../src/network.js';

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
const network = ways => buildNetwork(compactRoads(ways));
const wayIds = r => r.segments.map(s => s.wayId);

const A = [1, 0, 0];
const B = [2, 1, 0];
const C = [3, 1, 1];
const D = [4, 0, 1];
// A square block whose east side (B→C) is one-way northbound.
const block = [
  way(10, 'residential', [A, B]),
  way(11, 'residential', [B, C], { oneway: 'yes' }),
  way(12, 'residential', [C, D]),
  way(13, 'residential', [D, A]),
];

test('a one-way street is driven directly with the flow and around the block against it', () => {
  const net = network(block);
  const north = snap(net, at(1.0001, 0.7));
  const south = snap(net, at(1.0001, 0.3));
  assert.deepEqual(wayIds(route(net, south, north)), [11]);
  assert.deepEqual(wayIds(route(net, north, south)), [11, 12, 13, 10, 11]);
});

test('an Origin goes to the target it reaches first, even when a one-way street makes the nearer one farther', () => {
  const net = network(block);
  const behind = snap(net, at(1.0001, 0.3));
  const around = snap(net, at(0.5, 0.0001));
  const tree = treeToward(net, [behind, around]);
  // The target 40 m behind on the one-way street is a trip around the block; the other is closer by road.
  assert.equal(routeViaTree(net, tree, snap(net, at(1.0001, 0.7))).target, 1);
  assert.equal(routeViaTree(net, tree, snap(net, at(1.0001, 0.2))).target, 0);
});

test('points never snap onto a motorway, and nothing snaps beyond 2 km', () => {
  const net = network([
    way(20, 'motorway', [[5, 0, 0], [6, 1, 0]]),
    way(21, 'residential', [[7, 0, 1], [8, 1, 1]]),
  ]);
  assert.equal(snap(net, at(0.5, 0.05)).wayId, 21);
  assert.equal(snap(net, at(0.5, 30)), null);
});

test('a snap equally near two ways takes the lower way id, whichever was loaded first', () => {
  const ways = [
    way(31, 'residential', [[1, 0, 0], [2, 1, 0]]),
    way(30, 'residential', [[3, 0, 0], [4, 1, 0]]),
  ];
  for (const order of [ways, [...ways].reverse()]) assert.equal(snap(network(order), at(0.5, 0.2)).wayId, 30);
});

test('private and no-access ways are not driven', () => {
  const net = network([
    way(30, 'service', [[1, 0, 0], [2, 1, 0]], { access: 'private' }),
    way(31, 'residential', [[3, 0, 1], [4, 1, 1]]),
  ]);
  assert.equal(net.wayCount, 1);
  assert.equal(snap(net, at(0.5, 0.1)).wayId, 31);
});

test('two equally fast routes resolve by OSM way id, whatever order the roads were loaded in', () => {
  // Two ways over the same two nodes, so the trips along them take exactly the same time.
  const ways = [
    way(7, 'residential', [[1, 0, 0], [2, 1, 0]]),
    way(5, 'residential', [[1, 0, 0], [2, 1, 0]]),
    way(9, 'residential', [[2, 1, 0], [3, 2, 0]]),
    way(8, 'residential', [[4, 0, -1], [1, 0, 0]]),
  ];
  for (const order of [ways, [...ways].reverse()]) {
    const net = network(order);
    const tree = treeToward(net, [snap(net, at(1.5, 0.0001), wi => net.wayId[wi] === 9)]);
    const r = routeViaTree(net, tree, snap(net, at(0, -0.5)));
    assert.deepEqual(wayIds(r), [8, 5, 9]);
  }
});

test('a camera beside a corner is one Observation; a camera 30 m away is none', () => {
  const net = network(block);
  const r = route(net, snap(net, at(0.5, 0.0001)), snap(net, at(1.0001, 0.5)));
  assert.deepEqual(wayIds(r), [10, 11]);
  const [bx, by] = at(1, 0);
  const cameras = [
    { id: 1, lon: bx + 0.0001, lat: by - 0.00005 }, // ~11 m from corner B, near both AB and BC
    { id: 2, lon: at(0.5, 0)[0], lat: LAT - 0.00027 }, // ~30 m south of AB
  ];
  assert.deepEqual(observations(r.segments, cameras).map(o => o.camera.id), [1]);
});
