# slop-games-js
Slop browser games

- [`tokyo-station-chase/`](tokyo-station-chase/): first-person chase through Tokyo Station (Three.js + Rapier, Source-style movement)

Live at <https://slop-games.spearritt.dev/>, deployed to GitHub Pages on every push to
`master` by `.github/workflows/pages.yml`.

## Adding a game

1. Put it in its own folder with a `build` script whose output uses relative asset
   paths (Vite: `base: "./"`), since each game is served from `/<slug>/`.
2. Add it to [`games.json`](games.json): `slug` (its URL path), `title`, `description`,
   `dir` (the folder) and `dist` (build output, relative to `dir`). The build runs
   `pnpm install --frozen-lockfile && pnpm build` in `dir`; set `build` to override.
3. `node site/build.mjs` builds everything into `_site/` like CI does
   (`--skip-build` just reassembles from existing builds). The index page template is
   `site/index.html`.
