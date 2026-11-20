// Writes and reads plain .zip files, with no dependencies: enough to package a map for a release and to check
// the package afterwards. Entry names always use forward slashes, which every unzip tool, including the Pages
// workflow's, reads as folders. No ZIP64, so the whole archive must stay under 4 GB.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const STORE = 0;
const DEFLATE = 8;
const UTF8 = 0x0800;

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// entries: [{ name, data: Buffer, mtime?: Date }]. Each is deflated, or stored when deflating does not shrink it
// (map tiles are already compressed).
export function writeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data, mtime = new Date() } of entries) {
    if (name.includes('\\')) throw new Error(`zip entry names use forward slashes: ${name}`);
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const method = deflated.length < data.length ? DEFLATE : STORE;
    const body = method === DEFLATE ? deflated : data;
    const crc = crc32(data);
    const { time, day } = dosTime(mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(CENTRAL, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(UTF8, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);

    offset += local.length + nameBuf.length + body.length;
    if (offset > 0xffffffff) throw new Error('zip would pass 4 GB, which this writer does not support');
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

// Returns [{ name, data }] for every entry, checking each one's CRC. Throws on anything that is not a zip.
export function readZip(buf) {
  if (buf.length < 22 || buf.readUInt32LE(0) !== LOCAL) throw new Error('not a zip file');
  let endAt = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === END) { endAt = i; break; }
  }
  if (endAt < 0) throw new Error('zip has no end-of-directory record');
  const count = buf.readUInt16LE(endAt + 10);
  let at = buf.readUInt32LE(endAt + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== CENTRAL) throw new Error(`zip directory entry ${n} is damaged`);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(localAt) !== LOCAL) throw new Error(`zip entry ${name} is damaged`);
    const start = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const body = buf.subarray(start, start + size);
    let data;
    if (method === STORE) data = body;
    else if (method === DEFLATE) data = inflateRawSync(body);
    else throw new Error(`zip entry ${name} uses compression method ${method}, which this reader lacks`);
    if (crc32(data) !== crc) throw new Error(`zip entry ${name} fails its checksum`);
    entries.push({ name, data });
  }
  return entries;
}
