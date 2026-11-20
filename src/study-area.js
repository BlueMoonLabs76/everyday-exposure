// Areas bounded by OSM boundary relations: a state, whose Origins a build scores, and the counties and independent
// cities that are its Selections. Each arrives as assembled rings, outer rings with their holes.

// The parts of a boundary. A boundary holding several areas lists them as areas; a bare { outer, inner } is one.
export const areasOf = boundary => boundary.areas ?? [boundary];

// A predicate over [lon, lat], true inside any of the boundary's areas. Rings are pre-assembled and closed.
// Rings of many thousands of points are fine: each ring's edges are bucketed into bands of latitude, so a test
// only crosses the edges in its own band.
export function studyArea(boundary) {
  // A hole belongs to its own area: an enclave one area does not contain never removes another area's land.
  const outers = areasOf(boundary).flatMap(({ outer, inner }) => outer.map(ring => ({ ring: indexRing(ring), inner: inner.map(indexRing) })));
  return function inStudyArea([lon, lat]) {
    for (const o of outers) {
      if (!inIndexedRing(o.ring, lon, lat)) continue;
      if (o.inner.some(hole => inIndexedRing(hole, lon, lat))) continue;
      return true;
    }
    return false;
  };
}

// True if more of an area's outer ring points lie inside the test than outside it. Two areas sharing a border
// share the points along it, so this places a county in the state that holds the rest of it. Points on the border
// itself (onBorder) are skipped: a ray cast answers either way on an edge, and a county whose long state line
// outnumbers its inland points (Imperial, Riverside, San Bernardino in California) would be lost to that coin toss.
export function mostlyInside(inside, area, onBorder = () => false) {
  let balance = 0;
  for (const ring of area.outer) for (const p of ring) if (!onBorder(p)) balance += inside(p) ? 1 : -1;
  return balance > 0;
}

// A predicate over [lon, lat], true at a vertex of any of the boundary's rings.
export function onBoundary(boundary) {
  const vertices = new Set(areasOf(boundary).flatMap(({ outer, inner }) => [...outer, ...inner]).flat().map(([x, y]) => `${x},${y}`));
  return ([x, y]) => vertices.has(`${x},${y}`);
}

function indexRing(ring) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [x, y] of ring) {
    west = Math.min(west, x); east = Math.max(east, x);
    south = Math.min(south, y); north = Math.max(north, y);
  }
  const bands = Math.max(1, Math.min(4096, Math.ceil(ring.length / 8)));
  const height = (north - south) / bands || 1;
  const band = y => Math.min(bands - 1, Math.max(0, Math.floor((y - south) / height)));
  const lists = Array.from({ length: bands }, () => []);
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1][1];
    const b = ring[i][1];
    for (let k = band(Math.min(a, b)); k <= band(Math.max(a, b)); k++) lists[k].push(i);
  }
  return { ring, west, south, east, north, band, lists: lists.map(l => Int32Array.from(l)) };
}

function inIndexedRing(r, x, y) {
  if (x < r.west || x > r.east || y < r.south || y > r.north) return false;
  let inside = false;
  for (const i of r.lists[r.band(y)]) {
    const [xi, yi] = r.ring[i];
    const [xj, yj] = r.ring[i - 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Even-odd ray casting over one closed ring.
export function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Chains unordered relation member ways into closed rings. A boundary relation lists its member ways in no
// particular order, split at shared nodes and some reversed, so each ring must be stitched end to end.
export function assembleRings(members) {
  const segs = members.filter(m => m.geometry?.length > 1).map(m => m.geometry.map(g => [g.lon, g.lat]));
  const key = p => `${p[0]},${p[1]}`;
  const used = new Array(segs.length).fill(false);
  const rings = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let ring = segs[i].slice();
    for (let grew = true; grew && key(ring[0]) !== key(ring.at(-1)); ) {
      grew = false;
      for (let k = 0; k < segs.length; k++) {
        if (used[k]) continue;
        const s = segs[k];
        if (key(s[0]) === key(ring.at(-1))) ring = ring.concat(s.slice(1));
        else if (key(s.at(-1)) === key(ring.at(-1))) ring = ring.concat(s.slice(0, -1).reverse());
        else if (key(s.at(-1)) === key(ring[0])) ring = s.slice(0, -1).concat(ring);
        else if (key(s[0]) === key(ring[0])) ring = s.slice(1).reverse().concat(ring);
        else continue;
        used[k] = true;
        grew = true;
      }
    }
    if (key(ring[0]) !== key(ring.at(-1))) throw new Error(`boundary ring ${i} does not close`);
    rings.push(ring);
  }
  return rings;
}
