// Packages a built state for a GitHub release (README, "Publishing a map on GitHub Pages"):
//   map.zip                      everything in out/map-<state>/ plus LICENSE-DATA, for the Pages workflow
//   <state>-exposure-csv.zip     out/<state>/exposure.csv and exposure.NOTICE.txt plus LICENSE-DATA, the data download
// npm run zip-map -- <state> [--to <folder>]      (default folder: publish-<state>-map/)
// Each zip is read back after writing and every file compared byte for byte with its source.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, writeZip } from './zip.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const toAt = args.indexOf('--to');
const to = toAt >= 0 ? args.splice(toAt, 2)[1] : null;
const state = args[0]?.split('/').pop().toLowerCase();
if (!state || (toAt >= 0 && !to)) {
  console.error('Usage: npm run zip-map -- <state> [--to <folder>]');
  process.exit(1);
}

const mapDir = join(root, 'out', `map-${state}`);
const dataDir = join(root, 'out', state);
const outDir = join(root, to ?? `publish-${state}-map`);
for (const [dir, how] of [[mapDir, `npm run map -- --out map-${state} ${state}`], [dataDir, `npm run heatmap -- ${state}`]]) {
  if (!existsSync(dir)) {
    console.error(`Missing ${relative(root, dir)}/. Run "${how}" first.`);
    process.exit(1);
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}
const fileEntry = (path, name) => ({ name, path, data: readFileSync(path), mtime: statSync(path).mtime });

function pack(fileName, entries) {
  const zipPath = join(outDir, fileName);
  writeFileSync(zipPath, writeZip(entries));
  const back = new Map(readZip(readFileSync(zipPath)).map(e => [e.name, e.data]));
  const bad = entries.filter(e => !back.get(e.name)?.equals(e.data));
  if (back.size !== entries.length || bad.length) {
    throw new Error(`${fileName} did not read back cleanly: ${back.size} of ${entries.length} entries, ${bad.length} differ`);
  }
  const mb = (statSync(zipPath).size / 1e6).toFixed(1);
  console.log(`Wrote ${relative(root, zipPath)}: ${entries.length} files, ${mb} MB, read back and matched.`);
}

const license = fileEntry(join(root, 'LICENSE-DATA'), 'LICENSE-DATA');
const mapFiles = [...walk(mapDir)].map(p => fileEntry(p, relative(mapDir, p).split(sep).join('/')));
if (!mapFiles.some(e => e.name === 'index.html')) {
  console.error(`${relative(root, mapDir)}/ has no index.html. Rebuild it with "npm run map -- --out map-${state} ${state}".`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
pack('map.zip', [...mapFiles, license]);
pack(`${state}-exposure-csv.zip`, [
  fileEntry(join(dataDir, 'exposure.csv'), 'exposure.csv'),
  fileEntry(join(dataDir, 'exposure.NOTICE.txt'), 'exposure.NOTICE.txt'),
  license,
]);
