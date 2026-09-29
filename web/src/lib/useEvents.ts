"use client";

import { useEffect, useState } from "react";
import type { SpillEvent } from "./types";

interface RawFeature {
  geometry: { coordinates: [number, number] };
  properties: Omit<SpillEvent, "lon" | "lat">;
}

let cache: Promise<SpillEvent[]> | null = null;

/** All events, fetched once per page load from /data/events.json (copied there at build). */
export function loadEvents(): Promise<SpillEvent[]> {
  if (!cache) {
    cache = fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/events.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`events.json ${r.status}`);
        return r.json() as Promise<{ features: RawFeature[] }>;
      })
      .then((fc) => fc.features.map((f) => ({ ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })))
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

export function useEvents() {
  const [events, setEvents] = useState<SpillEvent[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    loadEvents()
      .then((e) => live && setEvents(e))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, []);
  return { events, error };
}

export const eventHref = (id: string) => `/events/view/?id=${encodeURIComponent(id)}`;
