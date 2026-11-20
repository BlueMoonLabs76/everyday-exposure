// The national map page (ADR 0007): MapLibre drawing exposure.pmtiles, with each Selection's figures, "Find your
// street", and the disclaimer. It is served beside the tiles over HTTP (`npm run serve`); opened from disk it can't
// read them.
import { CORNER_CREDIT, creditHtml } from './attribution.js';
import { COUNTED_TRIP_M, PROJECT_NAME, TAGLINE } from './config.js';
import { DISCLAIMER } from './disclaimer.js';
import { AREA_ZOOM, AREA_ZOOM_END, CAMERA_MIN_ZOOM, COUNTY_ZOOM, LOCAL_ZOOM, MIN_ZOOM, ROAD_MIN_ZOOM, STREET_ZOOM } from './map-layers.js';

const MAPLIBRE = 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl';
const PMTILES = 'https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/dist/pmtiles.js';
const TOTAL_STATES = 51;

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// categories: [{ key, label }]. states: the names of the states built. stop: words the search index leaves out.
export function renderMap({ osmSnapshot, categories, states, stop }) {
  const config = {
    categories,
    states,
    stop,
    totalStates: TOTAL_STATES,
    minZoom: MIN_ZOOM,
    roadZoom: ROAD_MIN_ZOOM,
    localZoom: LOCAL_ZOOM,
    streetZoom: STREET_ZOOM,
    cameraMinZoom: CAMERA_MIN_ZOOM,
    countyZoom: COUNTY_ZOOM,
    areaZoom: AREA_ZOOM,
    areaZoomEnd: AREA_ZOOM_END,
    limitKm: COUNTED_TRIP_M / 1000,
    limitMi: Math.round(COUNTED_TRIP_M / 1609.344),
    credit: CORNER_CREDIT,
  };
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  const tabs = categories.map((c, i) => `<button type="button" role="tab" data-cat="${i}">${esc(c.label)}</button>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(PROJECT_NAME)}: national map</title>
<link rel="stylesheet" href="${MAPLIBRE}.css">
<style>
  :root {
    --surface: #fcfcfb; --plane: #f4f3ef; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
    --hairline: #e1e0d9; --ring: rgba(11,11,11,0.10);
    /* The map's own background, not the panel's: a step darker than --plane so land reads as land, not more UI. */
    --land: #e1ded2;
  }
  html, body { height: 100%; margin: 0; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--plane); }
  #map { position: absolute; inset: 0; background: var(--land); }
  .panel { position: absolute; z-index: 2; top: 12px; left: 12px; width: min(360px, calc(100% - 24px)); max-height: calc(100% - 24px); overflow: auto;
    background: var(--surface); padding: 14px 16px; border-radius: 10px; box-shadow: 0 0 0 1px var(--ring), 0 4px 16px rgba(0,0,0,.12); box-sizing: border-box; }
  h1 { font-size: 16px; margin: 0; }
  .tagline { color: var(--ink-2); margin: 2px 0 0; font-size: 13px; font-weight: 500; }
  .intro { margin: 8px 0 14px; font-size: 13px; line-height: 1.45; }
  .sub { color: var(--ink-2); margin: 2px 0 10px; font-size: 13px; }
  .place { display: flex; flex-direction: column; gap: 6px; margin: 0 0 10px; }
  select, .find input { width: 100%; box-sizing: border-box; font: inherit; padding: 6px 8px; border-radius: 6px;
    border: 1px solid var(--hairline); background: var(--surface); color: var(--ink); }
  .find-label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; }
  .find input { padding: 10px 12px; font-size: 15px; border-color: var(--ink-2); }
  .tabs { display: flex; gap: 4px; background: var(--plane); padding: 3px; border-radius: 8px; margin-bottom: 12px; }
  .tabs button { flex: 1; border: 0; background: transparent; padding: 6px 8px; border-radius: 6px; font: inherit; color: var(--ink-2); cursor: pointer; }
  .tabs button[aria-selected="true"] { background: var(--surface); color: var(--ink); font-weight: 600; box-shadow: 0 0 0 1px var(--ring); }
  .hero { display: flex; gap: 16px; margin-bottom: 10px; }
  .hero div { flex: 1; }
  .hero b { display: block; font-size: 28px; line-height: 1.1; }
  .hero span { color: var(--ink-2); font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-weight: 500; color: var(--muted); font-size: 12px; padding: 2px 4px; border-bottom: 1px solid var(--hairline); }
  td { padding: 3px 4px; font-variant-numeric: tabular-nums; }
  td.num, th.num { text-align: right; }
  .swatch { display: inline-block; width: 22px; height: 4px; border-radius: 2px; vertical-align: middle; margin-right: 6px; }
  details { margin-top: 10px; }
  summary { cursor: pointer; font-weight: 600; font-size: 13px; }
  .detail { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--hairline); }
  .detail b.big { font-size: 22px; }
  .dim { color: var(--ink-2); }
  .small { font-size: 12px; }
  .caveat { font-size: 12px; color: var(--ink-2); margin: 0 0 12px; padding: 6px 8px; background: var(--plane); border-radius: 6px; }
  .problem { font-size: 13px; margin: 0 0 12px; padding: 8px 10px; background: #fbeae5; border-radius: 6px; }
  .find { margin: 0 0 16px; position: relative; }
  .find input::placeholder { color: var(--muted); }
  .results { list-style: none; margin: 4px 0 0; padding: 0; max-height: 220px; overflow: auto; border-radius: 6px; box-shadow: 0 0 0 1px var(--ring); }
  .results li { display: flex; gap: 8px; align-items: baseline; padding: 6px 9px; font-size: 13px; cursor: pointer; }
  .results li:hover { background: var(--plane); }
  .results .nm { flex: 1; }
  .results .zn { display: block; color: var(--muted); font-size: 11px; }
  .results .sc { font-variant-numeric: tabular-nums; font-weight: 600; }
  .results li.none { cursor: default; color: var(--ink-2); }
  .results li.none:hover { background: none; }
  button.link { border: 0; background: none; padding: 0; font: inherit; color: var(--ink); text-decoration: underline; cursor: pointer; }
  .toggles { display: flex; gap: 14px; margin-top: 10px; font-size: 13px; }
  ol { padding-left: 20px; margin: 4px 0; }
  .maplibregl-popup-content { font: 12px/1.35 system-ui, sans-serif; padding: 6px 9px; }
  .head { display: flex; align-items: flex-start; gap: 8px; }
  .head > div { flex: 1; }
  .help { flex: none; border: 1px solid var(--hairline); background: var(--surface); color: var(--ink-2); border-radius: 999px;
    padding: 3px 10px; font: inherit; font-size: 12px; cursor: pointer; }
  /* What the map is showing at this zoom, and the one thing to do next. */
  .hint { position: absolute; z-index: 1; top: 12px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
    max-width: calc(100% - 120px); background: var(--ink); color: var(--surface); padding: 7px 8px 7px 14px; border-radius: 999px;
    font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,.18); }
  .hint[hidden] { display: none; }
  .hint button { flex: none; border: 0; border-radius: 999px; padding: 5px 12px; font: inherit; font-weight: 600; background: var(--surface); color: var(--ink); cursor: pointer; }
  @media (min-width: 601px) { .hint { left: calc(50% + 186px); max-width: calc(100% - 460px); } }
  /* First-visit cards. */
  .tour { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(11,11,11,.45); }
  .tour[hidden] { display: none; }
  /* Cards 2 and 3 sit beside what they point at: the backdrop goes clear, a ring cut out of the dimming (.spot) marks
     the field, and the card's arrow (--ax along its edge) points to it. */
  .tour.anchored { background: transparent; display: block; padding: 0; }
  .tour.anchored .card { position: fixed; width: min(320px, calc(100% - 24px)); padding: 16px 18px 12px; }
  .tour.anchored .pic { display: none; }
  .tour.anchored .card h2 { font-size: 18px; }
  .spot { position: fixed; z-index: 10; border-radius: 10px; pointer-events: none; box-shadow: 0 0 0 4px #f2b33d, 0 0 0 9999px rgba(11,11,11,.45);
    transition: all .25s ease; }
  .spot[hidden] { display: none; }
  .card::before { content: none; position: absolute; width: 14px; height: 14px; background: var(--surface); transform: rotate(45deg); }
  .card.arrow-left::before { content: ''; left: -7px; top: var(--ax); margin-top: -7px; }
  .card.arrow-down::before { content: ''; bottom: -7px; left: var(--ax); margin-left: -7px; }
  .card.arrow-up::before { content: ''; top: -7px; left: var(--ax); margin-left: -7px; }
  .card { position: relative; width: min(380px, 100%); background: var(--surface); border-radius: 14px; padding: 22px 22px 16px; box-shadow: 0 12px 40px rgba(0,0,0,.25); box-sizing: border-box; }
  .card .step { color: var(--muted); font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; margin: 0 0 6px; }
  .card h2 { font-size: 20px; line-height: 1.25; margin: 0 0 10px; }
  .card p { font-size: 15px; line-height: 1.5; margin: 0 0 10px; color: var(--ink-2); }
  .card .pic { display: flex; gap: 6px; align-items: center; justify-content: center; height: 64px; margin: 4px 0 14px; background: var(--plane); border-radius: 10px; font-size: 13px; color: var(--ink-2); }
  .card .pic span { padding: 5px 10px; border-radius: 6px; background: var(--surface); box-shadow: 0 0 0 1px var(--ring); }
  .card .pic span.on { background: var(--ink); color: var(--surface); box-shadow: none; }
  .card .row { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
  .dots { flex: 1; display: flex; gap: 6px; }
  .dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--hairline); }
  .dots i.on { background: var(--ink); }
  .card .skip { border: 0; background: none; color: var(--ink-2); font: inherit; font-size: 14px; padding: 10px 6px; cursor: pointer; }
  .card .next { border: 0; background: var(--ink); color: var(--surface); font: inherit; font-size: 15px; font-weight: 600; padding: 10px 20px; border-radius: 8px; cursor: pointer; }
  .sheet-toggle { display: none; }
  @media (max-width: 600px) {
    /* A bottom sheet: the street search, the trip tabs and a picked street's trip first, the figures after. Folded (the
       default) it shows only those; "More" opens the rest. */
    .panel { top: auto; bottom: 8px; left: 8px; width: calc(100% - 16px); max-height: 62%; padding: 10px 12px; display: flex; flex-direction: column; }
    .head { align-items: center; margin-bottom: 8px; }
    h1 { font-size: 15px; }
    .sheet-toggle { display: block; }
    .panel.folded > :not(.head):not(.problem):not(.find):not(.tabs):not(.detail) { display: none; }
    .panel.folded > .detail { max-height: 26vh; overflow: auto; }
    .panel.folded .find-label { display: none; }
    .panel > * { order: 10; flex: none; }
    .panel > .head { order: 0; }
    .panel > .problem { order: 1; }
    .panel > .find { order: 2; margin-bottom: 10px; }
    .panel > .tabs { order: 3; margin-bottom: 8px; }
    .panel > .detail { order: 4; margin: 0 0 10px; padding: 0 0 10px; border-top: 0; border-bottom: 1px solid var(--hairline); }
    .tagline, .intro { display: none; }
    .tabs button { padding: 9px 4px; font-size: 13px; }
    .hero b { font-size: 22px; }
    .find input { font-size: 16px; }
    .hint { top: 10px; left: 10px; right: 56px; transform: none; max-width: none; font-size: 12.5px; }
  }
</style>
</head>
<body>
<div id="map"></div>
<div class="hint" id="hint" role="status" hidden><span id="hint-text"></span><button type="button" id="hint-go" hidden></button></div>
<div class="spot" id="spot" hidden></div>
<div class="tour" id="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" hidden>
  <div class="card">
    <p class="step" id="tour-step"></p>
    <h2 id="tour-title"></h2>
    <div class="pic" id="tour-pic"></div>
    <p id="tour-text"></p>
    <div class="row">
      <div class="dots" id="tour-dots"></div>
      <button type="button" class="skip" id="tour-skip">Skip</button>
      <button type="button" class="next" id="tour-next">Next</button>
    </div>
  </div>
</div>
<div class="panel">
  <div class="head">
    <div>
      <h1>${esc(PROJECT_NAME)}</h1>
      <p class="tagline">${esc(TAGLINE)}</p>
    </div>
    <button type="button" class="help" id="help">How it works</button>
    <button type="button" class="help sheet-toggle" id="sheet-toggle" aria-expanded="false">More &#9650;</button>
  </div>
  <p class="intro">Every street here has been checked: how many of these cameras would you pass driving to the nearest grocery store, gas station, hospital, or Waffle House? Search your street, or just click one on the map.</p>
  <p class="problem" id="problem" hidden></p>
  <div class="find">
    <label class="find-label" for="q">Try your street</label>
    <input type="search" id="q" placeholder="Your street, e.g. Main Street" autocomplete="off" aria-label="Find your street" aria-controls="results">
    <ul class="results" id="results" role="listbox" hidden></ul>
  </div>
  <p class="sub" id="subtitle"></p>
  <div class="place">
    <select id="state" aria-label="State"></select>
    <select id="part" aria-label="County or independent city" hidden></select>
  </div>
  <div class="tabs" role="tablist">${tabs}</div>
  <div class="hero">
    <div><b id="pct-zero">&ndash;</b><span>of streets pass no mapped camera</span></div>
    <div><b id="mean">&ndash;</b><span>average Exposure (cameras per trip)</span></div>
  </div>
  <p class="caveat">${esc(DISCLAIMER.short)} <button type="button" class="link" id="more">Full disclaimer</button></p>
  <table class="legend">
    <thead><tr><th>Exposure</th><th class="num">Streets</th><th class="num">Share</th></tr></thead>
    <tbody id="legend"></tbody>
  </table>
  <p class="dim small" id="zoom-note"></p>
  <div class="toggles">
    <label><input type="checkbox" id="show-cameras" checked> Cameras</label>
    <label><input type="checkbox" id="show-destinations" checked> Destinations</label>
  </div>
  <div class="detail" id="detail" hidden></div>
  <details id="about">
    <summary>Disclaimer and method</summary>
    ${DISCLAIMER.paragraphs.map(p => `<p class="dim small"><b>${esc(p.lead)}</b> ${esc(p.text)}</p>`).join('\n    ')}
    <p class="dim small"><b>How trips are chosen.</b> Each colored line is one street (an OSM way). Every trip goes to the destination of its kind reached fastest, even across a state line. Grocery means one of 19 big chains, such as Kroger, Walmart, Food Lion, Giant, Aldi or Publix; dollar stores are left out. Gray roads carry no score: interstates and ramps, private roads, and streets that are not Origins. Parking aisles and driveways are not drawn. Zoomed all the way out, the color is each county's or independent city's mean Exposure, drawn only where its streets are. Closer in it blends into each small square's mean for the streets in and around it, weighted toward its own, and then into the streets themselves. The further out, the fewer roads are drawn: interstates stay in view across a state, and every street appears close in.</p>
    <p class="dim small"><b>Built so far:</b> ${esc(states.join(', '))} (${states.length} of ${TOTAL_STATES}). Places outside these states are blank, not zero.</p>
    <p class="dim small">${creditHtml({ osmSnapshot })}</p>
  </details>
</div>
<script src="${MAPLIBRE}.js"></script>
<script src="${PMTILES}"></script>
<script>
const CONFIG = ${json};
// Bin 0 is deliberately the quietest step: most streets pass nothing, and that must not spend the map's visual budget.
// Still amber-hued, never gray - gray means no score.
const RAMP = ['#e0ca9c', '#d9692a', '#bb3b2b', '#8c2530', '#5e1c39', '#3a1432'];
const BIN_LABELS = ['0', '1', '2', '3', '4', '5 or more'];
const UNSCORED = '#9d9b93';
const NEAREST = {
  grocery: 'grocery store',
  gas: 'gas station',
  hospital: 'hospital',
  waffle_house: 'Waffle House',
};
const STOP = new Set(CONFIG.stop);
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const $ = id => document.getElementById(id);

let cat = 0;
let picked = null;
let selections = null;
let place = null;

function problem(text) {
  $('problem').textContent = text;
  $('problem').hidden = false;
}
if (location.protocol === 'file:') problem('This map cannot open from a file on your computer. Open it from its web address instead.');

const key = () => CONFIG.categories[cat].key;
const steps = expr => ['step', expr, RAMP[0], 1, RAMP[1], 2, RAMP[2], 3, RAMP[3], 4, RAMP[4], 5, RAMP[5]];
const streetColor = k => ['case', ['<', ['get', k], 0], UNSCORED, steps(['get', k])];
const ramp = v => ['interpolate', ['linear'], v, 0, RAMP[0], 1, RAMP[1], 2, RAMP[2], 3, RAMP[3], 4, RAMP[4], 5, RAMP[5]];
// Far out a square takes its county's mean, which reads as calm county shapes; closer in it blends to the mean of the
// streets in and around it, and then the streets themselves take over. Squares only exist where streets are, so
// water and empty land stay blank. Tiles built before county means (no _area) fall back to the local mean.
const gridColor = k => ['interpolate', ['linear'], ['zoom'],
  CONFIG.areaZoom, ramp(['to-number', ['coalesce', ['get', k + '_area'], ['get', k + '_mean']]]),
  CONFIG.areaZoomEnd, ramp(['get', k + '_mean'])];
// A square fades with fewer streets in and around it, so a lone rural street is a faint dot and towns read solid. A
// street at a square's middle weighs 36 there; three of them make it opaque.
const gridOpacity = k => ['interpolate', ['linear'], ['get', k + '_w'], 0, 0, 108, 1];
const streetWidth = extra => ['interpolate', ['linear'], ['zoom'], CONFIG.roadZoom, 0.8 + extra, CONFIG.localZoom, 0.8 + extra, CONFIG.streetZoom, 1.2 + extra, 14, 2.5 + extra, 16, 5 + extra];
// Local Roads carry data one zoom before CONFIG.localZoom, tagged 'local' (map-layers.js), so this zoom span is the
// grid squares fading out under them at the same rate they fade in, instead of the two swapping in one frame.
// MapLibre allows ['zoom'] only as the input of a top-level interpolate or step, so each fade is a zoom interpolation
// whose stops are the per-feature values; a style that nests ['zoom'] deeper fails validation and the map never loads.
const isLocal = ['==', ['get', 'local'], 1];
const localFadeIn = full => ['interpolate', ['linear'], ['zoom'], CONFIG.localZoom - 1, ['case', isLocal, 0, full], CONFIG.localZoom, full];
const gridFill = k => ['interpolate', ['linear'], ['zoom'], CONFIG.localZoom - 1, gridOpacity(k), CONFIG.localZoom, 0];

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);
const K = key();
const map = new maplibregl.Map({
  container: 'map',
  bounds: [[-125, 24.5], [-66.9, 49.4]],
  minZoom: CONFIG.minZoom,
  maxZoom: 18,
  dragRotate: false,
  pitchWithRotate: false,
  attributionControl: false,
  style: {
    version: 8,
    sources: {
      ee: { type: 'vector', url: 'pmtiles://' + new URL('exposure.pmtiles', location.href).href },
      picked: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e1ded2' } },
      { id: 'grid', type: 'fill', source: 'ee', 'source-layer': 'grid', maxzoom: CONFIG.localZoom, filter: ['has', K + '_mean'],
        paint: { 'fill-color': gridColor(K), 'fill-opacity': gridFill(K), 'fill-antialias': false } },
      { id: 'counties', type: 'line', source: 'ee', 'source-layer': 'outline', minzoom: CONFIG.countyZoom, maxzoom: CONFIG.localZoom, filter: ['has', 'county'],
        paint: { 'line-color': '#fcfcfb', 'line-width': ['interpolate', ['linear'], ['zoom'], CONFIG.countyZoom, 0.5, CONFIG.localZoom - 1, 1],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], CONFIG.countyZoom, 0.7, CONFIG.areaZoomEnd, 0.7, CONFIG.localZoom, 0] } },
      { id: 'outline', type: 'line', source: 'ee', 'source-layer': 'outline', filter: ['!', ['has', 'county']], paint: { 'line-color': '#898781', 'line-width': 1 } },
      { id: 'roads', type: 'line', source: 'ee', 'source-layer': 'roads', minzoom: CONFIG.roadZoom,
        // Zoomed out, interstates and trunk roads are a darker gray, so they read over the grid.
        paint: { 'line-color': ['interpolate', ['linear'], ['zoom'], CONFIG.localZoom - 1, '#6f6d66', CONFIG.streetZoom, ['case', ['==', ['get', 'local'], 1], '#d9d7d0', '#b9b7ae']],
          'line-width': ['interpolate', ['linear'], ['zoom'], CONFIG.roadZoom, 0.8, CONFIG.localZoom, 1.2, CONFIG.streetZoom, 0.6, 16, 2] } },
      // Over the grid, a light edge keeps a street's line apart from the squares colored like it. A Local Road's edge
      // fades in with its line (isLocal/localFadeIn); every other road's was already visible before this zoom span.
      { id: 'streets-edge', type: 'line', source: 'ee', 'source-layer': 'streets', minzoom: CONFIG.roadZoom, maxzoom: CONFIG.localZoom,
        layout: { 'line-join': 'round' }, paint: { 'line-color': '#fcfcfb', 'line-width': streetWidth(1.6), 'line-opacity': localFadeIn(0.85) } },
      { id: 'picked-casing', type: 'line', source: 'ee', 'source-layer': 'streets', minzoom: CONFIG.streetZoom, filter: ['==', ['id'], -1],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0b0b0b', 'line-width': streetWidth(4) } },
      { id: 'streets', type: 'line', source: 'ee', 'source-layer': 'streets', minzoom: CONFIG.roadZoom,
        layout: { 'line-join': 'round' }, paint: { 'line-color': streetColor(K), 'line-width': streetWidth(0), 'line-opacity': localFadeIn(1) } },
      { id: 'picked-street', type: 'line', source: 'ee', 'source-layer': 'streets', minzoom: CONFIG.streetZoom, filter: ['==', ['id'], -1],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': streetColor(K), 'line-width': streetWidth(0) } },
      { id: 'destinations', type: 'circle', source: 'ee', 'source-layer': 'destinations', minzoom: CONFIG.streetZoom, filter: ['==', ['get', 'category'], K],
        paint: { 'circle-radius': 5, 'circle-color': '#2a78d6', 'circle-stroke-color': '#fcfcfb', 'circle-stroke-width': 1.5 } },
      { id: 'cameras', type: 'circle', source: 'ee', 'source-layer': 'cameras', minzoom: CONFIG.cameraMinZoom,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 2.5, 16, 4], 'circle-color': '#0b0b0b', 'circle-opacity': 0.85 } },
      { id: 'picked-destination', type: 'circle', source: 'picked', filter: ['==', ['get', 'kind'], 'destination'],
        paint: { 'circle-radius': 9, 'circle-color': '#2a78d6', 'circle-stroke-color': '#0b0b0b', 'circle-stroke-width': 2.5 } },
      { id: 'picked-cameras', type: 'circle', source: 'picked', filter: ['==', ['get', 'kind'], 'camera'],
        paint: { 'circle-radius': 7, 'circle-color': 'rgba(252,252,251,0.6)', 'circle-stroke-color': '#0b0b0b', 'circle-stroke-width': 2 } },
    ],
  },
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: CONFIG.credit }), 'bottom-right');
map.on('error', e => {
  if (e.sourceId === 'ee' || /pmtiles/i.test(String(e.error && e.error.message))) problem('The map could not be loaded. Please try reloading the page.');
});

// Keep what's being fitted clear of the panel: beside it on wide screens, above it on phones.
function padding() {
  const panel = document.querySelector('.panel').getBoundingClientRect();
  return window.innerWidth <= 600
    ? { top: 16, left: 16, right: 16, bottom: window.innerHeight - panel.top + 8 }
    : { top: 20, left: panel.right + 16, right: 20, bottom: 20 };
}
function fitBox(b, minZoom) {
  const camera = map.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], { padding: padding(), maxZoom: 16 });
  if (!camera) return;
  if (minZoom && camera.zoom < minZoom) camera.zoom = minZoom;
  map.easeTo(camera);
}

// Figures for the Selection in view.
function summarize() {
  const k = key();
  const label = place ? place.label : 'the states built so far';
  $('subtitle').textContent = 'For every street in ' + label + ': how many cameras on the fastest drive to the nearest ' + (NEAREST[k] || k) + '?';
  if (!place) return;
  const s = place.stats[k];
  const counts = RAMP.map(() => 0);
  let scored = 0, sum = 0;
  s.counts.forEach((c, i) => { counts[Math.min(i, RAMP.length - 1)] += c; scored += c; sum += i * c; });
  $('pct-zero').textContent = scored ? Math.round((100 * counts[0]) / scored) + '%' : '\\u2013';
  $('mean').textContent = scored ? (sum / scored).toFixed(2) : '\\u2013';
  const row = (color, label, count, share) => '<tr><td><span class="swatch" style="background:' + color + '"></span>' + label + '</td><td class="num">' +
    count.toLocaleString() + '</td><td class="num">' + share + '</td></tr>';
  $('legend').innerHTML = RAMP.map((color, b) => row(color, BIN_LABELS[b], counts[b], scored ? ((100 * counts[b]) / scored).toFixed(1) + '%' : '')).join('') +
    (s.none ? row(UNSCORED, 'No route', s.none, '') : '') +
    (s.unproven ? row(UNSCORED, 'Not proven', s.unproven, '') : '');
}

function zoomNote() {
  const z = map.getZoom();
  $('zoom-note').textContent = z < CONFIG.localZoom
    ? (z < CONFIG.areaZoom
      ? 'Zoomed out, each county is colored by the mean Exposure of its streets, drawn only where streets are. Zoom in for neighborhoods, then every street.'
      : 'Each small square is colored by the mean Exposure of the streets in and around it, under the main roads. Zoom in to see every street.')
    : z < CONFIG.streetZoom
      ? 'Each colored line is one street, colored by its own Exposure. Click one to zoom in to its trip.'
      : 'Each colored line is one street, colored by its own Exposure.';
}

function setCategory(k) {
  cat = k;
  const K = key();
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(Number(b.dataset.cat) === k)));
  writeHash();
  map.setPaintProperty('streets', 'line-color', streetColor(K));
  map.setPaintProperty('picked-street', 'line-color', streetColor(K));
  map.setPaintProperty('grid', 'fill-color', gridColor(K));
  map.setPaintProperty('grid', 'fill-opacity', gridFill(K));
  map.setFilter('grid', ['has', K + '_mean']);
  map.setFilter('destinations', ['==', ['get', 'category'], K]);
  summarize();
  if (picked) pick(picked);
  if ($('q').value.trim()) search();
}

// Selections: every state built, or one state, or one of its counties and independent cities.
function setPlace(p, fit) {
  place = p;
  summarize();
  if (fit && p.bbox) fitBox(p.bbox);
}
function statePicked(fit) {
  const i = Number($('state').value);
  const part = $('part');
  if (i < 0) {
    part.hidden = true;
    const label = selections.states.length === 1 ? selections.states[0].name : 'the ' + selections.states.length + ' states built so far';
    setPlace({ label, bbox: selections.country.bbox, stats: selections.country.stats }, fit);
    return;
  }
  const st = selections.states[i];
  part.innerHTML = '<option value="-1">All of ' + escapeHtml(st.name) + '</option>' +
    st.parts.map((p, j) => '<option value="' + j + '">' + escapeHtml(p.name) + (p.kind === 'city' ? ' (city)' : '') + '</option>').join('');
  part.hidden = !st.parts.length;
  setPlace({ label: st.name, bbox: st.bbox, stats: st.stats }, fit);
}

// Links: #gas opens the gas map; #gas/13/36.85/-76.29 also opens it at that zoom, latitude and longitude.
function writeHash() {
  const c = map.getCenter();
  const hash = '#' + key() + '/' + map.getZoom().toFixed(2) + '/' + c.lat.toFixed(5) + '/' + c.lng.toFixed(5);
  if (location.hash !== hash) history.replaceState(null, '', hash);
}
map.on('moveend', writeHash);
function partPicked() {
  const st = selections.states[Number($('state').value)];
  const j = Number($('part').value);
  if (j < 0) setPlace({ label: st.name, bbox: st.bbox, stats: st.stats }, true);
  else setPlace({ label: st.parts[j].name + ', ' + st.name, bbox: st.parts[j].bbox, stats: st.parts[j].stats }, true);
}

// One street's trip, as its tile feature carries it.
function pick(f) {
  picked = f;
  const detail = $('detail');
  const empty = { type: 'FeatureCollection', features: [] };
  if (!f) {
    detail.hidden = true;
    map.setFilter('picked-casing', ['==', ['id'], -1]);
    map.setFilter('picked-street', ['==', ['id'], -1]);
    map.getSource('picked').setData(empty);
    hint();
    return;
  }
  const p = f.properties;
  const k = key();
  map.setFilter('picked-casing', ['==', ['id'], f.id]);
  map.setFilter('picked-street', ['==', ['id'], f.id]);
  let html = '<b>' + escapeHtml(p.name || 'Unnamed street') + '</b><br><span class="dim small">' + escapeHtml(p.place || '') +
    ' &middot; <a target="_blank" href="https://www.openstreetmap.org/way/' + f.id + '">way/' + f.id + '</a></span>';
  const points = [];
  const s = p[k];
  if (s === -1) html += '<p class="dim">No drivable route from this street reached a destination. Often the street is behind a private road.</p>';
  else if (s === -2) html += '<p class="dim">This street\\'s fastest route could not be proven within the area read around it, so it is left unscored.</p>';
  else {
    points.push({ type: 'Feature', properties: { kind: 'destination' }, geometry: { type: 'Point', coordinates: [p[k + '_dlon'], p[k + '_dlat']] } });
    html += '<p><b class="big">' + s + '</b> camera' + (s === 1 ? '' : 's') + ' on the way to <b>' + escapeHtml(p[k + '_dest']) + '</b><br><span class="dim">about ' +
      Math.round(p[k + '_min']) + ' min' + (p[k + '_long'] ? '; only the first ' + CONFIG.limitKm + ' km (' + CONFIG.limitMi + ' mi) of this trip counts' : '') + '</span></p>';
    if (p[k + '_cams']) {
      html += '<ol>' + JSON.parse(p[k + '_cams']).map(([id, lon, lat, who]) => {
        points.push({ type: 'Feature', properties: { kind: 'camera' }, geometry: { type: 'Point', coordinates: [lon, lat] } });
        return '<li>' + escapeHtml(who || 'Unknown operator') + ' <a class="small" target="_blank" href="https://www.openstreetmap.org/node/' + id + '">node/' + id + '</a></li>';
      }).join('') + '</ol>';
    }
  }
  map.getSource('picked').setData({ type: 'FeatureCollection', features: points });
  detail.innerHTML = html;
  detail.hidden = false;
  // On a phone the trip sits just under the tabs; bring the sheet back to the top so it is in view.
  if (phone()) document.querySelector('.panel').scrollTop = 0;
  hint();
}

const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
function hover(e) {
  const f = e.features && e.features[0];
  if (!f) return;
  const k = key();
  const p = f.properties;
  let html;
  if (f.layer.id === 'grid') {
    html = (p[k + '_area'] !== undefined && map.getZoom() < CONFIG.areaZoomEnd ? 'County average: <b>' + Number(p[k + '_area']).toFixed(2) + '</b> cameras per trip<br>' : '') +
      'Streets in and around here: mean Exposure <b>' + Number(p[k + '_mean']).toFixed(2) + '</b><br>' +
      Math.round(100 * p[k + '_zero']) + '% pass no mapped camera &middot; ' + Number(p[k + '_n']).toLocaleString() + ' streets in this square';
  } else {
    const s = p[k];
    html = '<b>' + escapeHtml(p.name || 'Unnamed street') + '</b><br>' + (s < 0 ? (s === -1 ? 'No route found' : 'Not proven') :
      'Exposure ' + s + (p[k + '_dest'] === undefined ? ' &middot; click for the trip' :
        ' &middot; ' + escapeHtml(p[k + '_dest']) + ', ' + Math.round(p[k + '_min']) + ' min' + (p[k + '_long'] ? ' (first ' + CONFIG.limitKm + ' km counted)' : '')));
  }
  map.getCanvas().style.cursor = 'pointer';
  popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
}
// A street's line can be under a pixel wide, so the pointer takes the street nearest it on screen, within HIT pixels.
const HIT = 5;
function near(point) {
  let best = null;
  let bestD = Infinity;
  for (const f of map.queryRenderedFeatures([[point.x - HIT, point.y - HIT], [point.x + HIT, point.y + HIT]], { layers: ['streets'] })) {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const line of lines) {
      let a = map.project(line[0]);
      for (let i = 1; i < line.length; i++) {
        const b = map.project(line[i]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = dx || dy ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
        const d = Math.hypot(a.x + t * dx - point.x, a.y + t * dy - point.y);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
        a = b;
      }
    }
  }
  return best;
}
map.on('mousemove', e => {
  const f = near(e.point) || map.queryRenderedFeatures(e.point, { layers: ['grid'] })[0];
  if (f) hover({ features: [f], lngLat: e.lngLat });
  else {
    map.getCanvas().style.cursor = '';
    popup.remove();
  }
});
// Below street zoom a street's line doesn't carry its trip, so a click zooms in to it and then opens it. A click on
// the colored areas zooms in to where every street is drawn, a step at a time instead of one leap to street level.
map.on('click', e => {
  const f = near(e.point);
  $('results').hidden = true;
  if (f && map.getZoom() >= CONFIG.streetZoom) pick(f);
  else if (f || map.queryRenderedFeatures(e.point, { layers: ['grid'] }).length) {
    popup.remove();
    const z = map.getZoom();
    const to = f ? CONFIG.streetZoom + 1 : Math.min(z + 3, CONFIG.localZoom + 0.5);
    map.easeTo({ center: e.lngLat, zoom: Math.max(to, z), duration: 400 + 250 * Math.abs(to - z) });
    if (f) {
      map.once('idle', () => {
        const [g] = map.queryRenderedFeatures({ layers: ['streets'], filter: ['==', ['id'], f.id] });
        if (g) pick(g);
      });
    }
  } else pick(null);
});
map.on('zoomend', zoomNote);

// "Find your street": a name search over static index files beside the tiles. No geocoder and no outside network call.
// Each file holds the names with a word starting with its two characters, leaving out street types and directions.
const words = s => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/ +/).filter(Boolean);
const ABBR = { pkwy: 'parkway', pky: 'parkway', blvd: 'boulevard', hwy: 'highway', ln: 'lane',
  ct: 'court', trl: 'trail', xing: 'crossing', ter: 'terrace', terr: 'terrace', pl: 'place', sq: 'square' };
function tokenMatch(q, n) {
  let j = 0;
  for (const t of q) {
    const alt = ABBR[t];
    while (j < n.length && n[j].indexOf(t) !== 0 && !(alt && n[j].indexOf(alt) === 0)) j++;
    if (j >= n.length) return false;
    j++;
  }
  return true;
}
const files = new Map();
const load = name => {
  if (!files.has(name)) files.set(name, fetch('search/' + name + '.json').then(r => (r.ok ? r.json() : [])).catch(() => []));
  return files.get(name);
};
let matches = [];
let searching = 0;
async function search() {
  const q = $('q').value.trim().toLowerCase();
  const box = $('results');
  const qt = words(q);
  const first = qt.find(t => !STOP.has(t) && (t.length >= 2 || /^[0-9]$/.test(t)));
  if (!first) { matches = []; box.innerHTML = ''; box.hidden = true; return; }
  const run = ++searching;
  const [rows, places] = await Promise.all([load(first.slice(0, 2)), load('places')]);
  if (run !== searching) return;
  const starts = [], byWord = [], within = [];
  for (const row of rows) {
    const hay = row[0].toLowerCase();
    const at = hay.indexOf(q);
    if (at === 0) starts.push(row);
    else if (tokenMatch(qt, words(row[0]))) byWord.push(row);
    else if (at > 0) within.push(row);
    if (starts.length >= 12) break;
  }
  const byName = (a, b) => a[0].localeCompare(b[0]);
  matches = starts.sort(byName).concat(byWord.sort(byName), within).slice(0, 12);
  const at = 6 + 2 * cat;
  box.innerHTML = matches.length
    ? matches.map((row, n) => {
        const lo = row[at], hi = row[at + 1];
        const label = lo < 0 ? '&mdash;' : lo === hi ? String(lo) : lo + '&ndash;' + hi;
        return '<li role="option" data-n="' + n + '"><span class="nm">' + escapeHtml(row[0]) + '<span class="zn">' + escapeHtml(places[row[1]] || '') +
          '</span></span><span class="sc">' + label + '</span></li>';
      }).join('')
    : '<li class="none">No street in the states built so far matches that.</li>';
  box.hidden = false;
}
function choose(n) {
  const row = matches[n];
  if (!row) return;
  $('results').hidden = true;
  fitBox([row[2] / 1e5, row[3] / 1e5, row[4] / 1e5, row[5] / 1e5], CONFIG.streetZoom + 1);
  // Of the ways with this name in view, open the most exposed one: it is the one worth looking at.
  map.once('idle', () => {
    const k = key();
    const found = map.queryRenderedFeatures({ layers: ['streets'], filter: ['==', ['get', 'name'], row[0]] });
    if (found.length) pick(found.reduce((best, f) => (f.properties[k] > best.properties[k] ? f : best)));
  });
}

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setCategory(Number(b.dataset.cat))));
$('show-cameras').addEventListener('change', e => map.setLayoutProperty('cameras', 'visibility', e.target.checked ? 'visible' : 'none'));
$('show-destinations').addEventListener('change', e => map.setLayoutProperty('destinations', 'visibility', e.target.checked ? 'visible' : 'none'));
$('more').addEventListener('click', () => { $('about').open = true; $('about').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('state').addEventListener('change', () => statePicked(true));
$('part').addEventListener('change', partPicked);
$('q').addEventListener('input', search);
$('q').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); choose(0); }
  else if (e.key === 'Escape') { e.target.value = ''; search(); }
});
$('results').addEventListener('click', e => {
  const li = e.target.closest('li[data-n]');
  if (li) choose(Number(li.dataset.n));
});

// First-visit cards: what the map counts, how to find your street, how to pick a trip. "How it works" opens them again.
const phone = () => window.innerWidth <= 600;
const TOUR = [
  { title: 'How many cameras see your car?',
    pic: '<span>Your street</span>&rarr;<span>&#128247;</span><span>&#128247;</span>&rarr;<span>The store</span>',
    text: 'License plate cameras photograph the cars that drive past them. This map counts how many you would pass on everyday drives from your street.' },
  { title: 'Find your street', target: () => $('q'),
    pic: '<span>&#128269; Main Street</span>',
    text: 'Type your street\\'s name here. No house number needed. Or zoom in on the map and tap your street.' },
  { title: 'Pick where you\\'re going', target: () => document.querySelector('.tabs'),
    pic: CONFIG.categories.map((c, i) => '<span' + (i ? '' : ' class="on"') + '>' + escapeHtml(c.label) + '</span>').join(''),
    text: 'Choose a trip here: ' + CONFIG.categories.map(c => c.label).join(', ').replace(/, ([^,]*)$/, ' or $1') +
      '. The colors change to show how many cameras each street passes on that drive. Tap a street to see the route and every camera on it.' },
];
let tourAt = 0;
function tourShow(i) {
  tourAt = i;
  const c = TOUR[i];
  $('tour-step').textContent = (i + 1) + ' of ' + TOUR.length;
  $('tour-title').textContent = c.title;
  $('tour-pic').innerHTML = c.pic;
  $('tour-text').textContent = c.text;
  $('tour-dots').innerHTML = TOUR.map((_, j) => '<i' + (j === i ? ' class="on"' : '') + '></i>').join('');
  $('tour-next').textContent = i === TOUR.length - 1 ? 'Show me the map' : 'Next';
  $('tour-skip').hidden = i === TOUR.length - 1;
  $('tour').hidden = false;
  tourPlace();
  $('tour-next').focus();
}
// Put an anchored card beside its field: to the right when there is room (wide screens), else above it (the phone
// sheet), else below; the ring marks the field and the arrow points at its middle.
function tourPlace() {
  const c = TOUR[tourAt];
  const tour = $('tour');
  const card = tour.querySelector('.card');
  const spot = $('spot');
  card.className = 'card';
  card.style.left = card.style.top = '';
  if (!c.target) {
    tour.classList.remove('anchored');
    spot.hidden = true;
    return;
  }
  if (phone()) fold(true);
  const el = c.target();
  el.scrollIntoView({ block: 'nearest' });
  tour.classList.add('anchored');
  const r = el.getBoundingClientRect();
  const pad = 6, gap = 16, edge = 12;
  Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + 2 * pad + 'px', height: r.height + 2 * pad + 'px' });
  spot.hidden = false;
  const W = window.innerWidth, H = window.innerHeight, cw = card.offsetWidth, ch = card.offsetHeight;
  let left, top, side, ax;
  if (W - r.right - pad - gap >= cw + edge) {
    side = 'arrow-left';
    left = r.right + pad + gap;
    top = Math.max(edge, Math.min(r.top + r.height / 2 - 36, H - ch - edge));
    ax = r.top + r.height / 2 - top;
  } else {
    left = Math.max(edge, Math.min(r.left + r.width / 2 - cw / 2, W - cw - edge));
    ax = r.left + r.width / 2 - left;
    if (r.top - pad - gap - ch >= edge) { side = 'arrow-down'; top = r.top - pad - gap - ch; }
    else { side = 'arrow-up'; top = Math.min(r.bottom + pad + gap, H - ch - edge); }
  }
  ax = Math.max(18, Math.min(ax, (side === 'arrow-left' ? ch : cw) - 18));
  card.classList.add(side);
  card.style.left = left + 'px';
  card.style.top = top + 'px';
  card.style.setProperty('--ax', ax + 'px');
}
window.addEventListener('resize', () => { if (!$('tour').hidden) tourPlace(); });
function tourClose() {
  $('tour').hidden = true;
  $('tour').classList.remove('anchored');
  $('spot').hidden = true;
  try { localStorage.setItem('ee-tour-seen', '1'); } catch (e) {}
  if (!phone()) $('q').focus();
}
$('tour-next').addEventListener('click', () => (tourAt < TOUR.length - 1 ? tourShow(tourAt + 1) : tourClose()));
$('tour-skip').addEventListener('click', tourClose);
$('tour').addEventListener('keydown', e => { if (e.key === 'Escape') tourClose(); });
$('help').addEventListener('click', () => tourShow(0));
// On a phone the panel starts folded to the search and the trip tabs; "More" opens the figures and the method.
const panelEl = document.querySelector('.panel');
function fold(on) {
  panelEl.classList.toggle('folded', on);
  $('sheet-toggle').setAttribute('aria-expanded', String(!on));
  $('sheet-toggle').innerHTML = on ? 'More &#9650;' : 'Less &#9660;';
  panelEl.scrollTop = 0;
}
$('sheet-toggle').addEventListener('click', () => fold(!panelEl.classList.contains('folded')));
if (phone()) fold(true);
let seen = false;
try { seen = localStorage.getItem('ee-tour-seen') === '1'; } catch (e) {}
if (!seen) tourShow(0);

// The hint at the top of the map says what this zoom shows and what to do next.
function hint() {
  const z = map.getZoom();
  const go = $('hint-go');
  go.hidden = true;
  let text = '';
  if (z < CONFIG.localZoom) {
    text = z < CONFIG.areaZoom
      ? 'Colors show each county\\'s average. Zoom in for neighborhoods, then every street.'
      : 'Colors show the average for the streets in each area. Zoom in to see every street.';
    go.textContent = 'Zoom in';
    go.hidden = false;
  } else if (!picked) text = 'Each line is one street. Tap one to see its drive and the cameras on it.';
  $('hint-text').textContent = text;
  $('hint').hidden = !text;
}
$('hint-go').addEventListener('click', () => map.easeTo({ zoom: Math.min(map.getZoom() + 2, CONFIG.localZoom + 0.5), duration: 900 }));
map.on('zoomend', hint);

map.on('load', async () => {
  zoomNote();
  hint();
  const [hashKey, zoom, lat, lon] = decodeURIComponent(location.hash.slice(1)).split('/');
  const k = CONFIG.categories.findIndex(c => c.key === hashKey);
  const at = [Number(zoom), Number(lat), Number(lon)];
  const positioned = lon !== undefined && at.every(Number.isFinite);
  if (positioned) map.jumpTo({ zoom: at[0], center: [at[2], at[1]] });
  try {
    selections = await (await fetch('selections.json')).json();
  } catch (err) {
    problem('The list of places could not be loaded. Please try reloading the page.');
    return;
  }
  // With only one state built, skip the "All ... built so far" wrapper and go straight to it, county picker and all.
  $('state').innerHTML = selections.states.length === 1
    ? '<option value="0">' + escapeHtml(selections.states[0].name) + '</option>'
    : '<option value="-1">All ' + selections.states.length + ' states built so far (of ' + CONFIG.totalStates + ')</option>' +
      selections.states.map((s, i) => '<option value="' + i + '">' + escapeHtml(s.name) + '</option>').join('');
  statePicked(!positioned);
  setCategory(k >= 0 ? k : 0);
});
</script>
</body>
</html>
`;
}
