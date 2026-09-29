"use client";

import { maplibregl } from "@/lib/maplibre";
import type { Map as MlMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { DELTA_BOUNDS, rasterStyle, S2_YEARS, s2Tiles } from "@/lib/basemaps";
import { fmtDate } from "@/lib/format";
import { IMAGERY_ATTRIBUTION, IMAGERY_LAYERS, IMAGERY_MIN_ZOOM, imageryTiles } from "@/lib/imagery";
import { fetchPasses, type Pass } from "@/lib/passes";

const PLACES: { name: string; center: [number, number]; zoom: number }[] = [
  { name: "Bodo, Gokana", center: [7.273, 4.617], zoom: 12.5 },
  { name: "Bonny", center: [7.17, 4.435], zoom: 12 },
  { name: "Nembe creeks", center: [6.4, 4.54], zoom: 12 },
  { name: "Ikarama", center: [6.33, 5.12], zoom: 12.5 },
  { name: "Forcados", center: [5.35, 5.36], zoom: 12 },
  { name: "Ibeno / Qua Iboe", center: [8.0, 4.56], zoom: 12 },
];

const EOX_ATTR = 'Sentinel-2 cloudless by <a href="https://s2maps.eu">EOX</a> (Copernicus data)';
const MOSAIC = "MOSAIC";

interface Side {
  layer: string; // MOSAIC or an IMAGERY_LAYERS id
  year: number; // mosaic year
  date: string; // live-layer date
  exact: boolean; // optical: that single day only
}

/** Swap a side's imagery. Sources are replaced (not just re-tiled) because zoom limits differ. */
function applySide(map: MlMap, s: Side) {
  const live = IMAGERY_LAYERS.find((l) => l.id === s.layer);
  const tiles = live ? [imageryTiles(live, s.date, { exact: s.exact })] : [s2Tiles(s.year)];
  if (map.getLayer("side")) map.removeLayer("side");
  if (map.getSource("side")) map.removeSource("side");
  map.addSource("side", {
    type: "raster",
    tiles,
    tileSize: 256,
    ...(live ? { minzoom: IMAGERY_MIN_ZOOM, attribution: IMAGERY_ATTRIBUTION } : { maxzoom: 16, attribution: EOX_ATTR }),
  });
  map.addLayer({ id: "side", type: "raster", source: "side" });
}

type Bbox = [number, number, number, number];
const dayMs = (iso: string) => new Date(iso + "T00:00:00Z").getTime();

function SideControls({ label, side, onChange, align, bbox }: { label: string; side: Side; onChange: (p: Partial<Side>) => void; align: "left" | "right"; bbox: Bbox | null }) {
  const live = IMAGERY_LAYERS.find((l) => l.id === side.layer);
  const radar = !!live?.group.startsWith("Radar");
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const bboxKey = bbox ? bbox.map((v) => v.toFixed(2)).join(",") : "";
  const month = side.date.slice(0, 7);
  useEffect(() => {
    if (!live || !bbox) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetchPasses(live, bbox, side.date, radar ? 30 : 45, ctl.signal).then(setPasses).catch(() => {});
    }, 500);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
    // bbox compared via its rounded key; date at month resolution
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.id, bboxKey, month]);
  const nearest = live && passes
    ? [...passes]
        .sort((a, b) => Math.abs(dayMs(a.date) - dayMs(side.date)) - Math.abs(dayMs(b.date) - dayMs(side.date)))
        .slice(0, 8)
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const hasPass = passes?.some((p) => p.date === side.date);
  const groups = [...new Set(IMAGERY_LAYERS.map((l) => l.group))];
  const field = "w-full rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink";
  return (
    <div className={`card w-[250px] space-y-2 p-2.5 shadow-2xl ${align === "right" ? "text-left" : ""}`}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <select value={side.layer} onChange={(e) => onChange({ layer: e.target.value })} className={field} aria-label={`${label} layer`}>
        <option value={MOSAIC}>Cloud-free mosaic (yearly)</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {IMAGERY_LAYERS.filter((l) => l.group === g).map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {live ? (
        <>
          <input type="date" value={side.date} onChange={(e) => e.target.value && onChange({ date: e.target.value })} className={field} aria-label={`${label} date`} />
          {nearest.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] text-muted">{radar ? "Radar passes over this view" : "Sentinel-2 dates over this view"}</div>
              <div className="flex flex-wrap gap-1">
                {nearest.map((p) => (
                  <button
                    key={p.date}
                    onClick={() => onChange(radar ? { date: p.date } : { date: p.date, exact: true })}
                    className={`tabular rounded px-1.5 py-0.5 text-[11px] ${p.date === side.date ? "bg-white text-black" : "bg-surface-2 text-ink-2 hover:text-ink"}`}
                  >
                    {fmtDate(p.date).replace(/ \d{4}$/, "")}{" "}
                    <span className="opacity-60">{radar ? `${Math.round(p.cover * 100)}%` : `☁${p.cloud?.toFixed(0)}`}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {radar && passes && !hasPass && (
            <p className="text-[11px] text-st-unverified">No radar pass here on this date — pick one above.</p>
          )}
          {live.group.startsWith("Optical") && (
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink-2">
              <input type="checkbox" checked={side.exact} onChange={(e) => onChange({ exact: e.target.checked })} className="accent-white" />
              Single day (else least-cloudy ±{live.windowDays} days)
            </label>
          )}
          <p className="text-[11px] leading-relaxed text-ink-2">{live.legend}</p>
        </>
      ) : (
        <select value={side.year} onChange={(e) => onChange({ year: Number(e.target.value) })} className={field} aria-label={`${label} year`}>
          {S2_YEARS.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Two synced maps, the right one clipped by a draggable divider; each side picks its own imagery. */
export default function SwipeCompare() {
  const wrap = useRef<HTMLDivElement>(null);
  const leftEl = useRef<HTMLDivElement>(null);
  const rightEl = useRef<HTMLDivElement>(null);
  const maps = useRef<{ left?: MlMap; right?: MlMap }>({});
  const [ready, setReady] = useState(0);
  const [left, setLeft] = useState<Side>({ layer: MOSAIC, year: S2_YEARS[0], date: "2025-01-15", exact: false });
  const [right, setRight] = useState<Side>({ layer: MOSAIC, year: S2_YEARS[S2_YEARS.length - 1], date: "2026-01-15", exact: false });
  const [zoom, setZoom] = useState(PLACES[0].zoom);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [pos, setPos] = useState(0.5);
  const dragging = useRef(false);

  useEffect(() => {
    if (!leftEl.current || !rightEl.current) return;
    const opts = { center: PLACES[0].center, zoom: PLACES[0].zoom, maxBounds: DELTA_BOUNDS, attributionControl: false as const };
    const empty = rasterStyle([], "", 16);
    empty.sources = {};
    empty.layers = [{ id: "bg", type: "background", paint: { "background-color": "#0d0d0d" } }];
    const l = new maplibregl.Map({ container: leftEl.current, style: empty, ...opts });
    const r = new maplibregl.Map({ container: rightEl.current, style: empty, ...opts, attributionControl: { compact: true } });
    r.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // Keep cameras in lock-step.
    let syncing = false;
    const sync = (from: MlMap, to: MlMap) => () => {
      if (syncing) return;
      syncing = true;
      to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
      syncing = false;
    };
    l.on("move", sync(l, r));
    r.on("move", sync(r, l));
    const onView = () => {
      setZoom(r.getZoom());
      const b = r.getBounds();
      setBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    r.on("moveend", onView);
    r.on("load", onView);
    let loaded = 0;
    const onLoad = () => {
      loaded += 1;
      if (loaded === 2) setReady(1);
    };
    l.on("load", onLoad);
    r.on("load", onLoad);
    maps.current = { left: l, right: r };
    return () => {
      l.remove();
      r.remove();
    };
  }, []);

  useEffect(() => {
    if (ready && maps.current.left) applySide(maps.current.left, left);
  }, [left, ready]);
  useEffect(() => {
    if (ready && maps.current.right) applySide(maps.current.right, right);
  }, [right, ready]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current || !wrap.current) return;
      const r = wrap.current.getBoundingClientRect();
      setPos(Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width)));
    };
    const up = () => (dragging.current = false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const liveShown = [left, right].some((s) => s.layer !== MOSAIC);
  const presets: { label: string; l: Partial<Side>; r: Partial<Side> }[] = [
    { label: "Mosaic: 2016 vs latest", l: { layer: MOSAIC, year: S2_YEARS[0] }, r: { layer: MOSAIC, year: S2_YEARS[S2_YEARS.length - 1] } },
    { label: "Vegetation (SWIR): dry season 2024 vs 2025", l: { layer: "S2_SWIR", date: "2024-01-15", exact: false }, r: { layer: "S2_SWIR", date: "2025-01-15", exact: false } },
    { label: "NDVI: 2024 vs 2025", l: { layer: "S2_NDVI", date: "2024-01-15", exact: false }, r: { layer: "S2_NDVI", date: "2025-01-15", exact: false } },
    { label: "True colour vs radar, same date", l: { layer: "S2_TRUE_COLOR", date: right.date, exact: false }, r: { layer: "S1_VV" } },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <span className="text-xs text-muted">Jump to:</span>
        {PLACES.map((p) => (
          <button
            key={p.name}
            onClick={() => maps.current.right?.flyTo({ center: p.center, zoom: p.zoom, speed: 1.6 })}
            className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:bg-white/5 hover:text-ink"
          >
            {p.name}
          </button>
        ))}
        <span className="ml-2 text-xs text-muted">Presets:</span>
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setLeft((s) => ({ ...s, ...p.l }));
              setRight((s) => ({ ...s, ...p.r }));
            }}
            className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:bg-white/5 hover:text-ink"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div ref={wrap} className="relative flex-1 min-h-[520px] select-none overflow-hidden">
        <div className="absolute inset-0"><div ref={leftEl} className="h-full w-full" /></div>
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos * 100}%)` }}><div ref={rightEl} className="h-full w-full" /></div>
        <div
          className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 cursor-ew-resize bg-white"
          style={{ left: `${pos * 100}%` }}
          onPointerDown={() => (dragging.current = true)}
        >
          <div className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-sm text-black shadow-lg">
            ⇆
          </div>
        </div>
        <div className="absolute left-3 top-3 z-10">
          <SideControls label="Left" side={left} onChange={(p) => setLeft((s) => ({ ...s, ...p }))} align="left" bbox={bbox} />
        </div>
        <div className="absolute right-14 top-3 z-10">
          <SideControls label="Right" side={right} onChange={(p) => setRight((s) => ({ ...s, ...p }))} align="right" bbox={bbox} />
        </div>
        {liveShown && zoom < IMAGERY_MIN_ZOOM && (
          <div className="absolute bottom-10 left-1/2 z-10 -translate-x-1/2 rounded-md bg-page/90 px-3 py-1.5 text-xs text-st-unverified">
            Zoom in to load the radar / index layers.
          </div>
        )}
      </div>
    </div>
  );
}
