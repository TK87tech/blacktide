"use client";

import type { Map as MlMap, RasterTileSource } from "maplibre-gl";
import { IMAGERY_ATTRIBUTION, IMAGERY_LAYERS, IMAGERY_MIN_ZOOM, imageryTiles } from "@/lib/imagery";

const SRC = "imagery";

/** Add, update or remove the live imagery overlay on a loaded map. It sits below `beforeId`. */
export function syncImagery(map: MlMap, layerId: string, date: string, opacity: number, beforeId?: string) {
  const layer = IMAGERY_LAYERS.find((l) => l.id === layerId);
  if (!layer) {
    if (map.getLayer(SRC)) map.removeLayer(SRC);
    if (map.getSource(SRC)) map.removeSource(SRC);
    return;
  }
  const tiles = [imageryTiles(layer, date)];
  const src = map.getSource(SRC) as RasterTileSource | undefined;
  if (src) {
    src.setTiles(tiles);
  } else {
    map.addSource(SRC, { type: "raster", tiles, tileSize: 256, minzoom: IMAGERY_MIN_ZOOM, attribution: IMAGERY_ATTRIBUTION });
    map.addLayer({ id: SRC, type: "raster", source: SRC, minzoom: IMAGERY_MIN_ZOOM }, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
  }
  map.setPaintProperty(SRC, "raster-opacity", opacity);
}

export default function ImageryControls({
  layerId,
  onLayer,
  date,
  onDate,
  opacity,
  onOpacity,
  zoomedOut,
}: {
  layerId: string;
  onLayer: (id: string) => void;
  date: string;
  onDate: (d: string) => void;
  opacity: number;
  onOpacity: (o: number) => void;
  zoomedOut?: boolean;
}) {
  const layer = IMAGERY_LAYERS.find((l) => l.id === layerId);
  const groups = [...new Set(IMAGERY_LAYERS.map((l) => l.group))];
  const input = "w-full rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink";
  return (
    <div className="space-y-2">
      <select value={layerId} onChange={(e) => onLayer(e.target.value)} className={input} aria-label="Imagery layer">
        <option value="none">Off</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {IMAGERY_LAYERS.filter((l) => l.group === g).map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {layer && (
        <>
          <div className="flex items-center gap-2">
            <input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} className={input} aria-label="Imagery date" />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted">
            Opacity
            <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => onOpacity(Number(e.target.value))} className="flex-1" />
          </label>
          <p className="text-[11px] leading-relaxed text-ink-2">{layer.legend}</p>
          <p className="text-[11px] leading-relaxed text-muted">
            {layer.windowDays === 0
              ? "Shows that day's radar pass only — pick a date with a pass (Sentinel-1 revisits every 6–12 days)."
              : `Least-cloudy view within ±${layer.windowDays} days of the date.`}
            {zoomedOut && " Zoom in to load imagery."}
          </p>
        </>
      )}
    </div>
  );
}
