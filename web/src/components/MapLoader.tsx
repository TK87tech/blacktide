"use client";

import { useMemo } from "react";
import Loading from "./Loading";
import MapExplorer from "./MapExplorer";
import { monthRange } from "@/lib/stats";
import { useEvents } from "@/lib/useEvents";

export default function MapLoader() {
  const { events, error } = useEvents();
  const months = useMemo(() => (events ? monthRange(events) : []), [events]);
  if (!events) return <Loading error={error} />;
  return <MapExplorer events={events} months={months} />;
}
