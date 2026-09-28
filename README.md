# slop-games-js
Slop browser games

- [`tokyo-station-chase/`](tokyo-station-chase/): first-person chase through Tokyo Station (Three.js + Rapier, Source-style movement)
- [`bondi-ski/`](bondi-ski/): Tribes-style skiing time trial along the real Bondi to Coogee coastal walk, built from OpenStreetMap and elevation data

Everything is one pnpm workspace: shared, game-agnostic packages in [`packages/`](packages)
(Source-style movement, input, physics, Blender level loading, tuning panel, audio, AI...)
and Blender tools in [`tools/`](tools), used by each game's folder. `pnpm install` once at
the root; `pnpm test` and `pnpm typecheck` there cover everything.

Live at <https://slop-games.spearritt.dev/>, deployed to GitHub Pages on every push to
`master` by `.github/workflows/pages.yml`.

## Adding a game

1. Put it in its own folder (add it to `pnpm-workspace.yaml` so it can depend on
   `@slop/*` packages with `workspace:*`) with a `build` script whose output uses relative asset
   paths (Vite: `base: "./"`), since each game is served from `/<slug>/`.
2. Add it to [`games.json`](games.json): `slug` (its URL path), `title`, `description`,
   `dir` (the folder) and `dist` (build output, relative to `dir`). The build runs
   `pnpm install --frozen-lockfile && pnpm build` in `dir`; set `build` to override.
3. `node site/build.mjs` builds everything into `_site/` like CI does
   (`--skip-build` just reassembles from existing builds). The index page template is
   `site/index.html`.
