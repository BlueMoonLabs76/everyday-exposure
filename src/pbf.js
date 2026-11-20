// Reads OpenStreetMap PBF files (.osm.pbf), the format of Geofabrik extracts (ADR 0003), with no dependencies.
// A file is a sequence of blobs, each a zlib-compressed protobuf block of nodes, ways, or relations:
// https://wiki.openstreetmap.org/wiki/PBF_Format. Only what the study inputs need is decoded; metadata is skipped.
import { closeSync, openSync, readSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const NODE = 1;
const WAY = 2;
const RELATION = 4;
const MEMBER_TYPES = ['node', 'way', 'relation'];
const SUPPORTED_FEATURES = new Set(['OsmSchema-V0.6', 'DenseNodes']);
const MAX_BLOB_HEADER = 64 * 1024;

// The tags of an element that has none. Shared, so untagged nodes cost no allocation.
export const NO_TAGS = Object.freeze({});

// A cursor over protobuf wire format in buf[pos, end).
class Pbf {
  constructor(buf, pos = 0, end = buf.length) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }

  more() {
    return this.pos < this.end;
  }

  // Exact up to 2^53, far above any OSM id or coordinate.
  varint() {
    let b = this.buf[this.pos++];
    let value = b & 0x7f;
    for (let scale = 0x80; b & 0x80; scale *= 0x80) {
      b = this.buf[this.pos++];
      value += (b & 0x7f) * scale;
    }
    return value;
  }

  // Zigzag-encoded signed varint.
  svarint() {
    const v = this.varint();
    return v % 2 ? -(v + 1) / 2 : v / 2;
  }

  // Two's complement int64: negative values arrive as 10-byte varints.
  int64() {
    const v = this.varint();
    return v >= 2 ** 63 ? v - 2 ** 64 : v;
  }

  // A length-delimited field as a cursor of its own.
  slice() {
    const length = this.varint();
    const inner = new Pbf(this.buf, this.pos, this.pos + length);
    this.pos += length;
    return inner;
  }

  bytes() {
    const length = this.varint();
    this.pos += length;
    return this.buf.subarray(this.pos - length, this.pos);
  }

  string() {
    const length = this.varint();
    this.pos += length;
    return this.buf.toString('utf8', this.pos - length, this.pos);
  }

  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      // Not `this.pos += this.varint()`: that reads pos before the length is consumed.
      const length = this.varint();
      this.pos += length;
    } else if (wire === 5) this.pos += 4;
    else throw new Error(`unsupported protobuf wire type ${wire}`);
  }
}

function read(fd, position, length) {
  const buf = Buffer.allocUnsafe(length);
  for (let done = 0; done < length; ) {
    const n = readSync(fd, buf, done, length - done, position + done);
    if (!n) throw new Error('the PBF file is truncated');
    done += n;
  }
  return buf;
}

// A blob's contents, decompressed.
function unpack(blob) {
  for (const r = new Pbf(blob); r.more(); ) {
    const t = r.varint();
    if (t >>> 3 === 1) return r.bytes(); // raw
    if (t >>> 3 === 3) return inflateSync(r.bytes()); // zlib
    if (t >>> 3 === 2) r.varint(); // raw_size
    else throw new Error(`unsupported PBF blob compression (field ${t >>> 3}); only raw and zlib are read`);
  }
  throw new Error('empty PBF blob');
}

function decodeHeader(data) {
  const header = { requiredFeatures: [], replicationTimestamp: null };
  for (const r = new Pbf(data); r.more(); ) {
    const t = r.varint();
    if (t >>> 3 === 4) header.requiredFeatures.push(r.string());
    else if (t >>> 3 === 32) header.replicationTimestamp = r.int64();
    else r.skip(t & 7);
  }
  return header;
}

// Opens a PBF file and indexes its blocks without decompressing them.
// osmSnapshot is the time the file's data is current to, as ISO 8601, when the file records it.
export function openExtract(path) {
  const fd = openSync(path, 'r');
  try {
    const blocks = [];
    let header = null;
    for (let position = 0; ; ) {
      const size = Buffer.alloc(4);
      if (readSync(fd, size, 0, 4, position) < 4) break;
      const headerLength = size.readUInt32BE(0);
      if (headerLength > MAX_BLOB_HEADER) throw new Error(`${path} is not an OSM PBF file`);
      let type = null;
      let dataSize = 0;
      for (const r = new Pbf(read(fd, position + 4, headerLength)); r.more(); ) {
        const t = r.varint();
        if (t >>> 3 === 1) type = r.string();
        else if (t >>> 3 === 3) dataSize = r.varint();
        else r.skip(t & 7);
      }
      const offset = position + 4 + headerLength;
      if (type === 'OSMHeader') header = decodeHeader(unpack(read(fd, offset, dataSize)));
      else if (type === 'OSMData') blocks.push({ offset, size: dataSize, kinds: 0 });
      position = offset + dataSize;
    }
    if (!header) throw new Error(`${path} is not an OSM PBF file: it has no header block`);
    const unsupported = header.requiredFeatures.filter(f => !SUPPORTED_FEATURES.has(f));
    if (unsupported.length) throw new Error(`${path} needs features this reader lacks: ${unsupported.join(', ')}`);
    const ts = header.replicationTimestamp;
    const osmSnapshot = ts ? new Date(ts * 1000).toISOString().replace('.000Z', 'Z') : null;
    return { path, fd, blocks, osmSnapshot, close: () => closeSync(fd) };
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}

// Calls visit.node(id, lon, lat, tags), visit.way(id, refs, tags) and visit.relation(id, members, tags) for every
// element of the kinds visit handles, in file order. Coordinates are degrees rounded to 7 decimals, as OSM stores
// them; members are { type, ref, role }. A block already seen to hold none of the wanted kinds is not read again.
export function scan(extract, visit) {
  const want = (visit.node ? NODE : 0) | (visit.way ? WAY : 0) | (visit.relation ? RELATION : 0);
  for (const block of extract.blocks) {
    if (block.kinds && !(block.kinds & want)) continue;
    block.kinds = readBlock(unpack(read(extract.fd, block.offset, block.size)), visit);
  }
}

// Decodes one PrimitiveBlock, dispatching the elements visit wants. Returns the kinds of element it holds.
function readBlock(data, visit) {
  let stringTable = null;
  let strings = null;
  const groups = [];
  let granularity = 100;
  let latOffset = 0;
  let lonOffset = 0;
  for (const r = new Pbf(data); r.more(); ) {
    const t = r.varint();
    const field = t >>> 3;
    if (field === 1) stringTable = r.slice();
    else if (field === 2) groups.push(r.slice());
    else if (field === 17) granularity = r.varint();
    else if (field === 19) latOffset = r.int64();
    else if (field === 20) lonOffset = r.int64();
    else r.skip(t & 7);
  }
  const block = {
    get strings() {
      if (!strings) {
        strings = [];
        for (const s = stringTable ?? new Pbf(Buffer.alloc(0)); s.more(); ) {
          const t = s.varint();
          if (t >>> 3 === 1) strings.push(s.string());
          else s.skip(t & 7);
        }
      }
      return strings;
    },
    // Coordinates in units of 1e-7 degrees are integers, so this is exact before the final division.
    lon: raw => Math.round((lonOffset + granularity * raw) / 100) / 1e7,
    lat: raw => Math.round((latOffset + granularity * raw) / 100) / 1e7,
  };

  let kinds = 0;
  for (const g of groups) {
    while (g.more()) {
      const t = g.varint();
      const field = t >>> 3;
      if (field === 1 || field === 2) {
        kinds |= NODE;
        if (!visit.node) g.skip(2);
        else if (field === 2) denseNodes(g.slice(), block, visit);
        else plainNode(g.slice(), block, visit);
      } else if (field === 3) {
        kinds |= WAY;
        if (visit.way) way(g.slice(), block, visit);
        else g.skip(2);
      } else if (field === 4) {
        kinds |= RELATION;
        if (visit.relation) relation(g.slice(), block, visit);
        else g.skip(2);
      } else g.skip(t & 7);
    }
  }
  return kinds;
}

function tagsOf(keys, vals, strings) {
  if (!keys || !keys.more()) return NO_TAGS;
  const tags = {};
  while (keys.more()) tags[strings[keys.varint()]] = strings[vals.varint()];
  return tags;
}

function denseNodes(r, block, visit) {
  let ids = null;
  let lats = null;
  let lons = null;
  let keysVals = null;
  while (r.more()) {
    const t = r.varint();
    const field = t >>> 3;
    if (field === 1) ids = r.slice();
    else if (field === 8) lats = r.slice();
    else if (field === 9) lons = r.slice();
    else if (field === 10) keysVals = r.slice();
    else r.skip(t & 7);
  }
  if (!ids) return;
  const tagged = keysVals?.more();
  const strings = tagged ? block.strings : null;
  let id = 0;
  let lat = 0;
  let lon = 0;
  while (ids.more()) {
    id += ids.svarint();
    lat += lats.svarint();
    lon += lons.svarint();
    let tags = NO_TAGS;
    // keys_vals holds each node's key and value string indexes in turn, ending with 0.
    if (tagged) {
      for (let k = keysVals.varint(); k !== 0; k = keysVals.varint()) {
        if (tags === NO_TAGS) tags = {};
        tags[strings[k]] = strings[keysVals.varint()];
      }
    }
    visit.node(id, block.lon(lon), block.lat(lat), tags);
  }
}

function plainNode(r, block, visit) {
  let id = 0;
  let lat = 0;
  let lon = 0;
  let keys = null;
  let vals = null;
  while (r.more()) {
    const t = r.varint();
    const field = t >>> 3;
    if (field === 1) id = r.svarint();
    else if (field === 2) keys = r.slice();
    else if (field === 3) vals = r.slice();
    else if (field === 8) lat = r.svarint();
    else if (field === 9) lon = r.svarint();
    else r.skip(t & 7);
  }
  visit.node(id, block.lon(lon), block.lat(lat), keys?.more() ? tagsOf(keys, vals, block.strings) : NO_TAGS);
}

function way(r, block, visit) {
  let id = 0;
  let keys = null;
  let vals = null;
  const refs = [];
  while (r.more()) {
    const t = r.varint();
    const field = t >>> 3;
    if (field === 1) id = r.varint();
    else if (field === 2) keys = r.slice();
    else if (field === 3) vals = r.slice();
    else if (field === 8) {
      for (let p = r.slice(), ref = 0; p.more(); ) refs.push((ref += p.svarint()));
    } else r.skip(t & 7);
  }
  visit.way(id, refs, keys?.more() ? tagsOf(keys, vals, block.strings) : NO_TAGS);
}

function relation(r, block, visit) {
  let id = 0;
  let keys = null;
  let vals = null;
  let roles = null;
  let memids = null;
  let types = null;
  while (r.more()) {
    const t = r.varint();
    const field = t >>> 3;
    if (field === 1) id = r.varint();
    else if (field === 2) keys = r.slice();
    else if (field === 3) vals = r.slice();
    else if (field === 8) roles = r.slice();
    else if (field === 9) memids = r.slice();
    else if (field === 10) types = r.slice();
    else r.skip(t & 7);
  }
  const strings = block.strings;
  const members = [];
  for (let ref = 0; memids?.more(); ) {
    ref += memids.svarint();
    members.push({ type: MEMBER_TYPES[types.varint()], ref, role: strings[roles.varint()] });
  }
  visit.relation(id, members, keys?.more() ? tagsOf(keys, vals, strings) : NO_TAGS);
}
