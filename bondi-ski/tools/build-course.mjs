// Turns the reference data in data/ into the course the game loads:
//
//   public/course/<name>.json  path, checkpoints, buildings, trees and props, in local metres
//   public/course/<name>.bin   terrain heights (Int16, decimetres) then surface classes (Uint8)
//
// Run with `pnpm build-course` after `pnpm fetch-data` or after changing COURSE below.
// Both outputs are committed.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { AREA, ORIGIN, TERRAIN_ZOOM, project, tileXY, unproject } from "./area.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The test segment: Bondi Icebergs round Mackenzies Point to Tamarama Beach. */
const COURSE = {
  name: "icebergs-tamarama",
  title: "Icebergs to Tamarama",
  start: { lat: -33.89575, lon: 151.27468 },
  finish: { lat: -33.90005, lon: 151.27128 },
  checkpoints: [
    { name: "Bondi Icebergs", lat: -33.89575, lon: 151.27468 },
    { name: "Marks Park", lat: -33.89795, lon: 151.27525 },
    { name: "Mackenzies Point", lat: -33.8989, lon: 151.27618 },
    { name: "Mackenzies Bay", lat: -33.89945, lon: 151.27335 },
    { name: "Tamarama Beach", lat: -33.90005, lon: 151.27128 },
  ],
};

/** Terrain grid spacing (m). The source DEM is ~4 m per pixel here; we resample it smoothly. */
const CELL = 3;

/** Surface classes, painted per terrain cell. Keep in sync with src/course/data.ts. */
const S = { urban: 0, grass: 1, sand: 2, rock: 3, sea: 4, road: 5, path: 6, scrub: 7 };

const osm = JSON.parse(readFileSync(join(root, "data", "osm.json"), "utf8"));

// ---------------------------------------------------------------- elevation

// All the tiles as one mosaic, so pixels can be read (and cleaned) across tile edges.
const tileFiles = readdirSync(join(root, "data", "terrarium"))
  .map((f) => f.replace(".png", "").split("-").map(Number))
  .filter(([z]) => z === TERRAIN_ZOOM);
const tx0 = Math.min(...tileFiles.map(([, x]) => x));
const ty0 = Math.min(...tileFiles.map(([, , y]) => y));
const mw = (Math.max(...tileFiles.map(([, x]) => x)) - tx0 + 1) * 256;
const mh = (Math.max(...tileFiles.map(([, , y]) => y)) - ty0 + 1) * 256;
const mosaic = new Float32Array(mw * mh).fill(NaN);
for (const [z, x, y] of tileFiles) {
  const png = PNG.sync.read(readFileSync(join(root, "data", "terrarium", `${z}-${x}-${y}.png`)));
  for (let py = 0; py < 256; py++) {
    for (let px = 0; px < 256; px++) {
      const i = (py * 256 + px) * 4;
      mosaic[((y - ty0) * 256 + py) * mw + (x - tx0) * 256 + px] = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
    }
  }
}

// The DEM has a few bad pixels: pits hundreds of metres deep (and the odd spike), which
// smooth interpolation turns into craters and towers. Replace any pixel far from the
// median of its neighbours with that median, a few times over for clustered ones.
{
  let fixed = 0;
  for (let pass = 0; pass < 4; pass++) {
    const src = Float32Array.from(mosaic);
    for (let y = 1; y < mh - 1; y++) {
      for (let x = 1; x < mw - 1; x++) {
        const n = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) n.push(src[(y + dy) * mw + x + dx]);
        n.sort((a, b) => a - b);
        const median = (n[3] + n[4]) / 2;
        const v = src[y * mw + x];
        // Real cliffs here drop ~30 m over several pixels, never 15 m against all eight neighbours' middle.
        if (Math.abs(v - median) > 15 || v < -60) {
          mosaic[y * mw + x] = median;
          fixed++;
        }
      }
    }
  }
  console.log(`DEM: replaced ${fixed} bad pixels`);
}

function demPixel(px, py) {
  const v = mosaic[(py - ty0 * 256) * mw + (px - tx0 * 256)];
  if (v === undefined || Number.isNaN(v)) throw new Error(`No terrain at pixel ${px},${py}; run pnpm fetch-data`);
  return v;
}

/** Catmull-Rom weights for the four samples around a fraction t. */
function cubic(t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
}

/** Bicubic elevation (m above sea level) at a lat/lon: smooth, so no 4 m facets. Pixel values are at pixel centres. */
function elevation(lat, lon) {
  const [fx, fy] = tileXY(lat, lon);
  const x = fx * 256 - 0.5;
  const y = fy * 256 - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const wx = cubic(x - x0);
  const wy = cubic(y - y0);
  let h = 0;
  for (let j = 0; j < 4; j++) {
    let row = 0;
    for (let i = 0; i < 4; i++) row += demPixel(x0 - 1 + i, y0 - 1 + j) * wx[i];
    h += row * wy[j];
  }
  return h;
}

// ---------------------------------------------------------------- grid

const [minX, minZ] = project(AREA.north, AREA.west);
const [maxX, maxZ] = project(AREA.south, AREA.east);
const x0 = Math.ceil(minX / CELL) * CELL;
const z0 = Math.ceil(minZ / CELL) * CELL;
const cols = Math.floor((maxX - x0) / CELL) + 1;
const rows = Math.floor((maxZ - z0) / CELL) + 1;
const heights = new Float32Array(cols * rows);
const surface = new Uint8Array(cols * rows).fill(S.urban);
const cellX = (c) => x0 + c * CELL;
const cellZ = (r) => z0 + r * CELL;

for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const [lat, lon] = unproject(cellX(c), cellZ(r));
    heights[r * cols + c] = elevation(lat, lon);
  }
}

// ---------------------------------------------------------------- geometry helpers

const rand = (n) => ((Math.sin(n * 12.9898 + 4.1) * 43758.5453) % 1 + 1) % 1;

const P = (geom) => geom.map(([lat, lon]) => project(lat, lon));

function bounds(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of pts) {
    a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z);
  }
  return { minX: a, minZ: b, maxX: c, maxZ: d };
}

function insidePolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Call fn(index) for every grid cell whose centre is inside the polygon. */
function forCellsInPolygon(poly, fn) {
  const b = bounds(poly);
  const c0 = Math.max(0, Math.ceil((b.minX - x0) / CELL));
  const c1 = Math.min(cols - 1, Math.floor((b.maxX - x0) / CELL));
  const r0 = Math.max(0, Math.ceil((b.minZ - z0) / CELL));
  const r1 = Math.min(rows - 1, Math.floor((b.maxZ - z0) / CELL));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (insidePolygon(cellX(c), cellZ(r), poly)) fn(r * cols + c);
}

/** Call fn(index, distance) for every cell within `radius` of the polyline. */
function forCellsNearLine(line, radius, fn) {
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - radius - x0) / CELL));
    const c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + radius - x0) / CELL));
    const r0 = Math.max(0, Math.floor((Math.min(az, bz) - radius - z0) / CELL));
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(az, bz) + radius - z0) / CELL));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = segmentDistance(cellX(c), cellZ(r), ax, az, bx, bz);
        if (d <= radius) fn(r * cols + c, d);
      }
    }
  }
}

const closed = (g) => g.length > 3 && g[0][0] === g.at(-1)[0] && g[0][1] === g.at(-1)[1];
const ways = osm.elements.filter((e) => e.type === "way" && e.geometry.length > 1);
/** Outer rings of closed ways and multipolygon relations matching a predicate. */
function areas(pred) {
  const out = [];
  for (const e of osm.elements) {
    if (!pred(e.tags)) continue;
    if (e.type === "way" && closed(e.geometry)) out.push(P(e.geometry));
    if (e.type === "relation") for (const m of e.members) if (m.role === "outer" && closed(m.geometry)) out.push(P(m.geometry));
  }
  return out;
}

// ---------------------------------------------------------------- the sea

// Coastline ways run with the land on their left. For each cell, the nearest coastline
// segment says which side it's on; the sea floor then shelves away from the shore.
const coast = ways.filter((w) => w.tags.natural === "coastline").map((w) => P(w.geometry));
const seaDistance = new Float32Array(cols * rows);
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const px = cellX(c), pz = cellZ(r);
    let best = Infinity, bestPerp = 0, side = 1;
    for (const line of coast) {
      for (let i = 0; i + 1 < line.length; i++) {
        const [ax, az] = line[i];
        const [bx, bz] = line[i + 1];
        const d = segmentDistance(px, pz, ax, az, bx, bz);
        // Left of a→b in x-right, z-down (north-up map) coordinates is a negative cross product.
        const cross = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
        const perp = Math.abs(cross) / Math.hypot(bx - ax, bz - az);
        // Where the nearest point is a shared vertex, both segments are equally near; the one
        // whose line is further away gives the right side.
        if (d < best - 1e-6 || (d < best + 1e-6 && perp > bestPerp)) {
          best = d;
          bestPerp = perp;
          side = cross < 0 ? 1 : -1;
        }
      }
    }
    const i = r * cols + c;
    seaDistance[i] = side < 0 ? best : -best;
  }
}
// Tidy the waterline: a lone land cell among sea (or sea among land), where the coastline
// zigzags across the grid, would stand up as a cliff-high pillar (or a pit). Go with the
// neighbours.
{
  const isSea = (i) => seaDistance[i] > 0;
  for (let pass = 0; pass < 2; pass++) {
    const flip = [];
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const i = r * cols + c;
        let sea = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && isSea(i + dr * cols + dc)) sea++;
        if (isSea(i) ? sea <= 2 : sea >= 6) flip.push(i);
      }
    }
    for (const i of flip) seaDistance[i] = isSea(i) ? -0.01 : 0.01;
  }
  for (let i = 0; i < cols * rows; i++) {
    if (isSea(i)) {
      surface[i] = S.sea;
      // Offshore the DEM is noisy (holes and spikes), so shelve smoothly from the coast.
      heights[i] = -0.6 - Math.min(seaDistance[i] * 0.12, 11);
    } else if (seaDistance[i] > -3 && heights[i] < 0.6) {
      heights[i] = 0.6;
    }
  }
}

// ---------------------------------------------------------------- surfaces

const paint = (cls, pred) => {
  for (const poly of areas(pred)) forCellsInPolygon(poly, (i) => {
    if (surface[i] !== S.sea) surface[i] = cls;
  });
};
paint(S.grass, (t) => ["park", "garden", "pitch", "playground"].includes(t.leisure) || t.landuse === "grass");
paint(S.scrub, (t) => ["wood", "scrub"].includes(t.natural));
paint(S.sand, (t) => t.natural === "beach" || t.natural === "sand");
// Rock shelves: where OSM maps bare rock out past the coastline, a flat sandstone
// platform just above the water, like the tidal shelves under Icebergs and Mackenzies Point.
for (const poly of areas((t) => t.natural === "bare_rock")) {
  forCellsInPolygon(poly, (i) => {
    if (surface[i] === S.sea) heights[i] = 0.5 + rand(i) * 0.3;
    surface[i] = S.rock;
  });
}
for (const w of ways.filter((w) => w.tags.natural === "cliff")) {
  forCellsNearLine(P(w.geometry), 5, (i) => {
    if (surface[i] !== S.sea) surface[i] = S.rock;
  });
}
// Steep ground reads as sandstone whatever it's tagged as.
for (let r = 1; r < rows - 1; r++) {
  for (let c = 1; c < cols - 1; c++) {
    const i = r * cols + c;
    if (surface[i] === S.sea || surface[i] === S.sand) continue;
    const gx = (heights[i + 1] - heights[i - 1]) / (2 * CELL);
    const gz = (heights[i + cols] - heights[i - cols]) / (2 * CELL);
    if (Math.hypot(gx, gz) > 0.9) surface[i] = S.rock;
  }
}
const ROAD_WIDTH = { primary: 12, primary_link: 8, secondary: 10, tertiary: 9, residential: 7, unclassified: 7, living_street: 5, service: 4 };
for (const w of ways) {
  const width = ROAD_WIDTH[w.tags.highway];
  if (width) forCellsNearLine(P(w.geometry), width / 2, (i) => {
    if (surface[i] !== S.sea) surface[i] = S.road;
  });
}

// ---------------------------------------------------------------- the walk

// Route along the footpath network from start to finish, preferring the named coastal walk.
const FOOT = new Set(["footway", "path", "steps", "pedestrian", "cycleway", "living_street"]);
const graph = new Map();
const key = ([lat, lon]) => `${lat},${lon}`;
for (const w of ways) {
  if (!FOOT.has(w.tags.highway)) continue;
  const preferred = /coastal walk/i.test(w.tags.name ?? "");
  for (let i = 0; i + 1 < w.geometry.length; i++) {
    const a = w.geometry[i], b = w.geometry[i + 1];
    const [ax, az] = project(...a), [bx, bz] = project(...b);
    const cost = Math.hypot(bx - ax, bz - az) * (preferred ? 1 : 1.8);
    for (const [p, q] of [[a, b], [b, a]]) {
      if (!graph.has(key(p))) graph.set(key(p), { at: p, edges: [] });
      graph.get(key(p)).edges.push({ to: key(q), cost });
    }
  }
}
function nearestNode(lat, lon) {
  const [x, z] = project(lat, lon);
  let best = null, bestD = Infinity;
  for (const [k, n] of graph) {
    const [nx, nz] = project(...n.at);
    const d = Math.hypot(nx - x, nz - z);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}
function route(from, to) {
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const open = new Set([from]);
  while (open.size) {
    let cur = null, cd = Infinity;
    for (const k of open) if (dist.get(k) < cd) { cd = dist.get(k); cur = k; }
    open.delete(cur);
    if (cur === to) break;
    for (const e of graph.get(cur).edges) {
      const nd = cd + e.cost;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, cur);
        open.add(e.to);
      }
    }
  }
  if (!prev.has(to)) throw new Error("No footpath route between start and finish");
  const out = [to];
  while (out[0] !== from) out.unshift(prev.get(out[0]));
  return out.map((k) => graph.get(k).at);
}
const walkLatLon = route(nearestNode(COURSE.start.lat, COURSE.start.lon), nearestNode(COURSE.finish.lat, COURSE.finish.lon));

// Resample to 2 m and put it on the ground.
const walk2d = walkLatLon.map(([lat, lon]) => project(lat, lon));
const path = [];
for (let i = 0; i + 1 < walk2d.length; i++) {
  const [ax, az] = walk2d[i], [bx, bz] = walk2d[i + 1];
  const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 2));
  for (let k = 0; k < n; k++) path.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
}
path.push(walk2d.at(-1));
// Heights along the walk, smoothed: the DEM is noisy at this scale and the walk is built.
const rawY = path.map(([x, z]) => Math.max(elevation(...unproject(x, z)), 0.8));
const pathY = rawY.map((_, i) => {
  let sum = 0;
  let n = 0;
  for (let j = Math.max(0, i - 4); j <= Math.min(rawY.length - 1, i + 4); j++) {
    sum += rawY[j];
    n++;
  }
  return sum / n;
});
// Smooth the ground within a few tens of metres of the walk (blurred towards the walk,
// fading out further away), so skiing near it flows rather than rattling over the DEM's
// bumps. Cliffs further out keep their shape.
{
  const NEAR = 14;
  const FAR = 40;
  const near = new Float32Array(cols * rows).fill(Infinity);
  forCellsNearLine(path, FAR, (k, d) => {
    if (d < near[k]) near[k] = d;
  });
  let blurred = Float32Array.from(heights);
  const R = 3; // cells: a box blur of ±9 m, three passes ≈ Gaussian
  for (let pass = 0; pass < 3; pass++) {
    const tmp = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let n = 0;
        for (let d = -R; d <= R; d++) {
          const cc = Math.min(Math.max(c + d, 0), cols - 1);
          sum += blurred[r * cols + cc];
          n++;
        }
        tmp[r * cols + c] = sum / n;
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let n = 0;
        for (let d = -R; d <= R; d++) {
          const rr = Math.min(Math.max(r + d, 0), rows - 1);
          sum += tmp[rr * cols + c];
          n++;
        }
        blurred[r * cols + c] = sum / n;
      }
    }
  }
  for (let k = 0; k < cols * rows; k++) {
    if (near[k] === Infinity || surface[k] === S.sea) continue;
    const w = near[k] <= NEAR ? 1 : 1 - (near[k] - NEAR) / (FAR - NEAR);
    // Never lift the ground out of the sea or sink it under: blur only land towards land.
    heights[k] = heights[k] + (Math.max(blurred[k], 0.6) - heights[k]) * w * w * (3 - 2 * w) * 0.85;
  }
}

// Carve the walk into the terrain: flat across (it's a path, not a slope), blending
// back into the ground a few metres either side. At 4 m the DEM smears the cliff edge
// over the walk, which otherwise tips you into the sea.
{
  const FLAT = 3;
  const BLEND = 9;
  const weight = new Float32Array(cols * rows);
  const target = new Float32Array(cols * rows);
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    forCellsNearLine([path[i], path[i + 1]], BLEND, (k, d) => {
      const w = d <= FLAT ? 1 : 1 - (d - FLAT) / (BLEND - FLAT);
      if (w <= weight[k]) return;
      // Height where this cell projects onto the segment.
      const px = x0 + (k % cols) * CELL, pz = z0 + Math.floor(k / cols) * CELL;
      const len2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / len2));
      weight[k] = w;
      target[k] = pathY[i] + (pathY[i + 1] - pathY[i]) * t;
    });
  }
  for (let k = 0; k < cols * rows; k++) {
    if (weight[k] <= 0) continue;
    const w = weight[k] * weight[k] * (3 - 2 * weight[k]);
    heights[k] = heights[k] + (target[k] - heights[k]) * w;
    if (surface[k] === S.sea && heights[k] > 0.5) surface[k] = S.rock;
  }
}
// Paint the walk (and every other footpath) onto the terrain.
for (const w of ways) {
  if (FOOT.has(w.tags.highway)) forCellsNearLine(P(w.geometry), 1.6, (i) => {
    if (surface[i] !== S.sea) surface[i] = S.path;
  });
}

// Coastal heath: the scrubby banksia and grasses between the suburbs and the cliffs.
{
  const coastNear = new Float32Array(cols * rows).fill(Infinity);
  for (const line of coast) forCellsNearLine(line, 45, (k, d) => {
    if (d < coastNear[k]) coastNear[k] = d;
  });
  for (let k = 0; k < cols * rows; k++) {
    if (surface[k] !== S.urban || coastNear[k] === Infinity) continue;
    if (coastNear[k] < 30 || rand(k * 1.7) < (45 - coastNear[k]) / 15) surface[k] = S.scrub;
  }
}

let length = 0;
const along = [0];
for (let i = 1; i < path.length; i++) {
  length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  along.push(length);
}
const checkpoints = COURSE.checkpoints.map((cp) => {
  const [x, z] = project(cp.lat, cp.lon);
  let best = 0, bestD = Infinity;
  path.forEach(([px, pz], i) => {
    const d = Math.hypot(px - x, pz - z);
    if (d < bestD) { bestD = d; best = i; }
  });
  return { name: cp.name, index: best, distance: Math.round(along[best] * 10) / 10 };
});

// ---------------------------------------------------------------- buildings, trees, props

const hash = (n) => ((Math.sin(n * 12.9898) * 43758.5453) % 1 + 1) % 1;
const buildings = [];
for (const w of ways) {
  const kind = w.tags.building;
  if (!kind || !closed(w.geometry)) continue;
  const foot = P(w.geometry).slice(0, -1);
  const levels = Number(w.tags["building:levels"]) || (kind === "house" ? 2 : kind === "roof" ? 1 : 2 + Math.floor(hash(w.id) * 3));
  const height = Number.parseFloat(w.tags.height) || (kind === "roof" ? 3 : levels * 3.1 + 0.6);
  const base = Math.min(...foot.map(([x, z]) => elevation(...unproject(x, z))));
  buildings.push({
    footprint: foot.map(([x, z]) => [round1(x), round1(z)]),
    base: round1(Math.max(base, 0) - 0.5),
    height: round1(height + 0.5),
    kind: w.tags.amenity === "toilets" || kind === "toilets" ? "amenity" : kind === "roof" ? "roof" : w.tags.name?.includes("Icebergs") ? "icebergs" : "building",
  });
}
const nodes = osm.elements.filter((e) => e.type === "node");
const at = (e) => {
  const [x, z] = project(...e.geometry[0]);
  return [round1(x), round1(elevation(...e.geometry[0])), round1(z)];
};
const trees = nodes.filter((e) => e.tags.natural === "tree").map(at);
const benches = nodes.filter((e) => e.tags.amenity === "bench").map(at);
const sculptures = nodes.filter((e) => e.tags.tourism === "artwork").map(at);
const pools = areas((t) => t.leisure === "swimming_pool").map((poly) => poly.map(([x, z]) => [round1(x), round1(z)]));

// ---------------------------------------------------------------- write

function round1(n) {
  return Math.round(n * 10) / 10;
}
const out = join(root, "public", "course");
mkdirSync(out, { recursive: true });
const bin = Buffer.alloc(cols * rows * 3);
for (let i = 0; i < cols * rows; i++) bin.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(heights[i] * 10))), i * 2);
Buffer.from(surface.buffer).copy(bin, cols * rows * 2);
writeFileSync(join(out, `${COURSE.name}.bin`), bin);
writeFileSync(
  join(out, `${COURSE.name}.json`),
  JSON.stringify({
    name: COURSE.name,
    title: COURSE.title,
    attribution: [
      "Map data © OpenStreetMap contributors (ODbL 1.0)",
      "Terrain data © Commonwealth of Australia (Geoscience Australia) 2017, via AWS Terrain Tiles (Tilezen)",
    ],
    origin: ORIGIN,
    osmTimestamp: osm.timestamp,
    terrain: { x0, z0, cell: CELL, cols, rows, file: `${COURSE.name}.bin` },
    path: path.map(([x, z], i) => [round1(x), round1(pathY[i]), round1(z)]),
    length: Math.round(length),
    checkpoints,
    buildings,
    trees,
    benches,
    sculptures,
    pools,
  }),
);
console.log(
  `${COURSE.name}: terrain ${cols}×${rows} @ ${CELL} m, walk ${Math.round(length)} m (${path.length} points), ` +
    `${buildings.length} buildings, ${trees.length} trees; checkpoints ${checkpoints.map((c) => `${c.name} @${c.distance} m`).join(", ")}`,
);
