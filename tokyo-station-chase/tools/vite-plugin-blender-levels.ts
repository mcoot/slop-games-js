import { basename, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { exportBlend } from "./blender-export.mjs";

export interface BlenderLevelsOptions {
  /** Folder of .blend sources, relative to the Vite root. */
  src: string;
  /** Folder the .glb files go to, relative to the Vite root. Must be inside `publicDir`. */
  out: string;
}

/** Sent when a level .glb changes. `url` is relative to the page, like the game loads it. */
export interface LevelUpdate {
  url: string;
}

export interface LevelExportError {
  file: string;
  message: string;
}

export const LEVEL_UPDATE_EVENT = "blender-levels:update";
export const LEVEL_ERROR_EVENT = "blender-levels:error";

/**
 * Dev-server hot reload for Blender levels: saving a .blend re-exports it, and any
 * change to an exported .glb (from here or `pnpm export-levels`) tells the page to
 * swap the level in place. Does nothing in production builds.
 */
export function blenderLevels(options: BlenderLevelsOptions): Plugin {
  return {
    name: "slop:blender-levels",
    apply: "serve",
    configureServer(server) {
      const { root, publicDir, logger } = server.config;
      const src = resolve(root, options.src);
      const out = resolve(root, options.out);
      const inside = (dir: string, file: string) => file.startsWith(dir + sep);
      server.watcher.add([src, out]);

      // One export per .blend at a time; a save during an export queues one more.
      const running = new Set<string>();
      const queued = new Set<string>();
      const exportLevel = async (blend: string) => {
        if (running.has(blend)) {
          queued.add(blend);
          return;
        }
        running.add(blend);
        const started = performance.now();
        const name = basename(blend);
        try {
          await exportBlend(blend, resolve(out, `${basename(blend, ".blend")}.glb`));
          logger.info(`[levels] exported ${name} in ${Math.round(performance.now() - started)} ms`, { timestamp: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`[levels] ${message}`, { timestamp: true });
          server.ws.send({ type: "custom", event: LEVEL_ERROR_EVENT, data: { file: name, message } satisfies LevelExportError });
        } finally {
          running.delete(blend);
          if (queued.delete(blend)) void exportLevel(blend);
        }
      };

      // Blender and the exporter write files in several steps: act once they go quiet.
      const timers = new Map<string, ReturnType<typeof setTimeout>>();
      const settle = (file: string, ms: number, fn: () => void) => {
        clearTimeout(timers.get(file));
        timers.set(file, setTimeout(() => (timers.delete(file), fn()), ms));
      };

      const onFile = (file: string) => {
        if (inside(src, file) && file.endsWith(".blend")) {
          settle(file, 200, () => void exportLevel(file));
        } else if (inside(out, file) && file.endsWith(".glb")) {
          settle(file, 250, () => {
            const url = relative(publicDir, file).split(sep).join("/");
            logger.info(`[levels] reloading ${url}`, { timestamp: true });
            server.ws.send({ type: "custom", event: LEVEL_UPDATE_EVENT, data: { url } satisfies LevelUpdate });
          });
        }
      };
      server.watcher.on("add", onFile);
      server.watcher.on("change", onFile);
    },
  };
}
