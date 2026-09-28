# Data sources and licences

Everything the course is built from, how it was fetched, and what each licence asks
of us. `pnpm fetch-data` downloads it; `pnpm build-course` turns it into
`public/course/`.

| Data | Source | Licence | What we must do |
| --- | --- | --- | --- |
| Paths, coastline, cliffs, rock, beaches, parks, roads, buildings, trees, benches, sculptures (`osm.json`) | [OpenStreetMap](https://www.openstreetmap.org/copyright) via the [Overpass API](https://overpass-api.de/) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | Credit "© OpenStreetMap contributors" where the game is seen (the title card does). `osm.json` and the derived `public/course/*.json`/`.bin` are ODbL derivative databases: if we publish them (we do, with the game) they stay under ODbL |
| Elevation (`terrarium/*.png`) | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen/Tilezen "Terrarium" encoding, zoom 15, about 4 m per pixel here). For Australia the source is Geoscience Australia's LiDAR-derived DEM | Attribution required per [Tilezen's notes](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Geoscience Australia releases its data under CC BY 4.0 (inferred for this dataset; check before any commercial use) | Credit "Terrain data © Commonwealth of Australia (Geoscience Australia) 2017" (the title card does) |

The gates, railings and all visual styling are made up (though the real walk does have
railings along its cliff tops); the ground, the walk, the coastline and what stands on
them come from the data. The walk is carved flat into the terrain, a few metres wide,
because at 4 m the DEM smears the cliff edge across it.

## The area

`tools/area.mjs` sets the bounding box (Bondi Icebergs to just past Tamarama Beach) and
the local frame: metres, +X east, -Z north, Y up, sea level at 0, origin near Marks Park.
The OSM snapshot's timestamp is in `osm.json` and copied into the course file.

## Known gaps

- Offshore the DEM is noisy, so the sea floor is synthesised: it shelves away from the
  OSM coastline rather than following real bathymetry.
- Buildings without `building:levels` or `height` tags (most of them) get 2–4 storeys
  picked from their OSM id, 2 for houses.
- Trees are all the same few low-poly shapes; OSM doesn't say which are Norfolk Island pines.
