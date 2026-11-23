// Packages built states for a GitHub release (README, "Publishing a map on GitHub Pages"):
//   map.zip                      for the Pages workflow. One state: everything in out/map-<state>/ plus LICENSE-DATA.
//                                Several states: each map in its own folder, <state>/, a page at the top linking to
//                                them, and LICENSE-DATA.
//   <state>-exposure-csv.zip     per state: out/<state>/exposure.csv and exposure.NOTICE.txt plus LICENSE-DATA, the data download
// npm run zip-map -- <state> [<state> ...] [--to <folder>]      (default folder: publish-<state>[-<state>...]-map/)
// Each zip is read back after writing and every file compared byte for byte with its source.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORNER_CREDIT } from './attribution.js';
import { PROJECT_NAME, TAGLINE } from './config.js';
import { readZip, writeZip } from './zip.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const toAt = args.indexOf('--to');
const to = toAt >= 0 ? args.splice(toAt, 2)[1] : null;
const states = [...new Set(args.map(a => a.split('/').pop().toLowerCase()))];
if (!states.length || (toAt >= 0 && !to) || states.some(s => s.startsWith('-'))) {
  console.error('Usage: npm run zip-map -- <state> [<state> ...] [--to <folder>]');
  process.exit(1);
}

for (const state of states) {
  for (const [dir, how] of [[join(root, 'out', `map-${state}`), `npm run map -- --out map-${state} ${state}`], [join(root, 'out', state), `npm run heatmap -- ${state}`]]) {
    if (!existsSync(dir)) {
      console.error(`Missing ${relative(root, dir)}/. Run "${how}" first.`);
      process.exit(1);
    }
  }
}
const outDir = join(root, to ?? `publish-${states.join('-')}-map`);

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

// A state's map files, named under prefix ('' for a lone state, '<state>/' when several share the site).
function mapEntries(state, prefix) {
  const mapDir = join(root, 'out', `map-${state}`);
  const files = [...walk(mapDir)].map(p => fileEntry(p, prefix + relative(mapDir, p).split(sep).join('/')));
  if (!files.some(e => e.name === `${prefix}index.html`)) {
    console.error(`${relative(root, mapDir)}/ has no index.html. Rebuild it with "npm run map -- --out map-${state} ${state}".`);
    process.exit(1);
  }
  return files;
}

// The state's name as its map shows it, from its selections.json.
const stateName = state => JSON.parse(readFileSync(join(root, 'out', `map-${state}`, 'selections.json'), 'utf8')).states?.[0]?.name ?? state;

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
// The page at the top of a several-state site: one link per state's map.
function pickerPage(list) {
  const links = list.map(({ state, name }) => `    <li><a href="${esc(state)}/">${esc(name)}</a></li>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(PROJECT_NAME)}</title>
<style>
  :root { --bg: #f7f5f0; --ink: #1d1b16; --ink-2: #5b574c; --accent: #bb3b2b; --card: #fff; --ring: #d9d4c7; }
  @media (prefers-color-scheme: dark) { :root { --bg: #17150f; --ink: #f1ede3; --ink-2: #b2ac9c; --accent: #e07a4f; --card: #221f17; --ring: #3a3529; } }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: 48px 16px; }
  h1 { margin: 0 0 4px; font-size: 28px; }
  p { margin: 0 0 24px; color: var(--ink-2); }
  ul { list-style: none; padding: 0; margin: 0 0 32px; display: grid; gap: 10px; }
  a { color: var(--accent); }
  li a { display: block; padding: 14px 16px; background: var(--card); border: 1px solid var(--ring); border-radius: 10px; color: var(--ink); font-weight: 600; text-decoration: none; }
  li a:hover, li a:focus-visible { border-color: var(--accent); }
  small { color: var(--ink-2); }
</style>
</head>
<body>
<main>
  <h1>${esc(PROJECT_NAME)}</h1>
  <p>${esc(TAGLINE)}. Pick a state:</p>
  <ul>
${links}
  </ul>
  <small>Map data ${CORNER_CREDIT}.</small>
</main>
</body>
</html>
`;
}

const license = fileEntry(join(root, 'LICENSE-DATA'), 'LICENSE-DATA');
mkdirSync(outDir, { recursive: true });
if (states.length === 1) {
  pack('map.zip', [...mapEntries(states[0], ''), license]);
} else {
  const list = states.map(state => ({ state, name: stateName(state) })).sort((a, b) => a.name.localeCompare(b.name));
  pack('map.zip', [
    { name: 'index.html', data: Buffer.from(pickerPage(list)), mtime: new Date() },
    ...list.flatMap(({ state }) => mapEntries(state, `${state}/`)),
    license,
  ]);
}
for (const state of states) {
  const dataDir = join(root, 'out', state);
  pack(`${state}-exposure-csv.zip`, [
    fileEntry(join(dataDir, 'exposure.csv'), 'exposure.csv'),
    fileEntry(join(dataDir, 'exposure.NOTICE.txt'), 'exposure.NOTICE.txt'),
    license,
  ]);
}
