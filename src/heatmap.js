// Origins, and the Exposure of each Origin's route to each Destination Category, scored piece by piece (ADR 0004).
//
// A piece is a cell of a fixed grid of degrees widened by a buffer, and holds every road that comes near it.
// A result is kept only when it is proven to be the one a single build of the whole country would give:
// - the trip takes less time than the fastest way out of the piece, so no route through the outside is as fast;
// - its destination snapped where it would in the whole country: far enough inside the piece that every road it
//   could snap onto is present, and onto a road network whose size the piece settles;
// - ties were settled by OSM ids (see treeToward), never by what the piece holds.
// Origins that fail are recomputed in a piece with the next, wider buffer.
import { HIGHWAY_CLASSES, MIN_NETWORK_NODES, ORIGIN_ROAD, SNAP_M } from './config.js';
import { cameraIndex, countedPart } from './exposure.js';
import { polygonsMeetRect } from './geofabrik.js';
import { depthInRect, grow, haversine, inRect } from './geo.js';
import { buildNetwork, networks, routeViaTree, snapPoints, timeToLeave, timeToOutside, treeToward } from './network.js';

const ORIGIN_CLASS = Uint8Array.from(HIGHWAY_CLASSES, h => (ORIGIN_ROAD.has(h) ? 1 : 0));
// Cameras this far past a piece's edge can still be within the Observation Radius of a route inside it.
const CAMERA_MARGIN_M = 100;

export const cellOf = ([lon, lat], deg) => [Math.floor(lon / deg), Math.floor(lat / deg)];
export const cellRect = (i, j, deg) => ({ west: i * deg, south: j * deg, east: (i + 1) * deg, north: (j + 1) * deg });

// The cells [i, j] of the piece grid that meet a state's Geofabrik polygon. A state's roads are read as far as the
// widest piece of these cells reaches, so only these cells' pieces are whole.
export function stateCells(polygons, deg) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lon, lat] of polygons.flat(2)) {
    west = Math.min(west, lon); east = Math.max(east, lon);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  const cells = [];
  for (let i = Math.floor(west / deg); i <= Math.floor(east / deg); i++) {
    for (let j = Math.floor(south / deg); j <= Math.floor(north / deg); j++) {
      if (polygonsMeetRect(polygons, cellRect(i, j, deg))) cells.push([i, j]);
    }
  }
  return cells;
}

// One Origin per surface street way whose midpoint (half its length along the way) lies in the area.
// Each Origin is shaped like a snapped point, located by its way in the roads rather than in a network.
export function findOrigins(roads, inArea) {
  const origins = [];
  const lengths = [];
  for (let s = 0; s < roads.wayId.length; s++) {
    if (!ORIGIN_CLASS[roads.wayClass[s]]) continue;
    const first = roads.wayStart[s];
    const lon = k => roads.nodeLon[roads.wayRefs[k]] / 1e7;
    const lat = k => roads.nodeLat[roads.wayRefs[k]] / 1e7;
    lengths.length = 0;
    let total = 0;
    for (let k = first + 1; k < roads.wayStart[s + 1]; k++) {
      const len = haversine(lon(k - 1), lat(k - 1), lon(k), lat(k));
      lengths.push(len);
      total += len;
    }
    let rest = total / 2;
    let k = 0;
    while (k < lengths.length - 1 && rest > lengths[k]) rest -= lengths[k++];
    const t = lengths[k] > 0 ? Math.min(1, rest / lengths[k]) : 0;
    const [ax, ay, bx, by] = [lon(first + k), lat(first + k), lon(first + k + 1), lat(first + k + 1)];
    const lonlat = [ax + (bx - ax) * t, ay + (by - ay) * t];
    if (!inArea(lonlat)) continue;
    origins.push({
      storeWay: s, segment: k, t, lonlat, distance: 0,
      wayId: roads.wayId[s], name: roads.names[roads.wayName[s]], highway: HIGHWAY_CLASSES[roads.wayClass[s]],
    });
  }
  return origins;
}

// The network of every road in a store whose bounding box meets the rectangle. Every road through a node inside
// the rectangle is among them.
export function pieceNetwork({ roads, wayBox }, rect) {
  const [west, south, east, north] = [rect.west, rect.south, rect.east, rect.north].map(x => x * 1e7);
  const ways = [];
  for (let s = 0; s < roads.wayId.length; s++) {
    if (wayBox.west[s] <= east && wayBox.east[s] >= west && wayBox.south[s] <= north && wayBox.north[s] >= south) ways.push(s);
  }
  return buildNetwork(roads, ways);
}

const sameSnap = (a, b) => (!a && !b) || (a && b && a.wayIndex === b.wayIndex && a.segment === b.segment && a.t === b.t);

function localWay(storeWay, s) {
  let lo = 0;
  let hi = storeWay.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (storeWay[mid] < s) lo = mid + 1;
    else if (storeWay[mid] > s) hi = mid - 1;
    else return mid;
  }
  return -1;
}

// Scores Origins in one piece. inputs: a store (see loadStore). rect: the piece. jobs: { category: [origin] }.
// Returns { results: { category: [result] }, stats }, a result per Origin:
//   { status: 'ok', destination (index into inputs.destinations[category]), timeS, lengthM, cameras: [ids] }
//   { status: 'none' }    no destination can be reached, proven: no route leaves the piece either
//   { status: 'failed' }  not proven here; recompute in a wider piece
// With keepRoutes, an 'ok' result also carries its route and the network it was found in.
export function scorePiece(inputs, rect, jobs, { keepRoutes = false } = {}) {
  const started = performance.now();
  let peak = process.memoryUsage().rss;
  const sample = () => { peak = Math.max(peak, process.memoryUsage().rss); };

  const net = pieceNetwork(inputs, rect);
  const outside = new Uint8Array(net.nodeCount);
  for (let v = 0; v < net.nodeCount; v++) outside[v] = inRect(rect, net.lon[v], net.lat[v]) ? 0 : 1;
  const leaveTime = timeToOutside(net, outside);
  // A network reaching outside the piece may be larger in the whole country than it is here.
  const { waySize, wayOpen } = networks(net, outside);
  const surely = wi => waySize[wi] >= MIN_NETWORK_NODES;
  const perhaps = wi => waySize[wi] >= MIN_NETWORK_NODES || wayOpen[wi] === 1;
  const reach = grow(rect, SNAP_M + inputs.maxSegmentM);
  // A road segment within SNAP_M of a destination this deep has a node inside the piece, so the piece holds it.
  const depth = SNAP_M + inputs.maxSegmentM / 2;
  const nearRect = grow(rect, CAMERA_MARGIN_M);
  const cameras = cameraIndex(inputs.cameras.filter(c => inRect(nearRect, c.lon, c.lat)));
  sample();

  const stats = { ways: net.wayCount, nodes: net.nodeCount, origins: 0, failed: {}, none: {} };
  const results = {};
  const counted = new Set();
  for (const [key, origins] of Object.entries(jobs)) {
    if (!origins.length) continue;
    const all = inputs.destinations[key];
    const near = [];
    all.forEach((d, g) => { if (inRect(reach, d.lon, d.lat)) near.push(g); });
    const points = near.map(g => [all[g].lon, all[g].lat]);
    const sure = snapPoints(net, points, surely);
    const maybe = snapPoints(net, points, perhaps);
    // Targets in the destinations' canonical order. A destination the piece cannot place for certain is a
    // poisoned target at every place it might snap: a trip that ends there is not proven.
    const targets = [];
    near.forEach((g, q) => {
      const d = all[g];
      const certain = inRect(rect, d.lon, d.lat) && depthInRect(rect, d.lon, d.lat) >= depth && sameSnap(sure[q], maybe[q]);
      if (sure[q]) targets.push({ snap: sure[q], destination: g, poison: !certain });
      if (maybe[q] && !sameSnap(sure[q], maybe[q])) targets.push({ snap: maybe[q], destination: g, poison: true });
    });
    const tree = treeToward(net, targets.map(t => t.snap));
    sample();

    let failed = 0;
    let none = 0;
    results[key] = origins.map(o => {
      counted.add(o);
      const start = { wayIndex: localWay(net.storeWay, o.storeWay), segment: o.segment, t: o.t, lonlat: o.lonlat, distance: 0 };
      const leave = timeToLeave(net, leaveTime, start);
      const r = routeViaTree(net, tree, start);
      if (!r || targets[r.target].poison || !(r.timeS < leave)) {
        if (!r && leave === Infinity) {
          none++;
          return { status: 'none' };
        }
        failed++;
        return { status: 'failed' };
      }
      const result = { status: 'ok', destination: targets[r.target].destination, timeS: r.timeS, lengthM: r.lengthM, cameras: cameras.observe(countedPart(r.segments)).map(obs => obs.camera.id) };
      return keepRoutes ? { ...result, route: r, snap: targets[r.target].snap, net } : result;
    });
    stats.failed[key] = failed;
    stats.none[key] = none;
  }
  stats.origins = counted.size;
  stats.seconds = (performance.now() - started) / 1000;
  sample();
  stats.peakMB = peak / 1e6;
  return { results, stats };
}

// Scores every Origin in pieces: each cell's Origins in its cell widened by the first buffer, the ones that fail
// in the next buffer, and so on. Returns { results: { category: [result per Origin] }, pieces: [stats] }; an
// Origin still failing after the last buffer gets { status: 'unproven' }. cells, if given, are the cells whose
// pieces the inputs hold whole (see stateCells); an Origin in any other cell is an error.
export function scoreState(inputs, origins, { cellDeg, buffers, cells: whole = null, log = () => {} }) {
  const keys = Object.keys(inputs.destinations);
  const results = Object.fromEntries(keys.map(k => [k, new Array(origins.length).fill(null)]));
  const wholeCells = whole && new Set(whole.map(([i, j]) => `${i},${j}`));
  const addJob = (cells, n, key) => {
    const [i, j] = cellOf(origins[n].lonlat, cellDeg);
    const id = `${i},${j}`;
    if (wholeCells && !wholeCells.has(id)) {
      throw new Error(`Origin way ${origins[n].wayId} lies in piece cell ${id}, beyond the roads that were read. Run fetch-data again.`);
    }
    if (!cells.has(id)) cells.set(id, { i, j, jobs: Object.fromEntries(keys.map(k => [k, []])) });
    cells.get(id).jobs[key].push(n);
  };
  let pending = new Map();
  origins.forEach((_, n) => keys.forEach(k => addJob(pending, n, k)));

  const pieces = [];
  for (const bufferM of buffers) {
    const next = new Map();
    const cells = [...pending.values()].sort((a, b) => b.j - a.j || a.i - b.i);
    for (const cell of cells) {
      const rect = grow(cellRect(cell.i, cell.j, cellDeg), bufferM);
      const jobs = Object.fromEntries(keys.map(k => [k, cell.jobs[k].map(n => origins[n])]));
      const { results: scored, stats } = scorePiece(inputs, rect, jobs);
      for (const k of keys) {
        (scored[k] ?? []).forEach((r, q) => {
          const n = cell.jobs[k][q];
          if (r.status === 'failed') addJob(next, n, k);
          else results[k][n] = r;
        });
      }
      const piece = { cell: [cell.i, cell.j], rect: cellRect(cell.i, cell.j, cellDeg), bufferM, ...stats };
      pieces.push(piece);
      log(piece);
    }
    pending = next;
  }
  for (const cell of pending.values()) for (const k of keys) for (const n of cell.jobs[k]) results[k][n] = { status: 'unproven' };
  return { results, pieces };
}
