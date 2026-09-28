import * as maplibregl from "maplibre-gl";

// Worker files are copied to public/maplibre by scripts/copy-maplibre-worker.mjs.
maplibregl.setWorkerUrl(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/maplibre/maplibre-gl-worker.mjs`);

export { maplibregl };
