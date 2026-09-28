import { defineConfig } from "vite";
import { blenderLevels } from "../../../tools/vite-plugin-blender-levels";

export default defineConfig({
  // Relative asset paths so the build can be hosted from any sub-path (e.g. GitHub Pages).
  base: "./",
  build: { target: "es2022", sourcemap: true },
  plugins: [blenderLevels({ src: "assets-src/levels", out: "public/levels" })],
});
