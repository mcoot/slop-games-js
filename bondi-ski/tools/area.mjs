// The patch of coast the course is built from, and the local coordinate frame.
//
// Game units are metres, Y up. The origin is ORIGIN (sea level there), +X is east and
// -Z is north, so a map drawn on the ground reads the usual way from above.

export const AREA = { south: -33.9025, west: 151.2685, north: -33.8845, east: 151.284 };
export const ORIGIN = { lat: -33.8972, lon: 151.2728 };
export const TERRAIN_ZOOM = 15;

const EARTH_RADIUS = 6378137;
const DEG = Math.PI / 180;

/** Latitude/longitude to local metres (equirectangular about ORIGIN: well under 1 mm error over a km). */
export function project(lat, lon) {
  const x = (lon - ORIGIN.lon) * DEG * EARTH_RADIUS * Math.cos(ORIGIN.lat * DEG);
  const z = -(lat - ORIGIN.lat) * DEG * EARTH_RADIUS;
  return [x, z];
}

export function unproject(x, z) {
  const lat = ORIGIN.lat - z / (DEG * EARTH_RADIUS);
  const lon = ORIGIN.lon + x / (DEG * EARTH_RADIUS * Math.cos(ORIGIN.lat * DEG));
  return [lat, lon];
}

/** Web Mercator tile coordinates (fractional) for a point. */
export function tileXY(lat, lon, zoom = TERRAIN_ZOOM) {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(lat * DEG) + 1 / Math.cos(lat * DEG)) / Math.PI) / 2) * n;
  return [x, y];
}

export function tileRange(zoom = TERRAIN_ZOOM) {
  const [xa, ya] = tileXY(AREA.north, AREA.west, zoom);
  const [xb, yb] = tileXY(AREA.south, AREA.east, zoom);
  return { x0: Math.floor(xa), x1: Math.floor(xb), y0: Math.floor(ya), y1: Math.floor(yb) };
}
