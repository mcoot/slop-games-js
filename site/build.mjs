// Builds every game listed in games.json and assembles one static site in _site/:
// each game's build output at /<slug>/, plus an index page linking to them all.
//
//   node site/build.mjs               install, build and assemble everything
//   node site/build.mjs --skip-build  assemble from each game's existing dist
//
// Games must build with relative asset paths (Vite `base: "./"`) so they work under /<slug>/.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "_site");
const skipBuild = process.argv.includes("--skip-build");
const games = JSON.parse(readFileSync(join(root, "games.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const game of games) {
  const dir = join(root, game.dir);
  if (!skipBuild) {
    const build = game.build ?? "pnpm install --frozen-lockfile && pnpm build";
    console.log(`\n== ${game.slug}: ${build}`);
    execSync(build, { cwd: dir, stdio: "inherit" });
  }
  const dist = join(dir, game.dist);
  if (!existsSync(join(dist, "index.html"))) {
    throw new Error(`${game.slug}: no index.html in ${dist}`);
  }
  cpSync(dist, join(out, game.slug), { recursive: true });
  console.log(`== ${game.slug} -> _site/${game.slug}/`);
}

const escape = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cards = games
  .map(
    (g) => `      <li>
        <a href="${escape(g.slug)}/">
          <h2>${escape(g.title)}</h2>
          <p>${escape(g.description)}</p>
        </a>
      </li>`,
  )
  .join("\n");
const template = readFileSync(join(root, "site", "index.html"), "utf8");
writeFileSync(join(out, "index.html"), template.replace("<!-- GAMES -->", cards));
// Keep GitHub Pages from running the output through Jekyll.
writeFileSync(join(out, ".nojekyll"), "");
console.log(`\nSite ready in _site/ (${games.length} game${games.length === 1 ? "" : "s"})`);
