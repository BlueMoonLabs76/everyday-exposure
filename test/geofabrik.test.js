import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findState, usStates } from '../src/geofabrik.js';

const square = [[[-80, 37], [-79, 37], [-79, 38], [-80, 38], [-80, 37]]];
const feature = (id, iso) => ({
  type: 'Feature',
  properties: { id, 'iso3166-2': iso, urls: { pbf: `https://example.org/${id}.osm.pbf` } },
  geometry: { type: 'Polygon', coordinates: square },
});

test('states are found whether Geofabrik gives the ISO code as a string or a list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'geofabrik-'));
  try {
    const path = join(dir, 'index.json');
    await writeFile(path, JSON.stringify({
      type: 'FeatureCollection',
      features: [
        feature('us/virginia', 'US-VA'),
        feature('us/ohio', ['US-OH']),
        feature('us/puerto-rico', 'US-PR'),
        feature('canada', 'CA'),
      ],
    }));
    const states = await usStates(path);
    assert.deepEqual(states.map(s => [s.id, s.iso]), [['us/virginia', 'US-VA'], ['us/ohio', 'US-OH']]);
    assert.equal(findState(states, 'virginia').id, 'us/virginia');
    assert.equal(findState(states, 'OH').id, 'us/ohio');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
