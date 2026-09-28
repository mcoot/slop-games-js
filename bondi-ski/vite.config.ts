import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build can be hosted from any sub-path (e.g. GitHub Pages).
  base: "./",
  build: { target: "es2022", sourcemap: true },
});
