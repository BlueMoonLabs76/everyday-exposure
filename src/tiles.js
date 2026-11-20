// The map's output format, written with no dependencies: vector tiles in one PMTiles archive (ADR 0007).
// Mapbox Vector Tile 2.1: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
// PMTiles v3: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
import { closeSync, openSync, writeSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// Web Mercator as a fraction of the world: x from 0 at 180°W to 1 at 180°E, y from 0 at the north edge to 1 at the south.
export function worldXY(lon, lat) {
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

// Protocol buffer wire format, written into a growing buffer.
export class Writer {
  constructor(size = 1024) {
    this.buf = Buffer.allocUnsafe(size);
    this.pos = 0;
  }

  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    const b = Buffer.allocUnsafe(Math.max(this.buf.length * 2, this.pos + n));
    this.buf.copy(b, 0, 0, this.pos);
    this.buf = b;
  }

  // Exact up to 2^53, far above any OSM id.
  varint(v) {
    this.ensure(10);
    while (v >= 0x80) {
      this.buf[this.pos++] = (v % 0x80) | 0x80;
      v = Math.floor(v / 0x80);
    }
    this.buf[this.pos++] = v;
  }

  svarint(v) {
    this.varint(v < 0 ? -2 * v - 1 : 2 * v);
  }

  key(field, wireType) {
    this.varint(field * 8 + wireType);
  }

  bytes(field, b) {
    this.key(field, 2);
    this.varint(b.length);
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }

  string(field, s) {
    this.bytes(field, Buffer.from(s, 'utf8'));
  }

  double(field, v) {
    this.key(field, 1);
    this.ensure(8);
    this.buf.writeDoubleLE(v, this.pos);
    this.pos += 8;
  }

  packed(field, values) {
    const inner = new Writer(values.length * 2 + 8);
    for (const v of values) inner.varint(v);
    this.bytes(field, inner.done());
  }

  done() {
    return this.buf.subarray(0, this.pos);
  }
}

// Geometry commands (MVT 2.1 §4.3). Coordinates are integers in tile units, y down.
const command = (id, count) => count * 8 + id;
const zigzag = n => (n < 0 ? -2 * n - 1 : 2 * n);

// Line parts, each a flat [x0, y0, x1, y1, ...] list. Repeated points are dropped, and a part left with one point.
export function lineGeometry(parts) {
  const out = [];
  let cx = 0;
  let cy = 0;
  for (const part of parts) {
    const pts = [];
    for (let k = 0; k < part.length; k += 2) {
      if (pts.length && pts[pts.length - 2] === part[k] && pts[pts.length - 1] === part[k + 1]) continue;
      pts.push(part[k], part[k + 1]);
    }
    if (pts.length < 4) continue;
    out.push(command(1, 1), zigzag(pts[0] - cx), zigzag(pts[1] - cy));
    cx = pts[0];
    cy = pts[1];
    out.push(command(2, pts.length / 2 - 1));
    for (let k = 2; k < pts.length; k += 2) {
      out.push(zigzag(pts[k] - cx), zigzag(pts[k + 1] - cy));
      cx = pts[k];
      cy = pts[k + 1];
    }
  }
  return out;
}

// One point, [x, y].
export const pointGeometry = ([x, y]) => [command(1, 1), zigzag(x), zigzag(y)];

// An axis-aligned rectangle as a polygon, wound clockwise in tile coordinates as an exterior ring must be.
export function rectGeometry(x0, y0, x1, y1) {
  return [command(1, 1), zigzag(x0), zigzag(y0), command(2, 3), zigzag(x1 - x0), 0, 0, zigzag(y1 - y0), zigzag(x0 - x1), 0, command(7, 1)];
}

// The parts of a polyline, flat [x, y, ...], that lie inside the rectangle [x0, x1] × [y0, y1] (Liang-Barsky).
export function clipLine(flat, x0, y0, x1, y1) {
  const parts = [];
  let part = null;
  for (let i = 2; i < flat.length; i += 2) {
    const ax = flat[i - 2];
    const ay = flat[i - 1];
    const dx = flat[i] - ax;
    const dy = flat[i + 1] - ay;
    let t0 = 0;
    let t1 = 1;
    const edge = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    if (!(edge(-dx, ax - x0) && edge(dx, x1 - ax) && edge(-dy, ay - y0) && edge(dy, y1 - ay))) {
      part = null;
      continue;
    }
    if (!part || t0 > 0) parts.push((part = [ax + t0 * dx, ay + t0 * dy]));
    part.push(ax + t1 * dx, ay + t1 * dy);
    if (t1 < 1) part = null;
  }
  return parts;
}

// One tile. layers: [{ name, extent, features: [{ id, type (1 point, 2 line, 3 polygon), geometry, props }] }],
// where props is [[key, value]] and a null or undefined value is left out.
export function encodeTile(layers) {
  const tile = new Writer(1 << 14);
  for (const layer of layers) {
    if (!layer.features.length) continue;
    const w = new Writer(1 << 14);
    w.key(15, 0);
    w.varint(2);
    w.string(1, layer.name);
    const keys = new Map();
    const values = new Map();
    for (const f of layer.features) {
      const fw = new Writer(64 + f.geometry.length * 2);
      if (f.id != null) {
        fw.key(1, 0);
        fw.varint(f.id);
      }
      const tags = [];
      for (const [k, v] of f.props ?? []) {
        if (v == null) continue;
        if (!keys.has(k)) keys.set(k, keys.size);
        const vk = typeof v === 'string' ? `s${v}` : `n${v}`;
        if (!values.has(vk)) values.set(vk, { index: values.size, v });
        tags.push(keys.get(k), values.get(vk).index);
      }
      if (tags.length) fw.packed(2, tags);
      fw.key(3, 0);
      fw.varint(f.type);
      fw.packed(4, f.geometry);
      w.bytes(2, fw.done());
    }
    for (const k of keys.keys()) w.string(3, k);
    for (const { v } of values.values()) {
      const vw = new Writer(16);
      if (typeof v === 'string') vw.string(1, v);
      else if (!Number.isInteger(v)) vw.double(3, v);
      else if (v < 0) {
        vw.key(6, 0);
        vw.svarint(v);
      } else {
        vw.key(5, 0);
        vw.varint(v);
      }
      w.bytes(4, vw.done());
    }
    w.key(5, 0);
    w.varint(layer.extent);
    tile.bytes(3, w.done());
  }
  return tile.done();
}

// A tile's position on PMTiles' series of Hilbert curves, one per zoom starting at zoom 0.
export function tileId(z, x, y) {
  let id = (4 ** z - 1) / 3;
  let tx = x;
  let ty = y;
  for (let s = 2 ** (z - 1); s >= 1; s /= 2) {
    const rx = tx & s ? 1 : 0;
    const ry = ty & s ? 1 : 0;
    id += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        tx = s - 1 - tx;
        ty = s - 1 - ty;
      }
      [tx, ty] = [ty, tx];
    }
  }
  return id;
}

// Directory entries { id, offset, length, run }, gzipped (PMTiles §4.2). run 0 marks a leaf directory.
export function directoryBytes(entries) {
  const w = new Writer(entries.length * 6 + 16);
  w.varint(entries.length);
  let last = 0;
  for (const e of entries) {
    w.varint(e.id - last);
    last = e.id;
  }
  for (const e of entries) w.varint(e.run);
  for (const e of entries) w.varint(e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    w.varint(i > 0 && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  });
  return gzipSync(w.done());
}

// The root directory, and leaf directories if every entry does not fit in the root's limit.
export function buildDirectories(entries, maxRootBytes = ROOT_LIMIT - HEADER_BYTES) {
  const root = directoryBytes(entries);
  if (root.length <= maxRootBytes) return { root, leaves: [] };
  for (let leafSize = 4096; ; leafSize *= 2) {
    const leaves = [];
    const rootEntries = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const chunk = entries.slice(i, i + leafSize);
      const bytes = directoryBytes(chunk);
      rootEntries.push({ id: chunk[0].id, offset, length: bytes.length, run: 0 });
      leaves.push(bytes);
      offset += bytes.length;
    }
    const leafRoot = directoryBytes(rootEntries);
    if (leafRoot.length <= maxRootBytes) return { root: leafRoot, leaves };
  }
}

const HEADER_BYTES = 127;
// The root directory must lie in the archive's first 16 KiB. Tile data starts there.
const ROOT_LIMIT = 16384;
const GZIP = 2;
const MVT = 1;

// Writes an archive tile by tile, in ascending tileId order, without holding the tiles in memory.
export class PMTilesWriter {
  constructor(path) {
    this.fd = openSync(path, 'w');
    this.entries = [];
    this.length = 0;
    this.minZoom = Infinity;
    this.maxZoom = -Infinity;
  }

  // data: one encoded tile, not yet compressed.
  add(z, x, y, data) {
    const id = tileId(z, x, y);
    const last = this.entries.at(-1);
    if (last && id <= last.id) throw new Error(`tile ${z}/${x}/${y} arrived after tile id ${last.id}; tiles must be added in tileId order`);
    const gz = gzipSync(data);
    writeSync(this.fd, gz, 0, gz.length, ROOT_LIMIT + this.length);
    this.entries.push({ id, offset: this.length, length: gz.length, run: 1 });
    this.length += gz.length;
    this.minZoom = Math.min(this.minZoom, z);
    this.maxZoom = Math.max(this.maxZoom, z);
    return gz.length;
  }

  // metadata: the JSON metadata (with vector_layers). bounds: [west, south, east, north]. center: [lon, lat, zoom].
  finish({ metadata, bounds, center }) {
    try {
      if (!this.entries.length) throw new Error('an archive needs at least one tile');
      let at = ROOT_LIMIT + this.length;
      const meta = gzipSync(Buffer.from(JSON.stringify(metadata)));
      const metadataOffset = at;
      writeSync(this.fd, meta, 0, meta.length, at);
      at += meta.length;
      const { root, leaves } = buildDirectories(this.entries);
      const leafOffset = at;
      for (const leaf of leaves) {
        writeSync(this.fd, leaf, 0, leaf.length, at);
        at += leaf.length;
      }

      const h = Buffer.alloc(HEADER_BYTES);
      h.write('PMTiles', 0, 'utf8');
      h.writeUInt8(3, 7);
      const u64 = (v, offset) => h.writeBigUInt64LE(BigInt(v), offset);
      u64(HEADER_BYTES, 8);
      u64(root.length, 16);
      u64(metadataOffset, 24);
      u64(meta.length, 32);
      u64(leafOffset, 40);
      u64(at - leafOffset, 48);
      u64(ROOT_LIMIT, 56);
      u64(this.length, 64);
      u64(this.entries.length, 72);
      u64(this.entries.length, 80);
      u64(this.entries.length, 88);
      h.writeUInt8(1, 96);
      h.writeUInt8(GZIP, 97);
      h.writeUInt8(GZIP, 98);
      h.writeUInt8(MVT, 99);
      h.writeUInt8(this.minZoom, 100);
      h.writeUInt8(this.maxZoom, 101);
      const e7 = (v, offset) => h.writeInt32LE(Math.round(v * 1e7), offset);
      e7(bounds[0], 102);
      e7(bounds[1], 106);
      e7(bounds[2], 110);
      e7(bounds[3], 114);
      h.writeUInt8(center[2], 118);
      e7(center[0], 119);
      e7(center[1], 123);
      writeSync(this.fd, h, 0, HEADER_BYTES, 0);
      writeSync(this.fd, root, 0, root.length, HEADER_BYTES);
      return { tiles: this.entries.length, bytes: at, leaves: leaves.length };
    } finally {
      closeSync(this.fd);
    }
  }
}
