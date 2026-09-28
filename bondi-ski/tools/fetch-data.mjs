// Downloads the reference data for the course area into data/:
//
//   data/osm.json         OpenStreetMap features (paths, coastline, cliffs, parks, buildings...)
//                         from the Overpass API, trimmed to type, id, tags and geometry.
//   data/terrarium/*.png  AWS Terrain Tiles (Terrarium encoding) covering the area.
//
// Run with `pnpm fetch-data` (needs network). The results are committed, so only
// people changing the area need to run it. See data/SOURCES.md for licences.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AREA, TERRAIN_ZOOM, tileRange } from "./area.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const USER_AGENT = "slop-games-bondi-ski/0.1 (hobby browser game; github.com/mcoot/slop-games-js)";

async function fetchOsm() {
  const { south, west, north, east } = AREA;
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:120];
(
  way["highway"](${bbox});
  way["natural"](${bbox});
  way["leisure"](${bbox});
  way["landuse"](${bbox});
  way["building"](${bbox});
  way["amenity"](${bbox});
  way["man_made"](${bbox});
  way["barrier"](${bbox});
  relation["natural"](${bbox});
  relation["leisure"](${bbox});
  node["natural"](${bbox});
  node["tourism"](${bbox});
  node["amenity"](${bbox});
);
out geom;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`Overpass: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const round = (n) => Math.round(n * 1e7) / 1e7;
  const pts = (geom) => geom.map((g) => [round(g.lat), round(g.lon)]);
  const elements = json.elements.map((e) => {
    const out = { type: e.type, id: e.id, tags: e.tags ?? {} };
    if (e.type === "node") out.geometry = [[round(e.lat), round(e.lon)]];
    else if (e.type === "way") out.geometry = pts(e.geometry ?? []);
    else if (e.type === "relation") {
      out.members = (e.members ?? [])
        .filter((m) => m.type === "way" && m.geometry)
        .map((m) => ({ role: m.role, geometry: pts(m.geometry) }));
    }
    return out;
  });
  const file = join(dataDir, "osm.json");
  writeFileSync(
    file,
    JSON.stringify({ attribution: "© OpenStreetMap contributors, ODbL 1.0", timestamp: json.osm3s?.timestamp_osm_base, area: AREA, elements }),
  );
  console.log(`osm.json: ${elements.length} elements`);
}

async function fetchTerrain() {
  const dir = join(dataDir, "terrarium");
  mkdirSync(dir, { recursive: true });
  const { x0, x1, y0, y1 } = tileRange();
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const file = join(dir, `${TERRAIN_ZOOM}-${x}-${y}.png`);
      if (existsSync(file)) continue;
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TERRAIN_ZOOM}/${x}/${y}.png`;
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      console.log(`terrarium ${x}/${y}`);
    }
  }
}

mkdirSync(dataDir, { recursive: true });
await fetchOsm();
await fetchTerrain();
