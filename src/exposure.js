// Exposure: the distinct ALPR Cameras whose Observation Radius the route passes through.
// Camera bearing is deliberately ignored.
import { COUNTED_TRIP_M, OBSERVATION_RADIUS_M } from './config.js';
import { M_PER_DEG, haversine, lonSpan, pointToSegment, projector } from './geo.js';

// The part of a route that counts toward Exposure: its segments, in driving order, up to maxM along the way.
// The segment crossing maxM is cut there, so a camera beside the rest of it is not counted.
export function countedPart(segments, maxM = COUNTED_TRIP_M) {
  const counted = [];
  let rest = maxM;
  for (const s of segments) {
    if (rest <= 0) break;
    if (s.lengthM <= rest) {
      counted.push(s);
      rest -= s.lengthM;
      continue;
    }
    const lengths = [];
    for (let k = 1; k < s.coords.length; k++) lengths.push(haversine(...s.coords[k - 1], ...s.coords[k]));
    let want = lengths.reduce((a, b) => a + b, 0) * (rest / s.lengthM);
    const coords = [s.coords[0]];
    for (let k = 1; k < s.coords.length; k++) {
      const len = lengths[k - 1];
      if (want >= len) {
        coords.push(s.coords[k]);
        want -= len;
        continue;
      }
      const t = len > 0 ? want / len : 0;
      const [[ax, ay], [bx, by]] = [s.coords[k - 1], s.coords[k]];
      coords.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      break;
    }
    counted.push({ ...s, lengthM: rest, timeS: s.timeS * (rest / s.lengthM), coords });
    rest = 0;
  }
  return counted;
}

const CELL_DEG = 0.001;
const cellKey = (cx, cy) => (cx + 200000) * 400000 + (cy + 100000);

// Cameras bucketed on a grid of degrees, so scoring many routes only tests cameras near each piece of path.
// Each distance is measured in a projection centred on the camera, so it is the same whichever cameras are loaded.
export function cameraIndex(cameras, radiusM = OBSERVATION_RADIUS_M) {
  const cells = new Map();
  cameras.forEach((c, i) => {
    const key = cellKey(Math.floor(c.lon / CELL_DEG), Math.floor(c.lat / CELL_DEG));
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  });
  const dLat = radiusM / M_PER_DEG;

  // Returns [{ camera, distanceM }] in the order the route passes them.
  function observe(segments) {
    const best = new Map();
    let order = 0;
    for (const s of segments) {
      for (let k = 1; k < s.coords.length; k++, order++) {
        const a = s.coords[k - 1];
        const b = s.coords[k];
        const south = Math.min(a[1], b[1]) - dLat;
        const north = Math.max(a[1], b[1]) + dLat;
        const dLon = lonSpan(radiusM, south, north);
        const west = Math.min(a[0], b[0]) - dLon;
        const east = Math.max(a[0], b[0]) + dLon;
        for (let cx = Math.floor(west / CELL_DEG); cx <= Math.floor(east / CELL_DEG); cx++) {
          for (let cy = Math.floor(south / CELL_DEG); cy <= Math.floor(north / CELL_DEG); cy++) {
            for (const i of cells.get(cellKey(cx, cy)) ?? []) {
              const c = cameras[i];
              const project = projector(c.lat);
              const { distance } = pointToSegment(project([c.lon, c.lat]), project(a), project(b));
              if (distance <= radiusM && distance < (best.get(i)?.distanceM ?? Infinity)) {
                best.set(i, { distanceM: distance, order: best.get(i)?.order ?? order });
              }
            }
          }
        }
      }
    }
    return [...best]
      .sort((x, y) => x[1].order - y[1].order || cameras[x[0]].id - cameras[y[0]].id)
      .map(([i, { distanceM }]) => ({ camera: cameras[i], distanceM }));
  }

  return { observe };
}

export function observations(segments, cameras, radiusM = OBSERVATION_RADIUS_M) {
  return cameraIndex(cameras, radiusM).observe(segments);
}
