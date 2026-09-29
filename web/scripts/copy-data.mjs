// The map, events table and event page fetch the events in the browser instead of having
// ~11k events baked into every page. Ship the pipeline's events.json as a static file.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/data", { recursive: true });
copyFileSync("data/events.json", "public/data/events.json");
