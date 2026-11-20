import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countedPart, observations } from '../src/exposure.js';

// A straight drive east along 40°N, built from segments of a given length in metres at 20 m/s.
const LAT = 40;
const DEG_PER_M = 1 / (111320 * Math.cos((LAT * Math.PI) / 180));
const east = m => [-100 + m * DEG_PER_M, LAT];
const drive = lengths => {
  let at = 0;
  return lengths.map(lengthM => {
    const s = { coords: [east(at), east(at + lengthM)], lengthM, timeS: lengthM / 20 };
    at += lengthM;
    return s;
  });
};
const seen = (segments, metres) => observations(countedPart(segments), metres.map((m, i) => ({ id: i + 1, lon: east(m)[0], lat: LAT })))
  .map(o => o.camera.id);

test('only the first 40 km of a trip counts: a camera 50 m before the mark is observed, one 50 m after is not', () => {
  const segments = drive(Array(10).fill(5000));
  assert.deepEqual(seen(segments, [39950, 40050, 45000]), [1]);
  assert.equal(countedPart(segments).length, 8);
});

test('a segment crossing 40 km is cut at the mark, with its time cut in proportion', () => {
  const segments = drive([30000, 30000]);
  assert.deepEqual(seen(segments, [100, 39950, 40050]), [1, 2]);
  const [first, cut] = countedPart(segments);
  assert.equal(first, segments[0]);
  assert.equal(cut.lengthM, 10000);
  assert.equal(cut.timeS, 500);
  assert.ok(Math.abs(cut.coords[1][0] - east(40000)[0]) < 1e-9);
});

test('a trip shorter than 40 km counts whole, and one with no camera in its first 40 km has Exposure 0', () => {
  const short = drive([12000, 8000]);
  assert.deepEqual(countedPart(short), short);
  assert.deepEqual(seen(drive([30000, 30000]), [41000, 59000]), []);
});
