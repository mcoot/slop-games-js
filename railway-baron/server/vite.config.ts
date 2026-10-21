import { defineConfig } from "vite";

/** The game server as one Node file (dist-server/main.js), dependencies and all. */
export default defineConfig({
  publicDir: false,
  build: {
    ssr: "server/main.ts",
    outDir: "dist-server",
    emptyOutDir: true,
    target: "node22",
    sourcemap: true,
  },
  ssr: { noExternal: true, target: "node" },
});
