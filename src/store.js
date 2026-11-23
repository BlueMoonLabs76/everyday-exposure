// A state's study inputs, read once from its extract and its neighbours' (ADR 0003, ADR 0004) and kept on disk:
// the drivable roads near the state in compact arrays (see compactRoads in network.js), the ALPR Cameras and
// destinations near it, the state's boundary, and its counties and independent cities.
//
// Each extract is read in passes, so memory holds roads rather than every node of a state: relations, their member
// ways, drivable and destination ways, then only the nodes those need.
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { categoriesFor, DESTINATION_TAGS, HIGHWAY_CLASSES, isCamera } from './config.js';
import { haversine } from './geo.js';
import { direction, isDrivable, speedMps } from './network.js';
import { NO_TAGS, openExtract, scan } from './pbf.js';
import { assembleRings } from './study-area.js';

const CLASS_INDEX = new Map(HIGHWAY_CLASSES.map((h, i) => [h, i]));
const TYPE_RANK = { node: 0, way: 1, relation: 2 };
const round7 = x => Math.round(x * 1e7) / 1e7;

// A typed array that grows as values are pushed.
class Grow {
  constructor(Type, size = 1 << 16) {
    this.Type = Type;
    this.a = new Type(size);
    this.length = 0;
  }

  push(v) {
    if (this.length === this.a.length) {
      const b = new this.Type(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.length++] = v;
  }

  done() {
    return this.a.slice(0, this.length);
  }
}

// The first index in a sorted array of ids whose id is not below id.
function lowerBound(ids, id) {
  let lo = 0;
  let hi = ids.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ids[mid] < id) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Index of id in a sorted array of ids, or -1.
function find(ids, id) {
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (ids[mid] < id) lo = mid + 1;
    else if (ids[mid] > id) hi = mid - 1;
    else return mid;
  }
  return -1;
}

// Reads the inputs from extracts [{ path, own }], where own marks the state's own extract.
// iso: the state's ISO 3166-2 code, as tagged on its boundary relation. keep(west, south, east, north): whether
// something with that bounding box is near enough to the state to keep. log receives a line per pass.
// Returns { osmSnapshot, roads, cameras, destinations: { category: [place] }, state, counties, skippedWays }.
// categories: the Destination Categories to collect (default: those of a state with no local icon set).
export function readState(extracts, { iso, keep, categories = categoriesFor(), log = () => {} }) {
  const snapshots = extracts.map(e => {
    const x = openExtract(e.path);
    x.close();
    return x.osmSnapshot;
  });
  if (!snapshots[0] || snapshots.some(s => s !== snapshots[0])) {
    throw new Error(`The extracts are not one OSM snapshot: ${extracts.map((e, i) => `${basename(e.path)} ${snapshots[i] ?? 'unknown'}`).join(', ')}. ` +
      'Download them again on one day with --refresh.');
  }

  const names = [null];
  const nameIndex = new Map();
  const nameOf = name => {
    if (name === undefined) return 0;
    let i = nameIndex.get(name);
    if (i === undefined) nameIndex.set(name, (i = names.push(name) - 1));
    return i;
  };
  const parts = extracts.map(e => readExtract(e.path, e.own, { iso, keep, categories, nameOf, log }));
  const own = parts[extracts.findIndex(e => e.own)];

  // Each way once, in id order: extracts overlap at their edges, and a way in two of them is the same way.
  const total = parts.reduce((n, p) => n + p.wayId.length, 0);
  const allIds = new Float64Array(total);
  const partOf = new Uint8Array(total);
  const localOf = new Int32Array(total);
  for (let pi = 0, i = 0; pi < parts.length; pi++) {
    for (let w = 0; w < parts[pi].wayId.length; w++, i++) {
      allIds[i] = parts[pi].wayId[w];
      partOf[i] = pi;
      localOf[i] = w;
    }
  }
  const order = Uint32Array.from({ length: total }, (_, i) => i).sort((a, b) => allIds[a] - allIds[b] || a - b);
  const chosen = [];
  for (let k = 0; k < total; k++) if (k === 0 || allIds[order[k]] !== allIds[order[k - 1]]) chosen.push(order[k]);

  const W = chosen.length;
  const wayId = new Float64Array(W);
  const wayClass = new Uint8Array(W);
  const wayDir = new Int8Array(W);
  const waySpeed = new Float64Array(W);
  const wayName = new Int32Array(W);
  const wayStart = new Int32Array(W + 1);
  chosen.forEach((i, w) => {
    const p = parts[partOf[i]];
    const l = localOf[i];
    wayId[w] = p.wayId[l];
    wayClass[w] = p.wayClass[l];
    wayDir[w] = p.wayDir[l];
    waySpeed[w] = p.waySpeed[l];
    wayName[w] = p.wayName[l];
    wayStart[w + 1] = wayStart[w] + p.wayStart[l + 1] - p.wayStart[l];
  });
  const refIds = new Float64Array(wayStart[W]);
  chosen.forEach((i, w) => refIds.set(parts[partOf[i]].refId.subarray(parts[partOf[i]].wayStart[localOf[i]], parts[partOf[i]].wayStart[localOf[i] + 1]), wayStart[w]));

  const sorted = refIds.slice().sort();
  let u = 0;
  for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[u - 1]) sorted[u++] = sorted[i];
  const nodeId = sorted.slice(0, u);
  const nodeLon = new Int32Array(u);
  const nodeLat = new Int32Array(u);
  const wayRefs = new Int32Array(refIds.length);
  chosen.forEach((i, w) => {
    const p = parts[partOf[i]];
    for (let k = p.wayStart[localOf[i]], r = wayStart[w]; k < p.wayStart[localOf[i] + 1]; k++, r++) {
      const n = find(nodeId, p.refId[k]);
      wayRefs[r] = n;
      nodeLon[n] = p.refLon[k];
      nodeLat[n] = p.refLat[k];
    }
  });

  const unique = (lists, keyOf) => [...new Map(lists.flat().map(x => [keyOf(x), x])).values()];
  const cameras = unique(parts.map(p => p.cameras), c => c.id).sort((a, b) => a.id - b.id);
  const destinations = Object.fromEntries(categories.map(c => [
    c,
    unique(parts.map(p => p.destinations[c]), d => d.id).sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.osmId - b.osmId),
  ]));

  return {
    osmSnapshot: snapshots[0],
    roads: { names, wayId, wayClass, wayDir, waySpeed, wayName, wayStart, wayRefs, nodeId, nodeLon, nodeLat },
    cameras,
    destinations,
    state: own.state,
    counties: own.counties,
    skippedWays: parts.reduce((n, p) => n + p.skippedWays, 0),
  };
}

function readExtract(path, own, { iso, keep, categories, nameOf, log }) {
  const extract = openExtract(path);
  try {
    const pass = (label, visit) => {
      const start = performance.now();
      scan(extract, visit);
      log(`  ${basename(path)}, ${label}: ${((performance.now() - start) / 1000).toFixed(1)} s`);
    };
    const categoriesOf = tags => categories.filter(c => DESTINATION_TAGS[c](tags));

    // 1. The state's boundary and its counties (own extract only), and destinations mapped as relations.
    let stateRelation = null;
    const countyRelations = [];
    const destinationRelations = [];
    pass('relations', {
      relation(id, members, tags) {
        if (tags === NO_TAGS) return;
        if (own && tags.boundary === 'administrative') {
          if (tags.admin_level === '4' && tags['ISO3166-2'] === iso) stateRelation = { id, members, tags };
          else if (tags.admin_level === '6') countyRelations.push({ id, members, tags });
        }
        const of = categoriesOf(tags);
        if (of.length) destinationRelations.push({ id, members, tags, categories: of });
      },
    });
    if (own && !stateRelation) throw new Error(`${path} has no boundary relation tagged admin_level=4 and ISO3166-2=${iso}`);
    const boundaries = stateRelation ? [stateRelation, ...countyRelations] : [];

    // 2. Their member ways.
    const memberWayIds = new Set();
    const memberNodeIds = [];
    for (const r of [...boundaries, ...destinationRelations]) {
      for (const m of r.members) {
        if (m.type === 'way') memberWayIds.add(m.ref);
        else if (m.type === 'node') memberNodeIds.push(m.ref);
      }
    }
    const memberWays = new Map();
    if (memberWayIds.size) {
      pass('relation member ways', {
        way(id, refs) {
          if (memberWayIds.has(id)) memberWays.set(id, refs);
        },
      });
    }

    // 3. Drivable ways, and destinations mapped as ways.
    const way = { id: new Grow(Float64Array), cls: new Grow(Uint8Array), dir: new Grow(Int8Array), speed: new Grow(Float64Array), name: new Grow(Int32Array), end: new Grow(Int32Array), ref: new Grow(Float64Array, 1 << 20) };
    const destinationWays = [];
    pass('ways', {
      way(id, refs, tags) {
        if (tags === NO_TAGS) return;
        if (refs.length > 1 && isDrivable(tags)) {
          way.id.push(id);
          way.cls.push(CLASS_INDEX.get(tags.highway));
          way.dir.push(direction(tags));
          way.speed.push(speedMps(tags));
          way.name.push(nameOf(tags.name));
          for (const ref of refs) way.ref.push(ref);
          way.end.push(way.ref.length);
        }
        const of = categoriesOf(tags);
        if (of.length) destinationWays.push({ id, refs, tags, categories: of });
      },
    });

    // 4. The nodes all of those need, and every camera and destination node.
    const extra = [...memberNodeIds, ...destinationWays.flatMap(w => w.refs), ...[...memberWays.values()].flat()];
    const needed = new Float64Array(way.ref.length + extra.length);
    needed.set(way.ref.a.subarray(0, way.ref.length));
    needed.set(extra, way.ref.length);
    needed.sort();
    let u = 0;
    for (let i = 0; i < needed.length; i++) if (i === 0 || needed[i] !== needed[u - 1]) needed[u++] = needed[i];
    const ids = needed.subarray(0, u);
    const lon = new Int32Array(u);
    const lat = new Int32Array(u);
    const found = new Uint8Array(u);
    const cameras = [];
    const destinations = Object.fromEntries(categories.map(c => [c, []]));
    const place = (type, id, lon, lat, tags) => ({ id: `${type}/${id}`, type, osmId: id, lat, lon, name: tags.name ?? tags.brand ?? null, tags });
    let j = 0;
    let previous = -Infinity;
    pass('nodes', {
      node(id, x, y, tags) {
        // Extracts list nodes in id order, so one cursor walks both lists; anything else falls back to a search.
        if (id < previous) j = lowerBound(ids, id);
        previous = id;
        while (j < u && ids[j] < id) j++;
        if (j < u && ids[j] === id) {
          lon[j] = Math.round(x * 1e7);
          lat[j] = Math.round(y * 1e7);
          found[j] = 1;
        }
        if (tags === NO_TAGS || !keep(x, y, x, y)) return;
        if (isCamera(tags)) cameras.push({ id, lat: y, lon: x, tags });
        for (const c of categoriesOf(tags)) destinations[c].push(place('node', id, x, y, tags));
      },
    });
    const coordOf = ref => {
      const i = find(ids, ref);
      return i >= 0 && found[i] ? [lon[i] / 1e7, lat[i] / 1e7] : null;
    };

    // Roads near the state, with their whole geometry.
    const ends = way.end.done();
    const refs = way.ref.a;
    const keptWays = [];
    let skippedWays = 0;
    let keptRefs = 0;
    const refIndex = new Int32Array(way.ref.length);
    for (let w = 0, k = 0; w < ends.length; w++) {
      let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
      let complete = true;
      for (; k < ends[w]; k++) {
        const i = find(ids, refs[k]);
        refIndex[k] = i;
        if (i < 0 || !found[i]) {
          complete = false;
          continue;
        }
        west = Math.min(west, lon[i]); east = Math.max(east, lon[i]);
        south = Math.min(south, lat[i]); north = Math.max(north, lat[i]);
      }
      if (!complete) skippedWays++;
      else if (keep(west / 1e7, south / 1e7, east / 1e7, north / 1e7)) {
        keptWays.push(w);
        keptRefs += ends[w] - (w ? ends[w - 1] : 0);
      }
    }
    const wayIds = way.id.a;
    const part = {
      wayId: new Float64Array(keptWays.length),
      wayClass: new Uint8Array(keptWays.length),
      wayDir: new Int8Array(keptWays.length),
      waySpeed: new Float64Array(keptWays.length),
      wayName: new Int32Array(keptWays.length),
      wayStart: new Int32Array(keptWays.length + 1),
      refId: new Float64Array(keptRefs),
      refLon: new Int32Array(keptRefs),
      refLat: new Int32Array(keptRefs),
    };
    keptWays.forEach((w, n) => {
      part.wayId[n] = wayIds[w];
      part.wayClass[n] = way.cls.a[w];
      part.wayDir[n] = way.dir.a[w];
      part.waySpeed[n] = way.speed.a[w];
      part.wayName[n] = way.name.a[w];
      let r = part.wayStart[n];
      for (let k = w ? ends[w - 1] : 0; k < ends[w]; k++, r++) {
        part.refId[r] = refs[k];
        part.refLon[r] = lon[refIndex[k]];
        part.refLat[r] = lat[refIndex[k]];
      }
      part.wayStart[n + 1] = r;
    });
    if (skippedWays) log(`  ${basename(path)}: ${skippedWays} drivable ways with nodes missing from the extract left out`);

    // Destinations mapped as ways or relations sit at the centre of their bounding box.
    const centre = points => {
      const lons = points.map(p => p[0]);
      const lats = points.map(p => p[1]);
      return [round7((Math.min(...lons) + Math.max(...lons)) / 2), round7((Math.min(...lats) + Math.max(...lats)) / 2)];
    };
    const addCentre = (type, id, points, tags, of) => {
      if (!points.length) return;
      const [x, y] = centre(points);
      if (keep(x, y, x, y)) for (const c of of) destinations[c].push(place(type, id, x, y, tags));
    };
    for (const w of destinationWays) addCentre('way', w.id, w.refs.map(coordOf).filter(Boolean), w.tags, w.categories);
    for (const r of destinationRelations) {
      const points = r.members
        .flatMap(m => (m.type === 'node' ? [m.ref] : m.type === 'way' ? (memberWays.get(m.ref) ?? []) : []))
        .map(coordOf)
        .filter(Boolean);
      addCentre('relation', r.id, points, r.tags, r.categories);
    }

    // Boundaries as rings. Counties of neighbouring states are often cut off at the extract's edge and are skipped.
    const area = relation => {
      const members = [];
      for (const m of relation.members) {
        if (m.type !== 'way') continue;
        const wayRefs = memberWays.get(m.ref);
        const geometry = wayRefs?.map(coordOf);
        if (!geometry || geometry.includes(null)) return null;
        members.push({ role: m.role, geometry: geometry.map(([x, y]) => ({ lon: x, lat: y })) });
      }
      try {
        const outer = assembleRings(members.filter(m => m.role !== 'inner'));
        return outer.length ? { relation: relation.id, name: relation.tags.name ?? `relation ${relation.id}`, outer, inner: assembleRings(members.filter(m => m.role === 'inner')) } : null;
      } catch {
        return null;
      }
    };
    const state = stateRelation && area(stateRelation);
    if (own && !state) throw new Error(`boundary relation ${stateRelation.id} (${iso}) is incomplete or does not close in ${path}`);
    const counties = countyRelations.map(r => {
      const a = area(r);
      return a && { ...a, kind: r.tags.border_type === 'city' ? 'city' : 'county' };
    }).filter(Boolean);

    return { ...part, cameras, destinations, state, counties, skippedWays };
  } finally {
    extract.close();
  }
}

// data/<state>/: roads.bin holds the compact roads; inputs.json the rest.
const ROAD_ARRAYS = { wayId: Float64Array, wayClass: Uint8Array, wayDir: Int8Array, waySpeed: Float64Array, wayName: Int32Array, wayStart: Int32Array, wayRefs: Int32Array, nodeId: Float64Array, nodeLon: Int32Array, nodeLat: Int32Array };

export function saveStore(dir, { roads, ...inputs }) {
  const arrays = [];
  let offset = 0;
  for (const key of Object.keys(ROAD_ARRAYS)) {
    arrays.push({ key, length: roads[key].length, offset });
    offset += Math.ceil(roads[key].byteLength / 8) * 8;
  }
  const header = Buffer.from(JSON.stringify({ names: roads.names, arrays }));
  const fd = openSync(join(dir, 'roads.bin'), 'w');
  try {
    const size = Buffer.alloc(8);
    size.writeUInt32LE(header.length);
    writeSync(fd, size);
    writeSync(fd, header);
    writeSync(fd, Buffer.alloc((8 - (header.length % 8)) % 8));
    for (const { key } of arrays) {
      const a = roads[key];
      writeSync(fd, Buffer.from(a.buffer, a.byteOffset, a.byteLength));
      writeSync(fd, Buffer.alloc(Math.ceil(a.byteLength / 8) * 8 - a.byteLength));
    }
  } finally {
    closeSync(fd);
  }
  writeFileSync(join(dir, 'inputs.json'), JSON.stringify(inputs));
}

// The inputs as saved, ready to score (see storeInputs).
export function loadStore(dir) {
  const file = readFileSync(join(dir, 'roads.bin'));
  const headerLength = file.readUInt32LE(0);
  const { names, arrays } = JSON.parse(file.toString('utf8', 8, 8 + headerLength));
  const base = 8 + Math.ceil(headerLength / 8) * 8;
  const roads = { names };
  for (const { key, length, offset } of arrays) {
    const Type = ROAD_ARRAYS[key];
    const start = file.byteOffset + base + offset;
    roads[key] = start % Type.BYTES_PER_ELEMENT === 0
      ? new Type(file.buffer, start, length)
      : new Type(file.buffer.slice(start, start + length * Type.BYTES_PER_ELEMENT));
  }
  return storeInputs({ ...JSON.parse(readFileSync(join(dir, 'inputs.json'), 'utf8')), roads });
}

// Inputs { roads, cameras, destinations, ... } made ready to score: with each way's bounding box and the longest
// road segment in metres.
export function storeInputs(inputs) {
  const { roads } = inputs;
  const W = roads.wayId.length;
  const box = { west: new Int32Array(W), south: new Int32Array(W), east: new Int32Array(W), north: new Int32Array(W) };
  let maxSegmentM = 0;
  for (let w = 0; w < W; w++) {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (let k = roads.wayStart[w]; k < roads.wayStart[w + 1]; k++) {
      const n = roads.wayRefs[k];
      west = Math.min(west, roads.nodeLon[n]); east = Math.max(east, roads.nodeLon[n]);
      south = Math.min(south, roads.nodeLat[n]); north = Math.max(north, roads.nodeLat[n]);
      if (k > roads.wayStart[w]) {
        const m = roads.wayRefs[k - 1];
        maxSegmentM = Math.max(maxSegmentM, haversine(roads.nodeLon[m] / 1e7, roads.nodeLat[m] / 1e7, roads.nodeLon[n] / 1e7, roads.nodeLat[n] / 1e7));
      }
    }
    box.west[w] = west; box.south[w] = south; box.east[w] = east; box.north[w] = north;
  }
  return { ...inputs, wayBox: box, maxSegmentM };
}
