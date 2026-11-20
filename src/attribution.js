// ODbL obligations for everything the pipeline publishes: the corner credit on every map,
// the credit line in each page's method section, and the notice that travels with the scores CSV.
const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';
const ODBL = 'https://opendatacommons.org/licenses/odbl/1-0/';

// Leaflet attribution control: "© OpenStreetMap contributors, ODbL", linked to OSM's copyright page.
export const CORNER_CREDIT = `&copy; <a href="${OSM_COPYRIGHT}">OpenStreetMap</a> contributors, ODbL`;

// Snapshot timestamps of every input, oldest first, e.g. "2026-09-10T18:34:17Z".
const snapshots = meta => [...new Set([meta?.osmSnapshot, ...Object.values(meta?.datasets ?? {}).map(d => d.osmSnapshot)].filter(Boolean))].sort();

// One paragraph of HTML for a page's disclaimer/method section.
export function creditHtml(meta) {
  const when = snapshots(meta);
  const snapshot = when.length ? `OSM snapshot ${when.length === 1 ? when[0] : `${when[0]} to ${when.at(-1)}`}.` : 'OSM snapshot unknown.';
  return `Map data &copy; <a href="${OSM_COPYRIGHT}">OpenStreetMap</a> contributors, available under the ` +
    `<a href="${ODBL}">Open Database License (ODbL) 1.0</a>. ${snapshot} ` +
    `Thanks to the volunteers who map these cameras in OpenStreetMap, including the <a href="https://deflock.org/">DeFlock</a> project.`;
}

// Plain-text notice for the scores CSV (ODbL §4.3, and §4.4 share-alike for a Derivative Database).
export function csvNotice({ file, meta, place, relations = [], columns }) {
  return [
    file,
    '',
    `Contains information from OpenStreetMap, which is made available under the Open Database License (ODbL) 1.0. ${OSM_COPYRIGHT}`,
    `${file} is a Derivative Database of OpenStreetMap and is itself released under the ODbL 1.0: ${ODBL}`,
    '',
    `Origins in ${place ?? 'unknown'}, OSM relation${relations.length === 1 ? '' : 's'} ${relations.join(', ') || 'unknown'}.`,
    'The Study Area is the 50 US states and DC: every route is the one a single build of the whole country gives,',
    'so trips may cross state lines.',
    `OSM snapshots: ${snapshots(meta).join(', ') || 'unknown'}.`,
    '',
    'One row per Origin: the midpoint of one OSM way (way_id) standing in for the homes along it.',
    'For each Destination Category, <category>_exposure is the number of mapped ALPR Cameras within 75 ft of the',
    'first 40 km (25 mi) of the fastest route to <category>_destination, and <category>_minutes is the whole',
    'route\'s time under a demo speed model.',
    'Blank cells: no destination in that category can be reached from the street.',
    '',
    `Columns: ${columns.join(', ')}`,
    '',
    'These are estimates, not records. Unmapped cameras make every count a minimum; the bearing-blind 75 ft rule',
    'overcounts at some intersections and divided roads. See the disclaimer on the map page.',
    '',
  ].join('\n');
}

// Plain-text notice that travels with the national map's data files (ODbL §4.3, and §4.4 share-alike).
export function tilesNotice({ osmSnapshot, states }) {
  return [
    'exposure.pmtiles, selections.json and search/',
    '',
    `Contains information from OpenStreetMap, which is made available under the Open Database License (ODbL) 1.0. ${OSM_COPYRIGHT}`,
    `These files are a Derivative Database of OpenStreetMap and are themselves released under the ODbL 1.0: ${ODBL}`,
    '',
    `States built: ${states.join(', ')}.`,
    'The Study Area is the 50 US states and DC: every route is the one a single build of the whole country gives,',
    'so trips may cross state lines.',
    `OSM snapshot: ${osmSnapshot}.`,
    '',
    'Each street, an OSM way standing in for the homes along it, carries for each Destination Category the number of',
    'mapped ALPR Cameras within 75 ft of the first 40 km (25 mi) of the fastest route to that category\'s nearest',
    'destination, the destination, and the whole route\'s minutes under a demo speed model. Zoomed out, a grid gives',
    'the mean Exposure of the streets in each cell.',
    '',
    'These are estimates, not records. Unmapped cameras make every count a minimum; the bearing-blind 75 ft rule',
    'overcounts at some intersections and divided roads. See the disclaimer on the map page.',
    '',
  ].join('\n');
}
