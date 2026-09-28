// MapLibre v6 resolves its worker via new URL(..., import.meta.url), which the bundler
// doesn't emit. Ship the worker (and the shared chunk it imports) as static files instead.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/maplibre", { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(`node_modules/maplibre-gl/dist/${f}`, `public/maplibre/${f}`);
}
