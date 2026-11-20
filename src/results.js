// A state's scores as `npm run heatmap` saves them in out/<state>/results.bin, for `npm run map` to draw: each
// Origin's way (its index in data/<state>/roads.bin) and midpoint, and for each Destination Category its result.
import { closeSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';

// Scores that are not a count of cameras.
export const NO_ROUTE = -1;
export const UNPROVEN = -2;

const TYPES = { Int8Array, Uint8Array, Int16Array, Int32Array, Float32Array, Float64Array };

// origins: from findOrigins. results: { category: [result per Origin] } from scoreState. info: saved as is.
export function packResults(origins, results, info) {
  const n = origins.length;
  const arrays = {
    storeWay: Int32Array.from(origins, o => o.storeWay),
    lon: Float64Array.from(origins, o => o.lonlat[0]),
    lat: Float64Array.from(origins, o => o.lonlat[1]),
  };
  for (const [key, list] of Object.entries(results)) {
    const score = new Int16Array(n);
    const destination = new Int32Array(n).fill(-1);
    const timeS = new Float32Array(n);
    const lengthM = new Float32Array(n);
    const cameraStart = new Int32Array(n + 1);
    const cameraId = new Float64Array(list.reduce((t, r) => t + (r.status === 'ok' ? r.cameras.length : 0), 0));
    list.forEach((r, i) => {
      cameraStart[i + 1] = cameraStart[i];
      if (r.status !== 'ok') {
        score[i] = r.status === 'none' ? NO_ROUTE : UNPROVEN;
        return;
      }
      score[i] = r.cameras.length;
      destination[i] = r.destination;
      timeS[i] = r.timeS;
      lengthM[i] = r.lengthM;
      for (const id of r.cameras) cameraId[cameraStart[i + 1]++] = id;
    });
    Object.assign(arrays, { [`${key}.score`]: score, [`${key}.destination`]: destination, [`${key}.timeS`]: timeS, [`${key}.lengthM`]: lengthM, [`${key}.cameraStart`]: cameraStart, [`${key}.cameraId`]: cameraId });
  }
  return { info: { ...info, origins: n, categories: Object.keys(results) }, arrays };
}

export function saveResults(path, { info, arrays }) {
  const list = [];
  let offset = 0;
  for (const [key, a] of Object.entries(arrays)) {
    list.push({ key, type: a.constructor.name, length: a.length, offset });
    offset += Math.ceil(a.byteLength / 8) * 8;
  }
  const header = Buffer.from(JSON.stringify({ info, arrays: list }));
  const base = 8 + Math.ceil(header.length / 8) * 8;
  const out = Buffer.alloc(base + offset);
  out.writeUInt32LE(header.length, 0);
  header.copy(out, 8);
  list.forEach(({ key, offset: at }) => {
    const a = arrays[key];
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), base + at);
  });
  writeFileSync(path, out);
}

// Only the info saved with the results, without reading the arrays.
export function readResultsInfo(path) {
  const fd = openSync(path, 'r');
  try {
    const size = Buffer.alloc(4);
    readSync(fd, size, 0, 4, 0);
    const header = Buffer.alloc(size.readUInt32LE(0));
    readSync(fd, header, 0, header.length, 8);
    return JSON.parse(header.toString('utf8')).info;
  } finally {
    closeSync(fd);
  }
}

// { info, arrays } as saved; each category's arrays are also grouped under categories[key].
export function loadResults(path) {
  const file = readFileSync(path);
  const headerLength = file.readUInt32LE(0);
  const { info, arrays: list } = JSON.parse(file.toString('utf8', 8, 8 + headerLength));
  const base = 8 + Math.ceil(headerLength / 8) * 8;
  const arrays = {};
  for (const { key, type, length, offset } of list) {
    const Type = TYPES[type];
    const start = file.byteOffset + base + offset;
    arrays[key] = start % Type.BYTES_PER_ELEMENT === 0
      ? new Type(file.buffer, start, length)
      : new Type(file.buffer.slice(start, start + length * Type.BYTES_PER_ELEMENT));
  }
  const categories = Object.fromEntries(info.categories.map(key => [key, {
    score: arrays[`${key}.score`], destination: arrays[`${key}.destination`], timeS: arrays[`${key}.timeS`],
    lengthM: arrays[`${key}.lengthM`], cameraStart: arrays[`${key}.cameraStart`], cameraId: arrays[`${key}.cameraId`],
  }]));
  return { info, arrays, categories };
}
