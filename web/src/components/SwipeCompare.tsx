"use client";

import { maplibregl } from "@/lib/maplibre";
import { useEffect, useRef, useState } from "react";
import { DELTA_BOUNDS, rasterStyle, S2_YEARS, s2Tiles } from "@/lib/basemaps";

const PLACES: { name: string; center: [number, number]; zoom: number }[] = [
  { name: "Bodo, Gokana", center: [7.273, 4.617], zoom: 12.5 },
  { name: "Bonny", center: [7.17, 4.435], zoom: 12 },
  { name: "Nembe creeks", center: [6.4, 4.54], zoom: 12 },
  { name: "Ikarama", center: [6.33, 5.12], zoom: 12.5 },
  { name: "Forcados", center: [5.35, 5.36], zoom: 12 },
  { name: "Ibeno / Qua Iboe", center: [8.0, 4.56], zoom: 12 },
];

const ATTR = 'Sentinel-2 cloudless by <a href="https://s2maps.eu">EOX</a> (Copernicus data)';

/** Two synced maps, the right one clipped by a draggable divider. */
export default function SwipeCompare() {
  const wrap = useRef<HTMLDivElement>(null);
  const leftEl = useRef<HTMLDivElement>(null);
  const rightEl = useRef<HTMLDivElement>(null);
  const maps = useRef<{ left?: maplibregl.Map; right?: maplibregl.Map }>({});
  const [leftYear, setLeftYear] = useState(S2_YEARS[0]);
  const [rightYear, setRightYear] = useState(S2_YEARS[S2_YEARS.length - 1]);
  const [pos, setPos] = useState(0.5);
  const dragging = useRef(false);

  useEffect(() => {
    if (!leftEl.current || !rightEl.current) return;
    const opts = { center: PLACES[0].center, zoom: PLACES[0].zoom, maxBounds: DELTA_BOUNDS, attributionControl: false as const };
    const left = new maplibregl.Map({ container: leftEl.current, style: rasterStyle([s2Tiles(S2_YEARS[0])], ATTR, 16), ...opts });
    const right = new maplibregl.Map({
      container: rightEl.current,
      style: rasterStyle([s2Tiles(S2_YEARS[S2_YEARS.length - 1])], ATTR, 16),
      ...opts,
      attributionControl: { compact: true },
    });
    right.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // Keep cameras in lock-step.
    let syncing = false;
    const sync = (from: maplibregl.Map, to: maplibregl.Map) => () => {
      if (syncing) return;
      syncing = true;
      to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
      syncing = false;
    };
    left.on("move", sync(left, right));
    right.on("move", sync(right, left));
    maps.current = { left, right };
    return () => {
      left.remove();
      right.remove();
    };
  }, []);

  useEffect(() => {
    (maps.current.left?.getSource("base") as maplibregl.RasterTileSource | undefined)?.setTiles([s2Tiles(leftYear)]);
  }, [leftYear]);
  useEffect(() => {
    (maps.current.right?.getSource("base") as maplibregl.RasterTileSource | undefined)?.setTiles([s2Tiles(rightYear)]);
  }, [rightYear]);

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

  const yearSelect = (value: number, onChange: (y: number) => void, label: string) => (
    <label className="flex items-center gap-2 rounded-md bg-page/90 px-2 py-1 text-xs text-ink-2">
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="bg-transparent text-ink">
        {S2_YEARS.map((y) => (
          <option key={y} value={y} className="bg-surface">{y}</option>
        ))}
      </select>
    </label>
  );

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
        <div className="absolute left-3 top-3 z-10">{yearSelect(leftYear, setLeftYear, "Before")}</div>
        <div className="absolute right-14 top-3 z-10">{yearSelect(rightYear, setRightYear, "After")}</div>
      </div>
    </div>
  );
}
