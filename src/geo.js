const EARTH_RADIUS_M = 6371008.8;
const rad = deg => (deg * Math.PI) / 180;

// Metres per degree of latitude, and of longitude at the equator, in projector()'s projection.
export const M_PER_DEG = rad(EARTH_RADIUS_M);

export function haversineM([lon1, lat1], [lon2, lat2]) {
  return haversine(lon1, lat1, lon2, lat2);
}

export function haversine(lon1, lat1, lon2, lat2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Equirectangular projection to metres around a reference latitude; well under 1% error across a city.
// Measure from a point with projector(that point's latitude), so a distance never depends on what else is loaded.
export function projector(refLat) {
  const k = Math.cos(rad(refLat));
  return ([lon, lat]) => [EARTH_RADIUS_M * rad(lon) * k, EARTH_RADIUS_M * rad(lat)];
}

// Degrees of longitude that cover at least `metres` in projector()'s projection anywhere between two latitudes.
export function lonSpan(metres, lat1, lat2) {
  const widest = Math.min(89.9, Math.max(Math.abs(lat1), Math.abs(lat2)));
  return metres / (M_PER_DEG * Math.cos(rad(widest)));
}

// A reference latitude for projector(): the middle of the latitudes given, or 0 if there are none.
export function midLat(lats) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const y of lats) {
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  return lo <= hi ? (lo + hi) / 2 : 0;
}

// Distance from p to segment ab (projected metres), and the clamped position t of the foot along ab.
export function pointToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return { distance: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t };
}

// A rectangle { west, south, east, north } in degrees, grown by metres on every side.
export function grow(rect, metres) {
  const dLat = metres / M_PER_DEG;
  const dLon = lonSpan(metres, rect.south - dLat, rect.north + dLat);
  return { west: rect.west - dLon, south: rect.south - dLat, east: rect.east + dLon, north: rect.north + dLat };
}

export const inRect = (r, lon, lat) => lon >= r.west && lon <= r.east && lat >= r.south && lat <= r.north;

export const rectsMeet = (a, b) => a.west <= b.east && b.west <= a.east && a.south <= b.north && b.south <= a.north;

// A lower bound on the distance in metres from a point inside a rectangle to the rectangle's edge.
export function depthInRect(r, lon, lat) {
  const ns = Math.min(lat - r.south, r.north - lat) * M_PER_DEG;
  const ew = Math.min(lon - r.west, r.east - lon) * M_PER_DEG * Math.cos(rad(Math.min(89.9, Math.max(Math.abs(r.south), Math.abs(r.north)))));
  return Math.min(ns, ew);
}
