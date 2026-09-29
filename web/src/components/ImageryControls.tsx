"use client";

import type { Map as MlMap, RasterTileSource } from "maplibre-gl";
import { useEffect, useState } from "react";
import { fmtDate } from "@/lib/format";
import { IMAGERY_ATTRIBUTION, IMAGERY_LAYERS, IMAGERY_MIN_ZOOM, imageryTiles } from "@/lib/imagery";
import { fetchPasses, type Pass } from "@/lib/passes";

const SRC = "imagery";

export interface ImageryState {
  layerId: string;
  date: string;
  opacity: number;
  /** Optical: show that single day instead of the least-cloudy mosaic. */
  exact: boolean;
  nonce: number;
}

/** Add, update or remove the live imagery overlay on a loaded map. It sits below `beforeId`. */
export function syncImagery(map: MlMap, st: ImageryState, beforeId?: string) {
  const layer = IMAGERY_LAYERS.find((l) => l.id === st.layerId);
  if (!layer) {
    if (map.getLayer(SRC)) map.removeLayer(SRC);
    if (map.getSource(SRC)) map.removeSource(SRC);
    return;
  }
  const tiles = [imageryTiles(layer, st.date, { exact: st.exact, nonce: st.nonce })];
  const src = map.getSource(SRC) as RasterTileSource | undefined;
  if (src) {
    src.setTiles(tiles);
  } else {
    map.addSource(SRC, { type: "raster", tiles, tileSize: 256, minzoom: IMAGERY_MIN_ZOOM, attribution: IMAGERY_ATTRIBUTION });
    map.addLayer({ id: SRC, type: "raster", source: SRC, minzoom: IMAGERY_MIN_ZOOM }, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
  }
  map.setPaintProperty(SRC, "raster-opacity", st.opacity);
}

/**
 * Whether imagery tiles are loading; retries once, 3 s after a tile error
 * (CDSE renders tiles on demand, and on slow links some time out).
 */
export function useImageryStatus(map: MlMap | null, onRetry: () => void) {
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!map) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retried = false;
    const sourceOf = (e: object) => (e as { sourceId?: string }).sourceId;
    const onLoading = (e: object) => {
      if (sourceOf(e) === SRC) setLoading(true);
    };
    const onIdle = () => setLoading(false);
    const onError = (e: object) => {
      if (sourceOf(e) !== SRC || retried) return;
      retried = true;
      timer = setTimeout(onRetry, 3000);
    };
    map.on("dataloading", onLoading);
    map.on("idle", onIdle);
    map.on("error", onError);
    return () => {
      clearTimeout(timer);
      map.off("dataloading", onLoading);
      map.off("idle", onIdle);
      map.off("error", onError);
    };
  }, [map, onRetry]);
  return loading;
}

const dayMs = (iso: string) => new Date(iso + "T00:00:00Z").getTime();

export default function ImageryControls({
  state,
  onChange,
  bbox,
  zoomedOut,
  loading,
}: {
  state: ImageryState;
  onChange: (patch: Partial<ImageryState>) => void;
  /** Current view [west, south, east, north], for listing acquisitions over it. */
  bbox: [number, number, number, number] | null;
  zoomedOut?: boolean;
  loading?: boolean;
}) {
  const layer = IMAGERY_LAYERS.find((l) => l.id === state.layerId);
  const groups = [...new Set(IMAGERY_LAYERS.map((l) => l.group))];
  const radar = !!layer?.group.startsWith("Radar");
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const [passErr, setPassErr] = useState(false);
  const bboxKey = bbox ? bbox.map((v) => v.toFixed(2)).join(",") : "";
  const month = state.date.slice(0, 7);

  // List acquisitions over the view (debounced: the map moves a lot).
  useEffect(() => {
    if (!layer || !bbox || zoomedOut) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetchPasses(layer, bbox, state.date, radar ? 30 : 45, ctl.signal)
        .then((p) => {
          setPasses(p);
          setPassErr(false);
        })
        .catch((e: Error) => {
          if (e.name !== "AbortError") setPassErr(true);
        });
    }, 500);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
    // bbox is compared via its rounded key; the date only matters at month resolution
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.id, bboxKey, month, zoomedOut]);

  const input = "w-full rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink";
  const shown = layer && !zoomedOut ? passes : null;
  const nearest = shown
    ? [...shown]
        .sort((a, b) => Math.abs(dayMs(a.date) - dayMs(state.date)) - Math.abs(dayMs(b.date) - dayMs(state.date)))
        .slice(0, 12)
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const current = shown?.find((p) => p.date === state.date);

  return (
    <div className="space-y-2">
      <select value={state.layerId} onChange={(e) => onChange({ layerId: e.target.value })} className={input} aria-label="Imagery layer">
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
            <input type="date" value={state.date} onChange={(e) => e.target.value && onChange({ date: e.target.value })} className={input} aria-label="Imagery date" />
            <button
              onClick={() => onChange({ nonce: Date.now() })}
              title="Reload imagery"
              aria-label="Reload imagery"
              className="rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:bg-white/5"
            >
              ↻
            </button>
          </div>

          {zoomedOut ? (
            <p className="text-[11px] text-st-unverified">Zoom in to load imagery.</p>
          ) : (
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
                <span>{radar ? "Radar passes over this view" : "Sentinel-2 dates over this view"}</span>
                {loading && <span className="text-ink-2">Loading imagery…</span>}
              </div>
              {passErr && <p className="text-[11px] text-muted">Couldn&apos;t list passes — the imagery still works.</p>}
              {shown && !nearest.length && <p className="text-[11px] text-muted">No acquisitions near this date.</p>}
              <div className="flex flex-wrap gap-1">
                {nearest.map((p) => (
                  <button
                    key={p.date}
                    onClick={() => onChange(radar ? { date: p.date } : { date: p.date, exact: true })}
                    title={radar ? `${Math.round(p.cover * 100)}% of the view` : `cloud ${p.cloud?.toFixed(0)}% · ${Math.round(p.cover * 100)}% of the view`}
                    className={`tabular rounded px-1.5 py-0.5 text-[11px] ${
                      p.date === state.date ? "bg-white text-black" : "bg-surface-2 text-ink-2 hover:text-ink"
                    }`}
                  >
                    {fmtDate(p.date).replace(/ \d{4}$/, "")}{" "}
                    <span className="opacity-60">{radar ? `${Math.round(p.cover * 100)}%` : `☁${p.cloud?.toFixed(0)}`}</span>
                  </button>
                ))}
              </div>
              {radar && shown && !current && (
                <p className="mt-1 text-[11px] text-st-unverified">No radar pass over this view on the chosen date — pick one above.</p>
              )}
              {radar && current && current.cover < 0.95 && (
                <p className="mt-1 text-[11px] text-muted">
                  This pass covers {Math.round(current.cover * 100)}% of the view; the rest lies outside its strip.
                </p>
              )}
            </div>
          )}

          {!radar && [4, 5, 6, 7, 8, 9, 10].includes(Number(state.date.slice(5, 7))) && (
            <p className="text-[11px] leading-relaxed text-st-unverified">
              Rainy season: optical views of the Delta are mostly cloud from April to October. Radar sees through
              cloud — or pick a November–March date.
            </p>
          )}
          {!radar && (
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink-2">
              <input type="checkbox" checked={state.exact} onChange={(e) => onChange({ exact: e.target.checked })} className="accent-white" />
              Single day only (else least-cloudy within ±{layer.windowDays} days)
            </label>
          )}
          <label className="flex items-center gap-2 text-[11px] text-muted">
            Opacity
            <input type="range" min={0.2} max={1} step={0.05} value={state.opacity} onChange={(e) => onChange({ opacity: Number(e.target.value) })} className="flex-1" />
          </label>
          <p className="text-[11px] leading-relaxed text-ink-2">{layer.legend}</p>
        </>
      )}
    </div>
  );
}
