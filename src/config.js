// Settled model inputs. The terms are defined in CONTEXT.md.

// The Study Area is the 50 states and DC (ADR 0004), built one state at a time. A state is a Geofabrik region
// (ADR 0003); `npm run fetch-data -- <state>` picks one, and this is the example.
export const DEFAULT_STATE = 'virginia';

// A state is scored in pieces (ADR 0004): cells of a fixed grid of PIECE_CELL_DEG degrees, each widened by a
// buffer. Origins whose trip is not proven to stay inside their piece are recomputed with the next buffer.
// The last buffer also sets which neighbouring states' extracts are read.
export const PIECE_CELL_DEG = 0.5;
export const PIECE_BUFFERS_M = [20000, 40000, 60000];

// A destination snaps to the nearest drivable road within this distance.
export const SNAP_M = 2000;

// A destination snaps only onto a road network of at least this many nodes, so never onto an isolated
// fragment such as an unconnected parking aisle, while an island's own roads still count.
export const MIN_NETWORK_NODES = 200;

// Observation Radius: 75 ft.
export const OBSERVATION_RADIUS_M = 75 * 0.3048;

// Only the first 40 km of a trip counts toward its Exposure (ADR 0006). The route and its destination are unchanged.
export const COUNTED_TRIP_M = 40000;

// Demo speed model, mph per highway class. A parseable maxspeed tag wins.
export const SPEED_MPH = {
  motorway: 65,
  motorway_link: 45,
  trunk: 55,
  trunk_link: 40,
  primary: 45,
  primary_link: 35,
  secondary: 40,
  secondary_link: 30,
  tertiary: 35,
  tertiary_link: 30,
  unclassified: 30,
  residential: 25,
  living_street: 15,
  road: 25,
  service: 10,
};

export const HIGHWAY_CLASSES = Object.keys(SPEED_MPH);
export const DRIVABLE = new Set(HIGHWAY_CLASSES);

// An address point is never snapped onto these; you can't start or end a trip on a ramp.
export const NO_SNAP = new Set(['motorway', 'motorway_link', 'trunk_link']);

// Local Road classes.
export const LOCAL_ROAD = new Set(['residential', 'unclassified', 'living_street']);

// Road classes that give Origins: every surface street people live along, Local Roads and the arterials
// and collectors many houses also face. Each such way inside the Study Area contributes one.
export const ORIGIN_ROAD = new Set([...LOCAL_ROAD, 'tertiary', 'secondary', 'primary']);

// Geofabrik's list of extract regions with their polygons: a region's download URL, and which states lie near it.
export const GEOFABRIK_INDEX = 'https://download.geofabrik.de/index-v1.json';

// Grocery is these chains only (user, 2026-09-15), matched on brand or name. A store, not the chain's fuel center:
// those carry the same brand but no shop tag. "Brookshire's" leaves out Brookshire Brothers, a different company.
// Widened 2026-11-19 (user) with the big Virginia/Mid-Atlantic chains, which the original list missed:
// Food Lion through Publix and Wegmans, plus IGA, Save-A-Lot and Weis for rural areas. Martin's is Giant's sister
// brand. Dollar stores are left out on purpose: they get many quick trips but a small share of food spending.
const GROCERY_CHAIN = /\b(kroger|wal-?mart|harp['’]?s|aldi|brookshire['’]s|piggly wiggly|super (1|one) foods|food lion|giant( food)?|martin['’]?s|harris teeter|lidl|safeway|food city|publix|wegmans|weis|iga|save[- ]?a[- ]?lot)\b/i;
const brandOrName = tags => `${tags.brand ?? ''} ${tags.name ?? ''}`;
// The brand, or a name that starts with it: "Colonial Pancake & Waffle House" is not one.
const isWaffleHouse = tags => [tags.brand, tags.name].some(s => /^waffle house\b/i.test(s ?? ''));

// Destination Category tag rules.
export const DESTINATION_TAGS = {
  grocery: tags => /^(supermarket|grocery|department_store)$/.test(tags.shop ?? '') && GROCERY_CHAIN.test(brandOrName(tags)),
  gas: tags => tags.amenity === 'fuel',
  hospital: tags => tags.amenity === 'hospital' || tags.healthcare === 'hospital',
  waffle_house: tags => /^(restaurant|fast_food)$/.test(tags.amenity ?? '') && isWaffleHouse(tags),
};

export const isCamera = tags => tags.man_made === 'surveillance' && tags['surveillance:type'] === 'ALPR';

// The project's public name and the line under it on every page.
export const PROJECT_NAME = 'Everyday Exposure';
export const TAGLINE = 'How often taxpayer-funded license plate readers record our daily drives';

export const USER_AGENT = 'everyday-exposure/0.1 (local demonstration model)';
