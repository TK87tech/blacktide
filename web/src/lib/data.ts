import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Meta, MetricsFile, SpillEvent } from "./types";

// Files written by the pipeline (pipeline/scripts/*.py). Read at build time only.
const DATA = path.join(process.cwd(), "data");

function read<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as T;
}

interface RawFeature {
  geometry: { coordinates: [number, number] };
  properties: Omit<SpillEvent, "lon" | "lat">;
}

let cache: SpillEvent[] | null = null;

export function getEvents(): SpillEvent[] {
  if (!cache) {
    const fc = read<{ features: RawFeature[] }>("events.json");
    cache = fc.features.map((f) => ({
      ...f.properties,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));
  }
  return cache;
}

export const getMeta = () => read<Meta>("meta.json");
export const getMetrics = () => read<MetricsFile>("model_metrics.json");
