// What one state adds to the national map (ADR 0007): its streets, other roads, ALPR Cameras, destinations and
// outline as vector tile features, and a grid of mean Exposure for the zooms too far out to draw streets.
// A state's features are saved as records in tile order (out/<state>/tiles.bin), so the map merges every state's
// records tile by tile without holding the country in memory.
import { closeSync, openSync, readSync, writeSync } from 'node:fs';
import { COUNTED_TRIP_M, HIGHWAY_CLASSES, LOCAL_ROAD } from './config.js';
import { areasOf, studyArea } from './study-area.js';
import { clipLine, encodeTile, lineGeometry, pointGeometry, rectGeometry, tileId, worldXY } from './tiles.js';

// Streets and roads are drawn as lines from the zoom their class earns in ROAD_ZOOM, so the further out, the fewer:
// interstates across a state, then trunk roads and arterials, and every street from LOCAL_ZOOM (one zoom early and
// tagged 'local', so the page can fade it in as the grid below fades out). Below STREET_ZOOM a street's line carries
// only its name and Exposure; from STREET_ZOOM it also carries the trip the page shows on a click, and the
// destinations and Local Roads that give no Origin join it. Below LOCAL_ZOOM, from MIN_ZOOM, a grid colors the land
// under the lines. Each grid tile is GRID_CELLS cells a side, and the page draws a tile 512 pixels wide, so a cell is
// 4 to 8 pixels.
export const MIN_ZOOM = 3;
export const LOCAL_ZOOM = 11;
export const STREET_ZOOM = 12;
export const CAMERA_MIN_ZOOM = 6;
export const ROAD_ZOOM = { motorway: 5, trunk: 7, primary: 8, secondary: 9, tertiary: 10 };
export const ROAD_MIN_ZOOM = Math.min(...Object.values(ROAD_ZOOM));
// The zoom a way is drawn from: its class's in ROAD_ZOOM, else LOCAL_ZOOM, except Local Roads that give no Origin.
const zoomOf = (highway, origin) => ROAD_ZOOM[highway] ?? (origin || !LOCAL_ROAD.has(highway) ? LOCAL_ZOOM : STREET_ZOOM);
const GRID_BITS = 7;
const GRID_CELLS = 2 ** GRID_BITS;
export const extentAt = z => (z >= STREET_ZOOM ? 8192 : 4096);
// Below STREET_ZOOM a line keeps a point only if it lies this many tile units (a pixel) from the last point kept.
const THIN = 8;
// A grid cell is colored by the streets within two cells of it, weighted by this 5 × 5 binomial kernel, so zoomed out
// the map reads as a surface instead of speckle. Weights are whole numbers so the weighted sums stay integers.
const KERNEL = [1, 4, 6, 4, 1].map(a => [1, 4, 6, 4, 1].map(b => a * b));
const REACH = (KERNEL.length - 1) / 2;

// Layers in drawing order, bottom first.
export const LAYERS = ['grid', 'outline', 'roads', 'streets', 'destinations', 'cameras'];
const LAYER = Object.fromEntries(LAYERS.map((name, i) => [name, i]));

// A long line is cut into parts of at most this many points before it is clipped to tiles.
const PART_POINTS = 64;
const MAGIC = 'EETILES';
// Bump when records change shape or content, so every state's records are written again.
export const RECORDS_VERSION = 6;

// Record: tileId f64, z u8, x u32, y u32, layer u8, payload length u32, payload.
const HEAD = 22;
const CHUNK = 64 << 20;

class Grow {
  constructor(Type) {
    this.Type = Type;
    this.a = new Type(1 << 16);
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
}

class Sink {
  constructor() {
    this.chunks = [];
    this.buf = Buffer.allocUnsafe(CHUNK);
    this.used = 0;
    this.id = new Grow(Float64Array);
    this.chunk = new Grow(Uint16Array);
    this.pos = new Grow(Uint32Array);
    this.len = new Grow(Uint32Array);
  }

  // Reserves a record with a payload of size bytes; returns where the payload starts in this.buf.
  record(z, x, y, layer, size) {
    const total = HEAD + size;
    if (this.used + total > this.buf.length) {
      this.chunks.push(this.buf.subarray(0, this.used));
      this.buf = Buffer.allocUnsafe(Math.max(CHUNK, total));
      this.used = 0;
    }
    const b = this.buf;
    const o = this.used;
    const id = tileId(z, x, y);
    b.writeDoubleLE(id, o);
    b.writeUInt8(z, o + 8);
    b.writeUInt32LE(x, o + 9);
    b.writeUInt32LE(y, o + 13);
    b.writeUInt8(layer, o + 17);
    b.writeUInt32LE(size, o + 18);
    this.id.push(id);
    this.chunk.push(this.chunks.length);
    this.pos.push(o);
    this.len.push(total);
    this.used += total;
    return o + HEAD;
  }

  // props: the feature's [[key, value]] pairs, already as JSON bytes.
  feature(z, x, y, layer, type, id, geometry, props) {
    let o = this.record(z, x, y, layer, 17 + geometry.length * 4 + props.length);
    const b = this.buf;
    o = b.writeUInt8(type, o);
    o = b.writeDoubleLE(id, o);
    o = b.writeUInt32LE(geometry.length, o);
    for (const g of geometry) o = b.writeUInt32LE(g, o);
    o = b.writeUInt32LE(props.length, o);
    props.copy(b, o);
  }

  // Writes every record, ordered by tile id and otherwise as added.
  write(path) {
    const chunks = [...this.chunks, this.buf.subarray(0, this.used)];
    const n = this.id.length;
    const ids = this.id.a;
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => ids[a] - ids[b] || a - b);
    const fd = openSync(path, 'w');
    try {
      const out = Buffer.allocUnsafe(8 << 20);
      out.write(MAGIC, 0, 'latin1');
      out.writeUInt8(RECORDS_VERSION, 7);
      let used = 8;
      let bytes = 0;
      for (const k of order) {
        const len = this.len.a[k];
        if (used + len > out.length) {
          writeSync(fd, out, 0, used);
          bytes += used;
          used = 0;
        }
        const src = chunks[this.chunk.a[k]];
        const pos = this.pos.a[k];
        if (len > out.length) {
          writeSync(fd, src, pos, len);
          bytes += len;
        } else {
          src.copy(out, used, pos, pos + len);
          used += len;
        }
      }
      writeSync(fd, out, 0, used);
      return { records: n, bytes: bytes + used };
    } finally {
      closeSync(fd);
    }
  }
}

// A state's records file, read in tile order. head is the current record, or null at the end; its payload lies in
// head.buf from head.pos, and stays valid only until advance().
export class RecordReader {
  constructor(path) {
    this.fd = openSync(path, 'r');
    this.buf = Buffer.allocUnsafe(16 << 20);
    this.start = 0;
    this.end = 0;
    this.filePos = 0;
    if (!this.fill(8) || this.buf.toString('latin1', 0, 7) !== MAGIC || this.buf[7] !== RECORDS_VERSION) {
      closeSync(this.fd);
      throw new Error(`${path} is not map records of version ${RECORDS_VERSION}`);
    }
    this.start = 8;
    this.head = null;
    this.advance();
  }

  // True when at least n unread bytes are buffered.
  fill(n) {
    if (this.end - this.start >= n) return true;
    if (this.start > 0) {
      this.buf.copy(this.buf, 0, this.start, this.end);
      this.end -= this.start;
      this.start = 0;
    }
    if (n > this.buf.length) {
      const b = Buffer.allocUnsafe(n * 2);
      this.buf.copy(b, 0, 0, this.end);
      this.buf = b;
    }
    while (this.end < n) {
      const read = readSync(this.fd, this.buf, this.end, this.buf.length - this.end, this.filePos);
      if (!read) return false;
      this.end += read;
      this.filePos += read;
    }
    return true;
  }

  advance() {
    if (!this.fill(HEAD)) {
      this.close();
      return;
    }
    const b = this.buf;
    const s = this.start;
    const len = b.readUInt32LE(s + 18);
    if (!this.fill(HEAD + len)) throw new Error('map records end in the middle of a record');
    const o = this.start;
    this.head = { id: b.readDoubleLE(o), z: b[o + 8], x: b.readUInt32LE(o + 9), y: b.readUInt32LE(o + 13), layer: b[o + 17], buf: b, pos: o + HEAD, len };
    this.start = o + HEAD + len;
  }

  close() {
    this.head = null;
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}

// A line's first and last points, and between them each point at least THIN tile units from the last one kept.
function thin(flat) {
  const out = [flat[0], flat[1]];
  for (let k = 2; k < flat.length - 2; k += 2) {
    if (Math.abs(flat[k] - out[out.length - 2]) + Math.abs(flat[k + 1] - out[out.length - 1]) >= THIN) out.push(flat[k], flat[k + 1]);
  }
  if (flat.length > 2) out.push(flat[flat.length - 2], flat[flat.length - 1]);
  return out;
}

// Adds a line, given as world fractions [x0, y0, x1, y1, ...], to every tile at zoom z it passes through. Below
// STREET_ZOOM the line is thinned to what a pixel shows.
function addLine(sink, z, layer, id, world, props) {
  const extent = extentAt(z);
  const scale = 2 ** z * extent;
  const buffer = extent / 64;
  const last = 2 ** z - 1;
  const perTile = new Map();
  for (let start = 0; start + 2 < world.length; start += (PART_POINTS - 1) * 2) {
    const end = Math.min(world.length, start + PART_POINTS * 2);
    const px = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = start; k < end; k += 2) {
      const x = world[k] * scale;
      const y = world[k + 1] * scale;
      px.push(x, y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const tx0 = Math.max(0, Math.floor((minX - buffer) / extent));
    const tx1 = Math.min(last, Math.floor((maxX + buffer) / extent));
    const ty0 = Math.max(0, Math.floor((minY - buffer) / extent));
    const ty1 = Math.min(last, Math.floor((maxY + buffer) / extent));
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const ox = tx * extent;
        const oy = ty * extent;
        const local = px.map((v, k) => (k % 2 ? v - oy : v - ox));
        const whole = minX - ox >= -buffer && maxX - ox <= extent + buffer && minY - oy >= -buffer && maxY - oy <= extent + buffer;
        const parts = whole ? [local] : clipLine(local, -buffer, -buffer, extent + buffer, extent + buffer);
        if (!parts.length) continue;
        const key = tx * 2 ** 26 + ty;
        if (!perTile.has(key)) perTile.set(key, []);
        for (const p of parts) {
          const rounded = p.map(Math.round);
          perTile.get(key).push(z < STREET_ZOOM ? thin(rounded) : rounded);
        }
      }
    }
  }
  for (const [key, parts] of perTile) {
    const geometry = lineGeometry(parts);
    if (geometry.length) sink.feature(z, Math.floor(key / 2 ** 26), key % 2 ** 26, layer, 2, id, geometry, props);
  }
}

function addPoint(sink, z, layer, id, [wx, wy], props) {
  const extent = extentAt(z);
  const px = wx * 2 ** z * extent;
  const py = wy * 2 ** z * extent;
  const tx = Math.min(2 ** z - 1, Math.floor(px / extent));
  const ty = Math.min(2 ** z - 1, Math.floor(py / extent));
  sink.feature(z, tx, ty, layer, 1, id, pointGeometry([Math.round(px - tx * extent), Math.round(py - ty * extent)]), props);
}

const json = pairs => Buffer.from(JSON.stringify(pairs));
const r5 = v => Math.round(v * 1e5) / 1e5;
export const cameraOperator = c => c.tags?.operator ?? c.tags?.brand ?? c.tags?.manufacturer ?? '';

// The label a street's Selection shows: "Fairfax County, Virginia", or the state's name outside any.
export const placeLabels = (info, stateName) => (info.selections ?? []).map(s => `${s.name}, ${stateName}`);

// Writes a state's records to path. store: from loadStore. results: from loadResults. Returns counts.
export function writeStateLayers(path, { store, results, stateName }) {
  const { roads, wayBox } = store;
  const keys = results.info.categories;
  const n = results.info.origins;
  const { storeWay, lon, lat, selection } = results.arrays;
  const inState = studyArea(store.state);
  const labels = placeLabels(results.info, stateName);
  const sink = new Sink();
  const wayWorld = s => {
    const out = [];
    for (let k = roads.wayStart[s]; k < roads.wayStart[s + 1]; k++) {
      const node = roads.wayRefs[k];
      out.push(...worldXY(roads.nodeLon[node] / 1e7, roads.nodeLat[node] / 1e7));
    }
    return out;
  };
  const counts = { streets: n, roads: 0, cameras: 0, destinations: 0 };

  // Streets: every Origin's way, with what the page shows for it.
  const cameraById = new Map(store.cameras.map(c => [c.id, c]));
  const isOrigin = new Uint8Array(roads.wayId.length);
  for (let i = 0; i < n; i++) {
    const s = storeWay[i];
    isOrigin[s] = 1;
    const props = [['name', roads.names[roads.wayName[s]] ?? ''], ['place', selection && selection[i] >= 0 ? labels[selection[i]] : stateName]];
    for (const key of keys) {
      const c = results.categories[key];
      const score = c.score[i];
      props.push([key, score]);
      if (score < 0) continue;
      const d = store.destinations[key][c.destination[i]];
      props.push([`${key}_min`, Math.round(c.timeS[i] / 6) / 10], [`${key}_dest`, d.name ?? 'Unnamed'], [`${key}_dlon`, r5(d.lon)], [`${key}_dlat`, r5(d.lat)]);
      if (c.lengthM[i] > COUNTED_TRIP_M) props.push([`${key}_long`, 1]);
      if (score > 0) {
        const ids = c.cameraId.subarray(c.cameraStart[i], c.cameraStart[i + 1]);
        props.push([`${key}_cams`, JSON.stringify(Array.from(ids, id => {
          const cam = cameraById.get(id);
          return [id, r5(cam.lon), r5(cam.lat), cameraOperator(cam)];
        }))]);
      }
    }
    const world = wayWorld(s);
    addLine(sink, STREET_ZOOM, LAYER.streets, roads.wayId[s], world, json(props));
    const highway = HIGHWAY_CLASSES[roads.wayClass[s]];
    const local = LOCAL_ROAD.has(highway) ? 1 : 0;
    const line = json([props[0], ['local', local], ...keys.map(key => [key, results.categories[key].score[i]])]);
    // A Local Road normally first appears at LOCAL_ZOOM, popping in at once as the grid beneath it disappears. Giving
    // it one zoom of data early, tagged 'local', lets the page cross-fade the two instead of swapping them.
    const z0 = Math.min(zoomOf(highway, true), LOCAL_ZOOM - 1);
    for (let z = z0; z < STREET_ZOOM; z++) addLine(sink, z, LAYER.streets, roads.wayId[s], world, line);
  }

  // Other roads in the state, drawn gray from the zoom their class earns: interstates and trunk roads, ramps, and
  // Local Roads that give no Origin here.
  const roadProps = [json([['local', 0]]), json([['local', 1]])];
  for (let s = 0; s < roads.wayId.length; s++) {
    if (isOrigin[s]) continue;
    const highway = HIGHWAY_CLASSES[roads.wayClass[s]];
    if (highway === 'service') continue;
    const cx = (wayBox.west[s] + wayBox.east[s]) / 2e7;
    const cy = (wayBox.south[s] + wayBox.north[s]) / 2e7;
    if (!inState([cx, cy])) continue;
    const props = roadProps[LOCAL_ROAD.has(highway) ? 1 : 0];
    const world = wayWorld(s);
    for (let z = zoomOf(highway, false); z <= STREET_ZOOM; z++) addLine(sink, z, LAYER.roads, roads.wayId[s], world, props);
    counts.roads++;
  }

  for (const c of store.cameras) {
    if (!inState([c.lon, c.lat])) continue;
    const at = worldXY(c.lon, c.lat);
    const props = json([['who', cameraOperator(c)]]);
    for (let z = CAMERA_MIN_ZOOM; z <= STREET_ZOOM; z++) addPoint(sink, z, LAYER.cameras, c.id, at, props);
    counts.cameras++;
  }

  for (const key of keys) {
    for (const d of store.destinations[key]) {
      if (!inState([d.lon, d.lat])) continue;
      addPoint(sink, STREET_ZOOM, LAYER.destinations, d.osmId, worldXY(d.lon, d.lat), json([['category', key], ['name', d.name ?? 'Unnamed']]));
      counts.destinations++;
    }
  }

  const noProps = json([]);
  for (const area of areasOf(store.state)) {
    for (const ring of [...area.outer, ...area.inner]) {
      const world = ring.flatMap(([x, y]) => worldXY(x, y));
      for (let z = MIN_ZOOM; z <= STREET_ZOOM; z++) addLine(sink, z, LAYER.outline, -1, world, noProps);
    }
  }

  addGrid(sink, { lon, lat, n, keys, categories: results.categories });
  return { ...counts, ...sink.write(path) };
}

// Grid cells at zoom z are the tiles of zoom z + GRID_BITS. Each record holds, per category, the number of Origins
// scored in the cell, then over the cells within REACH of it weighted by KERNEL: their number, the sum of their
// Exposures, and how many are 0. Weighted sums add across states, so merged cells are what one country build gives.
function addGrid(sink, { lon, lat, n, keys, categories }) {
  const fineZoom = LOCAL_ZOOM - 1 + GRID_BITS;
  const K = keys.length;
  let cells = new Map();
  for (let i = 0; i < n; i++) {
    const [wx, wy] = worldXY(lon[i], lat[i]);
    const key = Math.floor(wx * 2 ** fineZoom) * 2 ** fineZoom + Math.floor(wy * 2 ** fineZoom);
    let stats = cells.get(key);
    if (!stats) cells.set(key, (stats = new Float64Array(3 * K)));
    keys.forEach((k, j) => {
      const s = categories[k].score[i];
      if (s < 0) return;
      stats[3 * j]++;
      stats[3 * j + 1] += s;
      if (s === 0) stats[3 * j + 2]++;
    });
  }
  for (let z = LOCAL_ZOOM - 1; z >= MIN_ZOOM; z--) {
    const side = 2 ** (z + GRID_BITS);
    if (z < LOCAL_ZOOM - 1) {
      const coarse = new Map();
      for (const [key, stats] of cells) {
        const up = Math.floor(Math.floor(key / (side * 2)) / 2) * side + Math.floor((key % (side * 2)) / 2);
        const into = coarse.get(up);
        if (into) for (let j = 0; j < stats.length; j++) into[j] += stats[j];
        else coarse.set(up, stats.slice());
      }
      cells = coarse;
    }
    const smooth = new Map();
    for (const [key, stats] of cells) {
      const cx = Math.floor(key / side);
      const cy = key % side;
      for (let dx = -REACH; dx <= REACH; dx++) {
        for (let dy = -REACH; dy <= REACH; dy++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
          const w = KERNEL[dy + REACH][dx + REACH];
          let into = smooth.get(nx * side + ny);
          if (!into) smooth.set(nx * side + ny, (into = new Float64Array(4 * K)));
          for (let j = 0; j < K; j++) {
            if (!dx && !dy) into[4 * j] += stats[3 * j];
            into[4 * j + 1] += w * stats[3 * j];
            into[4 * j + 2] += w * stats[3 * j + 1];
            into[4 * j + 3] += w * stats[3 * j + 2];
          }
        }
      }
    }
    for (const [key, stats] of smooth) {
      const cx = Math.floor(key / side);
      const cy = key % side;
      const o = sink.record(z, Math.floor(cx / GRID_CELLS), Math.floor(cy / GRID_CELLS), LAYER.grid, 2 + 16 * K);
      sink.buf.writeUInt8(cx % GRID_CELLS, o);
      sink.buf.writeUInt8(cy % GRID_CELLS, o + 1);
      for (let j = 0; j < stats.length; j++) sink.buf.writeUInt32LE(stats[j], o + 2 + 4 * j);
    }
  }
}

// Street names for "Find your street": one row per name within one Selection, with the bounding box of its ways and
// the lowest and highest Exposure among them per category (-1 when none is scored).
export function searchRows({ store, results }) {
  const { roads, wayBox } = store;
  const keys = results.info.categories;
  const { storeWay, selection } = results.arrays;
  const groups = new Map();
  for (let i = 0; i < results.info.origins; i++) {
    const s = storeWay[i];
    const nameIndex = roads.wayName[s];
    if (!nameIndex) continue;
    const sel = selection ? selection[i] : -1;
    const key = `${nameIndex}|${sel}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { name: roads.names[nameIndex], sel, w: Infinity, s: Infinity, e: -Infinity, n: -Infinity, lo: keys.map(() => Infinity), hi: keys.map(() => -Infinity) }));
    g.w = Math.min(g.w, wayBox.west[s]);
    g.s = Math.min(g.s, wayBox.south[s]);
    g.e = Math.max(g.e, wayBox.east[s]);
    g.n = Math.max(g.n, wayBox.north[s]);
    keys.forEach((k, j) => {
      const score = results.categories[k].score[i];
      if (score < 0) return;
      g.lo[j] = Math.min(g.lo[j], score);
      g.hi[j] = Math.max(g.hi[j], score);
    });
  }
  const e5 = v => Math.round(v / 100);
  return [...groups.values()].map(g => [g.name, g.sel, e5(g.w), e5(g.s), e5(g.e), e5(g.n), ...keys.flatMap((_, j) => (g.lo[j] === Infinity ? [-1, -1] : [g.lo[j], g.hi[j]]))]);
}

// Merges states' records into tiles and adds each to a PMTilesWriter, in tile order. keys: the Destination Categories.
// Returns the number of tiles and the largest tile's size.
export function mergeRecords(readers, writer, keys, { log = () => {} } = {}) {
  const K = keys.length;
  let tiles = 0;
  let largest = { bytes: 0 };
  for (;;) {
    let id = Infinity;
    for (const r of readers) if (r.head && r.head.id < id) id = r.head.id;
    if (id === Infinity) break;
    const features = LAYERS.map(() => []);
    const grid = new Map();
    let z, x, y;
    for (const r of readers) {
      while (r.head && r.head.id === id) {
        const h = r.head;
        ({ z, x, y } = h);
        const b = h.buf;
        if (h.layer === LAYER.grid) {
          const cell = b[h.pos] * GRID_CELLS + b[h.pos + 1];
          let stats = grid.get(cell);
          if (!stats) grid.set(cell, (stats = new Float64Array(4 * K)));
          for (let j = 0; j < 4 * K; j++) stats[j] += b.readUInt32LE(h.pos + 2 + 4 * j);
        } else {
          let o = h.pos;
          const type = b[o];
          const fid = b.readDoubleLE(o + 1);
          const count = b.readUInt32LE(o + 9);
          o += 13;
          const geometry = new Array(count);
          for (let k = 0; k < count; k++, o += 4) geometry[k] = b.readUInt32LE(o);
          const propsLength = b.readUInt32LE(o);
          const props = JSON.parse(b.toString('utf8', o + 4, o + 4 + propsLength));
          features[h.layer].push({ id: fid >= 0 ? fid : null, type, geometry, props });
        }
        r.advance();
      }
    }
    const extent = extentAt(z);
    const size = extent / GRID_CELLS;
    for (const [cell, stats] of grid) {
      const cx = Math.floor(cell / GRID_CELLS);
      const cy = cell % GRID_CELLS;
      const props = [];
      keys.forEach((k, j) => {
        const weight = stats[4 * j + 1];
        if (!weight) return;
        props.push([`${k}_n`, stats[4 * j]], [`${k}_w`, stats[4 * j + 1]], [`${k}_mean`, Math.round((100 * stats[4 * j + 2]) / weight) / 100], [`${k}_zero`, Math.round((100 * stats[4 * j + 3]) / weight) / 100]);
      });
      features[LAYER.grid].push({ id: null, type: 3, geometry: rectGeometry(cx * size, cy * size, (cx + 1) * size, (cy + 1) * size), props });
    }
    const bytes = writer.add(z, x, y, encodeTile(LAYERS.map((name, i) => ({ name, extent, features: features[i] }))));
    if (bytes > largest.bytes) largest = { bytes, z, x, y };
    if (++tiles % 20000 === 0) log(`  ${tiles} tiles, at zoom ${z}`);
  }
  return { tiles, largest };
}
