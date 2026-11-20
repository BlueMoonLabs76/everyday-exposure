// Directed drivable road network for one piece of a state: snapping points onto it, and fastest paths.
// A route is an ordered list of segments, each carrying its OSM way, end nodes, highway class, and geometry.
//
// Roads arrive compact (see compactRoads), as a store holds a whole state's worth. Every answer here is the one a
// single build of the whole country would give (ADR 0004): distances are measured in a projection centred on the
// point measured from, and equally good answers are settled by OSM ids, never by the order roads were loaded in.
import { HIGHWAY_CLASSES, NO_SNAP, DRIVABLE, SNAP_M, SPEED_MPH } from './config.js';
import { M_PER_DEG, haversine, lonSpan, pointToSegment, projector } from './geo.js';

const MPS_PER_MPH = 0.44704;
const BLOCKED_ACCESS = new Set(['no', 'private', 'agricultural', 'forestry', 'delivery', 'emergency']);
const NO_SNAP_CLASS = Uint8Array.from(HIGHWAY_CLASSES, h => (NO_SNAP.has(h) ? 1 : 0));
const START = -2;
const ARRIVE = -3;

export function isDrivable(tags) {
  if (!DRIVABLE.has(tags.highway)) return false;
  if (tags.service === 'emergency_access') return false;
  if (tags.oneway === 'reversible' || tags.oneway === 'alternating') return false;
  const access = tags.motorcar ?? tags.motor_vehicle ?? tags.vehicle ?? tags.access;
  return !BLOCKED_ACCESS.has(access);
}

// +1 forward only, -1 backward only, 0 both ways.
export function direction(tags) {
  const oneway = tags.oneway;
  if (oneway === '-1' || oneway === 'reverse') return -1;
  if (oneway === 'yes' || oneway === 'true' || oneway === '1') return 1;
  if (oneway === 'no') return 0;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  if (tags.highway === 'motorway') return 1;
  return 0;
}

export function speedMps(tags) {
  const m = /^(\d+(?:\.\d+)?)\s*(mph)?$/.exec(tags.maxspeed ?? '');
  if (m) return Number(m[1]) * (m[2] ? MPS_PER_MPH : 1000 / 3600);
  return SPEED_MPH[tags.highway] * MPS_PER_MPH;
}

// Compact roads from OSM ways [{ id, nodes, coords: [[lon, lat]], tags }], keeping the drivable ones:
// { names, wayId, wayClass, wayDir, waySpeed, wayName, wayStart, wayRefs, nodeId, nodeLon, nodeLat }.
// Way k's nodes are wayRefs[wayStart[k] .. wayStart[k + 1]); coordinates are integers of 1e-7 degrees, as OSM
// stores them; name 0 is none.
export function compactRoads(ways) {
  const kept = ways.filter(w => w.nodes.length > 1 && isDrivable(w.tags));
  const names = [null];
  const nameOf = new Map();
  const nodeOf = new Map();
  const nodeId = [];
  const nodeLon = [];
  const nodeLat = [];
  const wayStart = [0];
  const wayRefs = [];
  for (const w of kept) {
    w.nodes.forEach((id, k) => {
      let i = nodeOf.get(id);
      if (i === undefined) {
        nodeOf.set(id, (i = nodeId.length));
        nodeId.push(id);
        nodeLon.push(Math.round(w.coords[k][0] * 1e7));
        nodeLat.push(Math.round(w.coords[k][1] * 1e7));
      }
      wayRefs.push(i);
    });
    wayStart.push(wayRefs.length);
  }
  const name = n => {
    if (n == null) return 0;
    if (!nameOf.has(n)) nameOf.set(n, names.push(n) - 1);
    return nameOf.get(n);
  };
  return {
    names,
    wayId: Float64Array.from(kept, w => w.id),
    wayClass: Uint8Array.from(kept, w => HIGHWAY_CLASSES.indexOf(w.tags.highway)),
    wayDir: Int8Array.from(kept, w => direction(w.tags)),
    waySpeed: Float64Array.from(kept, w => speedMps(w.tags)),
    wayName: Int32Array.from(kept, w => name(w.tags.name)),
    wayStart: Int32Array.from(wayStart),
    wayRefs: Int32Array.from(wayRefs),
    nodeId: Float64Array.from(nodeId),
    nodeLon: Int32Array.from(nodeLon),
    nodeLat: Int32Array.from(nodeLat),
  };
}

// The network over some of the roads' ways (their indexes, all of them if omitted). Way and node indexes in the
// network are its own; storeWay and storeNode map them back to the roads.
export function buildNetwork(roads, ways = null) {
  const storeWay = ways ? Int32Array.from(ways) : Int32Array.from({ length: roads.wayId.length }, (_, i) => i);
  const W = storeWay.length;
  let refs = 0;
  for (let i = 0; i < W; i++) refs += roads.wayStart[storeWay[i] + 1] - roads.wayStart[storeWay[i]];

  // Store node → network node, through a scratch array kept on the roads and reset after use.
  if (!roads.nodeScratch) roads.nodeScratch = new Int32Array(roads.nodeId.length).fill(-1);
  const local = roads.nodeScratch;
  const wayStart = new Int32Array(W + 1);
  const wayNodes = new Int32Array(refs);
  const storeNodeOf = new Int32Array(refs);
  let n = 0;
  for (let i = 0, p = 0; i < W; i++) {
    const s = storeWay[i];
    wayStart[i] = p;
    for (let k = roads.wayStart[s]; k < roads.wayStart[s + 1]; k++) {
      const g = roads.wayRefs[k];
      let l = local[g];
      if (l < 0) {
        l = local[g] = n;
        storeNodeOf[n++] = g;
      }
      wayNodes[p++] = l;
    }
    wayStart[i + 1] = p;
  }
  for (let l = 0; l < n; l++) local[storeNodeOf[l]] = -1;
  const storeNode = storeNodeOf.slice(0, n);
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const osmNode = new Float64Array(n);
  for (let l = 0; l < n; l++) {
    lon[l] = roads.nodeLon[storeNode[l]] / 1e7;
    lat[l] = roads.nodeLat[storeNode[l]] / 1e7;
    osmNode[l] = roads.nodeId[storeNode[l]];
  }
  const wayId = new Float64Array(W);
  const wayClass = new Uint8Array(W);
  const wayDir = new Int8Array(W);
  const waySpeed = new Float64Array(W);
  const wayName = new Int32Array(W);
  let m = 0;
  for (let i = 0; i < W; i++) {
    const s = storeWay[i];
    wayId[i] = roads.wayId[s];
    wayClass[i] = roads.wayClass[s];
    wayDir[i] = roads.wayDir[s];
    waySpeed[i] = roads.waySpeed[s];
    wayName[i] = roads.wayName[s];
    m += (wayStart[i + 1] - wayStart[i] - 1) * (wayDir[i] === 0 ? 2 : 1);
  }

  const edgeFrom = new Int32Array(m);
  const edgeTo = new Int32Array(m);
  const edgeWay = new Int32Array(m);
  const edgeTime = new Float64Array(m);
  for (let i = 0, e = 0; i < W; i++) {
    const dir = wayDir[i];
    const speed = waySpeed[i];
    for (let k = wayStart[i] + 1; k < wayStart[i + 1]; k++) {
      const a = wayNodes[k - 1];
      const b = wayNodes[k];
      const time = haversine(lon[a], lat[a], lon[b], lat[b]) / speed;
      if (dir >= 0) { edgeFrom[e] = a; edgeTo[e] = b; edgeWay[e] = i; edgeTime[e++] = time; }
      if (dir <= 0) { edgeFrom[e] = b; edgeTo[e] = a; edgeWay[e] = i; edgeTime[e++] = time; }
    }
  }

  // Compressed adjacency: out-edges of node i are outEdge[outStart[i] .. outStart[i + 1]), in-edges likewise.
  const adjacency = ends => {
    const start = new Int32Array(n + 1);
    for (let e = 0; e < m; e++) start[ends[e] + 1]++;
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const cursor = start.slice(0, n);
    const edges = new Int32Array(m);
    for (let e = 0; e < m; e++) edges[cursor[ends[e]]++] = e;
    return [start, edges];
  };
  const [outStart, outEdge] = adjacency(edgeFrom);
  const [inStart, inEdge] = adjacency(edgeTo);

  return {
    names: roads.names, storeWay, storeNode, wayCount: W, nodeCount: n,
    wayStart, wayNodes, wayId, wayClass, wayDir, waySpeed, wayName, lon, lat, osmNode,
    edgeFrom, edgeTo, edgeWay, edgeTime, outStart, outEdge, inStart, inEdge,
  };
}

export const coord = (net, i) => [net.lon[i], net.lat[i]];
export const highwayOf = (net, wi) => HIGHWAY_CLASSES[net.wayClass[wi]];
export const nameOf = (net, wi) => net.names[net.wayName[wi]];
export const wayCoords = (net, wi) => Array.from(net.wayNodes.subarray(net.wayStart[wi], net.wayStart[wi + 1]), i => coord(net, i));

// For each point [lon, lat], the nearest point on a snappable segment of an accepted way within maxM, or null.
// A tie goes to the lower OSM way id, then the earlier segment.
export function snapPoints(net, points, accept = () => true, maxM = SNAP_M) {
  const best = points.map(() => null);
  if (!points.length) return best;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [x, y] of points) {
    west = Math.min(west, x); east = Math.max(east, x);
    south = Math.min(south, y); north = Math.max(north, y);
  }
  // The points on a grid, as compressed cell lists.
  const G = 0.02;
  const nx = Math.floor((east - west) / G) + 1;
  const ny = Math.floor((north - south) / G) + 1;
  const cellOf = ([x, y]) => Math.floor((x - west) / G) + Math.floor((y - south) / G) * nx;
  const start = new Int32Array(nx * ny + 1);
  for (const p of points) start[cellOf(p) + 1]++;
  for (let c = 0; c < nx * ny; c++) start[c + 1] += start[c];
  const cursor = start.slice(0, nx * ny);
  const inCell = new Int32Array(points.length);
  points.forEach((p, j) => { inCell[cursor[cellOf(p)]++] = j; });

  const dLat = maxM / M_PER_DEG;
  for (let wi = 0; wi < net.wayCount; wi++) {
    if (NO_SNAP_CLASS[net.wayClass[wi]] || !accept(wi)) continue;
    for (let k = net.wayStart[wi]; k < net.wayStart[wi + 1] - 1; k++) {
      const a = net.wayNodes[k];
      const b = net.wayNodes[k + 1];
      const lo = Math.min(net.lat[a], net.lat[b]) - dLat;
      const hi = Math.max(net.lat[a], net.lat[b]) + dLat;
      if (hi < south || lo > north) continue;
      const dLon = lonSpan(maxM, lo, hi);
      const wlo = Math.min(net.lon[a], net.lon[b]) - dLon;
      const whi = Math.max(net.lon[a], net.lon[b]) + dLon;
      if (whi < west || wlo > east) continue;
      const x0 = Math.max(0, Math.floor((wlo - west) / G));
      const x1 = Math.min(nx - 1, Math.floor((whi - west) / G));
      const y0 = Math.max(0, Math.floor((lo - south) / G));
      const y1 = Math.min(ny - 1, Math.floor((hi - south) / G));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const c = cx + cy * nx;
          for (let q = start[c]; q < start[c + 1]; q++) {
            const j = inCell[q];
            const p = points[j];
            if (p[0] < wlo || p[0] > whi || p[1] < lo || p[1] > hi) continue;
            const project = projector(p[1]);
            const { distance, t } = pointToSegment(project(p), project(coord(net, a)), project(coord(net, b)));
            if (distance > maxM) continue;
            const segment = k - net.wayStart[wi];
            const cur = best[j];
            if (!cur || distance < cur.distance ||
              (distance === cur.distance && (net.wayId[wi] < cur.wayId || (net.wayId[wi] === cur.wayId && segment < cur.segment)))) {
              best[j] = { wayIndex: wi, segment, t, distance, wayId: net.wayId[wi] };
            }
          }
        }
      }
    }
  }
  return best.map(s => {
    if (!s) return null;
    const k = net.wayStart[s.wayIndex] + s.segment;
    const [ax, ay] = coord(net, net.wayNodes[k]);
    const [bx, by] = coord(net, net.wayNodes[k + 1]);
    return { ...s, highway: highwayOf(net, s.wayIndex), name: nameOf(net, s.wayIndex), lonlat: [ax + (bx - ax) * s.t, ay + (by - ay) * s.t] };
  });
}

export const snap = (net, lonlat, accept) => snapPoints(net, [lonlat], accept)[0];

// Fastest route between two snapped points, or null if none exists.
export function route(net, a, b) {
  const n = net.nodeCount;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new Heap();

  const starts = new Map();
  for (const link of pointLinks(net, a, true)) {
    if (link.timeS < dist[link.node]) {
      dist[link.node] = link.timeS;
      prev[link.node] = START;
      starts.set(link.node, link);
      heap.push(link.timeS, 0, link.node);
    }
  }
  const ends = new Map();
  for (const link of pointLinks(net, b, false)) {
    if (!ends.has(link.node) || link.timeS < ends.get(link.node).timeS) ends.set(link.node, link);
  }

  let bestTime = Infinity;
  let bestNode = -1;
  let direct = directLink(net, a, b);
  if (direct) bestTime = direct.timeS;

  while (heap.size) {
    const d = heap.topTime();
    const u = heap.pop();
    if (d > dist[u]) continue;
    if (d >= bestTime) break;
    const end = ends.get(u);
    if (end && d + end.timeS < bestTime) {
      bestTime = d + end.timeS;
      bestNode = u;
      direct = null;
    }
    for (let k = net.outStart[u]; k < net.outStart[u + 1]; k++) {
      const e = net.outEdge[k];
      const v = net.edgeTo[e];
      const nd = d + net.edgeTime[e];
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = e;
        heap.push(nd, 0, v);
      }
    }
  }

  if (direct) return summarize([segment(net, a.wayIndex, null, null, direct)]);
  if (bestNode < 0) return null;
  const segments = [segment(net, b.wayIndex, net.osmNode[bestNode], null, ends.get(bestNode))];
  let v = bestNode;
  while (prev[v] !== START) {
    const e = prev[v];
    segments.push(edgeSegment(net, e));
    v = net.edgeFrom[e];
  }
  segments.push(segment(net, a.wayIndex, null, net.osmNode[v], starts.get(v)));
  return summarize(segments.reverse().filter(s => s.lengthM > 0));
}

// The connected road networks, ignoring direction: for each way, the number of nodes in its network, and whether
// that network reaches a node flagged in `outside`, where the piece's roads may be incomplete.
export function networks(net, outside) {
  const parent = Int32Array.from({ length: net.nodeCount }, (_, i) => i);
  const find = i => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let e = 0; e < net.edgeFrom.length; e++) parent[find(net.edgeFrom[e])] = find(net.edgeTo[e]);
  const size = new Int32Array(net.nodeCount);
  const open = new Uint8Array(net.nodeCount);
  for (let i = 0; i < net.nodeCount; i++) {
    const r = find(i);
    size[r]++;
    if (outside?.[i]) open[r] = 1;
  }
  const waySize = new Int32Array(net.wayCount);
  const wayOpen = new Uint8Array(net.wayCount);
  for (let wi = 0; wi < net.wayCount; wi++) {
    const r = find(net.wayNodes[net.wayStart[wi]]);
    waySize[wi] = size[r];
    wayOpen[wi] = open[r];
  }
  return { waySize, wayOpen };
}

// Shortest-path in-tree toward the nearest of several snapped targets, built by one search run backwards from all
// of them at once. For every node: the fastest time to reach any target, the number of edges on that path, the
// first edge to take (or ARRIVE), and which target that is.
//
// Paths compare by time, then by fewest edges, then by the OSM ids of the first edge's way and of the node it
// leads to; a node reached equally fast from two targets takes the earlier target. So the tree is the same in
// every piece that holds the whole of a path and its alternatives, whatever order the roads were loaded in.
export function treeToward(net, targets) {
  const n = net.nodeCount;
  const time = new Float64Array(n).fill(Infinity);
  const hops = new Int32Array(n);
  const next = new Int32Array(n).fill(-1);
  const target = new Int32Array(n).fill(-1);
  const heap = new Heap();
  const onSegment = new Map();
  const seeded = [];
  targets.forEach((t, ti) => {
    const key = segmentKey(t);
    if (!onSegment.has(key)) onSegment.set(key, []);
    onSegment.get(key).push(ti);
    for (const link of pointLinks(net, t, false)) {
      if (link.timeS < time[link.node]) {
        if (time[link.node] === Infinity) seeded.push(link.node);
        time[link.node] = link.timeS;
        next[link.node] = ARRIVE;
        target[link.node] = ti;
      }
    }
  });
  for (const v of seeded) heap.push(time[v], 0, v);

  while (heap.size) {
    const d = heap.topTime();
    const h = heap.topHops();
    const u = heap.pop();
    if (d > time[u] || (d === time[u] && h > hops[u])) continue;
    const nh = h + 1;
    for (let k = net.inStart[u]; k < net.inStart[u + 1]; k++) {
      const e = net.inEdge[k];
      const w = net.edgeFrom[e];
      const nt = d + net.edgeTime[e];
      if (nt < time[w] || (nt === time[w] && nh < hops[w])) {
        time[w] = nt;
        hops[w] = nh;
        next[w] = e;
        target[w] = target[u];
        heap.push(nt, nh, w);
      } else if (nt === time[w] && nh === hops[w] && next[w] >= 0 && firstEdgeWins(net, e, next[w])) {
        // Every path this good reaches w before w leaves the heap, as it has fewer edges.
        next[w] = e;
        target[w] = target[u];
      }
    }
  }
  return { targets, time, hops, next, target, onSegment };
}

function firstEdgeWins(net, e, f) {
  const we = net.wayId[net.edgeWay[e]];
  const wf = net.wayId[net.edgeWay[f]];
  return we < wf || (we === wf && net.osmNode[net.edgeTo[e]] < net.osmNode[net.edgeTo[f]]);
}

// Fastest route from a snapped point to the nearest target of a tree, with the index of that target,
// or null if no target is reachable. Ties are settled as in treeToward.
export function routeViaTree(net, tree, a) {
  let best = null;
  const better = c => !best || c.timeS < best.timeS || (c.timeS === best.timeS && (c.hops < best.hops || (c.hops === best.hops && c.tie < best.tie)));
  for (const link of pointLinks(net, a, true)) {
    if (tree.time[link.node] === Infinity) continue;
    const c = { timeS: link.timeS + tree.time[link.node], hops: tree.hops[link.node] + 1, tie: net.osmNode[link.node], link };
    if (better(c)) best = c;
  }
  for (const ti of tree.onSegment.get(segmentKey(a)) ?? []) {
    const direct = directLink(net, a, tree.targets[ti]);
    const c = direct && { timeS: direct.timeS, hops: 0, tie: ti, direct };
    if (c && better(c)) best = c;
  }
  if (!best) return null;
  if (best.direct) return { ...summarize([segment(net, a.wayIndex, null, null, best.direct)]), target: best.tie };

  let v = best.link.node;
  const segments = [segment(net, a.wayIndex, null, net.osmNode[v], best.link)];
  while (tree.next[v] !== ARRIVE) {
    const e = tree.next[v];
    segments.push(edgeSegment(net, e));
    v = net.edgeTo[e];
  }
  const ti = tree.target[v];
  const b = tree.targets[ti];
  const end = pointLinks(net, b, false).filter(l => l.node === v).reduce((x, y) => (y.timeS < x.timeS ? y : x));
  segments.push(segment(net, b.wayIndex, net.osmNode[v], null, end));
  return { ...summarize(segments.filter(s => s.lengthM > 0)), target: ti };
}

// For every node, the fastest time to drive from it to any node flagged in `outside` (0 for those nodes).
export function timeToOutside(net, outside) {
  const n = net.nodeCount;
  const time = new Float64Array(n).fill(Infinity);
  const heap = new Heap();
  for (let v = 0; v < n; v++) {
    if (!outside[v]) continue;
    time[v] = 0;
    heap.push(0, 0, v);
  }
  while (heap.size) {
    const d = heap.topTime();
    const u = heap.pop();
    if (d > time[u]) continue;
    for (let k = net.inStart[u]; k < net.inStart[u + 1]; k++) {
      const e = net.inEdge[k];
      const w = net.edgeFrom[e];
      const nt = d + net.edgeTime[e];
      if (nt < time[w]) {
        time[w] = nt;
        heap.push(nt, 0, w);
      }
    }
  }
  return time;
}

// The fastest time from a snapped point to leave by any node flagged in timeToOutside's result.
export function timeToLeave(net, outsideTime, a) {
  let best = Infinity;
  for (const link of pointLinks(net, a, true)) best = Math.min(best, link.timeS + outsideTime[link.node]);
  return best;
}

const segmentKey = s => s.wayIndex * 4096 + s.segment;

// Partial edges joining a snapped point to the ends of its segment, honouring oneway.
// outward: point → node (trip start); otherwise node → point (trip end).
function pointLinks(net, s, outward) {
  const u = net.wayNodes[net.wayStart[s.wayIndex] + s.segment];
  const v = net.wayNodes[net.wayStart[s.wayIndex] + s.segment + 1];
  const len = haversine(net.lon[u], net.lat[u], net.lon[v], net.lat[v]);
  const speed = net.waySpeed[s.wayIndex];
  const dir = net.wayDir[s.wayIndex];
  const links = [];
  const add = (node, fraction) => links.push({
    node,
    lengthM: len * fraction,
    timeS: (len * fraction) / speed,
    coords: outward ? [s.lonlat, coord(net, node)] : [coord(net, node), s.lonlat],
  });
  // u → v is the way's forward direction.
  if (outward) {
    if (dir >= 0) add(v, 1 - s.t);
    if (dir <= 0) add(u, s.t);
  } else {
    if (dir >= 0) add(u, s.t);
    if (dir <= 0) add(v, 1 - s.t);
  }
  return links;
}

// Both points on the same segment, reachable without leaving it.
function directLink(net, a, b) {
  if (a.wayIndex !== b.wayIndex || a.segment !== b.segment) return null;
  const dir = net.wayDir[a.wayIndex];
  if (!((dir >= 0 && b.t >= a.t) || (dir <= 0 && b.t <= a.t))) return null;
  const u = net.wayNodes[net.wayStart[a.wayIndex] + a.segment];
  const v = net.wayNodes[net.wayStart[a.wayIndex] + a.segment + 1];
  const lengthM = haversine(net.lon[u], net.lat[u], net.lon[v], net.lat[v]) * Math.abs(b.t - a.t);
  return { lengthM, timeS: lengthM / net.waySpeed[a.wayIndex], coords: [a.lonlat, b.lonlat] };
}

function segment(net, wayIndex, fromNode, toNode, link) {
  return {
    wayId: net.wayId[wayIndex],
    highway: highwayOf(net, wayIndex),
    name: nameOf(net, wayIndex),
    fromNode,
    toNode,
    lengthM: link.lengthM,
    timeS: link.timeS,
    coords: link.coords,
  };
}

function edgeSegment(net, e) {
  const from = net.edgeFrom[e];
  const to = net.edgeTo[e];
  return segment(net, net.edgeWay[e], net.osmNode[from], net.osmNode[to], {
    lengthM: haversine(net.lon[from], net.lat[from], net.lon[to], net.lat[to]),
    timeS: net.edgeTime[e],
    coords: [coord(net, from), coord(net, to)],
  });
}

function summarize(segments) {
  return {
    segments,
    lengthM: segments.reduce((sum, s) => sum + s.lengthM, 0),
    timeS: segments.reduce((sum, s) => sum + s.timeS, 0),
  };
}

// A binary heap of nodes keyed by (time, hops), in growable typed arrays.
class Heap {
  times = new Float64Array(1024);
  hopsOf = new Int32Array(1024);
  nodes = new Int32Array(1024);
  size = 0;

  topTime() {
    return this.times[0];
  }

  topHops() {
    return this.hopsOf[0];
  }

  push(time, hops, node) {
    if (this.size === this.times.length) {
      const grow = (Type, old) => {
        const a = new Type(old.length * 2);
        a.set(old);
        return a;
      };
      this.times = grow(Float64Array, this.times);
      this.hopsOf = grow(Int32Array, this.hopsOf);
      this.nodes = grow(Int32Array, this.nodes);
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.times[p] < time || (this.times[p] === time && this.hopsOf[p] <= hops)) break;
      this.times[i] = this.times[p];
      this.hopsOf[i] = this.hopsOf[p];
      this.nodes[i] = this.nodes[p];
      i = p;
    }
    this.times[i] = time;
    this.hopsOf[i] = hops;
    this.nodes[i] = node;
  }

  // Removes the top entry and returns its node; read topTime() and topHops() first.
  pop() {
    const top = this.nodes[0];
    const n = --this.size;
    if (n > 0) {
      const time = this.times[n];
      const hops = this.hopsOf[n];
      const node = this.nodes[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && (this.times[c + 1] < this.times[c] || (this.times[c + 1] === this.times[c] && this.hopsOf[c + 1] < this.hopsOf[c]))) c++;
        if (time < this.times[c] || (time === this.times[c] && hops <= this.hopsOf[c])) break;
        this.times[i] = this.times[c];
        this.hopsOf[i] = this.hopsOf[c];
        this.nodes[i] = this.nodes[c];
        i = c;
      }
      this.times[i] = time;
      this.hopsOf[i] = hops;
      this.nodes[i] = node;
    }
    return top;
  }
}
