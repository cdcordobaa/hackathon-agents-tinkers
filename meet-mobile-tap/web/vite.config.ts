/**
 * Vanilla TS, no framework — this app is a handful of DOM panels wired to
 * LiveKit and a couple of WebSocket/fetch clients, and React would buy
 * nothing at that size. `root` stays the default (`web/`) deliberately: the
 * app imports straight from `../../shared/src/*.ts` and `../../agent/src/
 * fixtures/bank-scam.ts` (type-only or pure-data — see those files' own
 * headers), which only works if Vite is allowed to resolve outside its own
 * project directory. `server.fs.allow` opens exactly the monorepo root for
 * that; nothing under it is served that this app does not import.
 */
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  server: {
    fs: { allow: [repoRoot] },
  },
  build: {
    target: "es2022",
  },
});
