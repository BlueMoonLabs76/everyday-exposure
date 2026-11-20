import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readZip, writeZip } from '../src/zip.js';

test('a zip reads back to the same files, stored or deflated', () => {
  const text = Buffer.from('hello map '.repeat(500));
  const random = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 2654435761) >>> 24));
  const files = [
    { name: 'index.html', data: text },
    { name: 'search/a.json', data: random },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ];
  const zip = writeZip(files);
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'starts with the zip signature');
  assert.ok(zip.length < text.length + random.length, 'repetitive text is compressed');
  assert.deepEqual(readZip(zip).map(e => [e.name, e.data.toString('hex')]), files.map(f => [f.name, f.data.toString('hex')]));
});

test('a zip refuses backslash names and readZip refuses a tar file', () => {
  assert.throws(() => writeZip([{ name: 'search\\a.json', data: Buffer.from('x') }]), /forward slashes/);
  assert.throws(() => readZip(Buffer.alloc(1024)), /not a zip/);
});

test('readZip catches a damaged entry', () => {
  const zip = writeZip([{ name: 'a.txt', data: Buffer.from('abcdefgh') }]);
  zip[30 + 'a.txt'.length + 2] ^= 0xff;
  assert.throws(() => readZip(zip));
});
