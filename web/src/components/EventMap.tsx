"use client";

import { maplibregl } from "@/lib/maplibre";
import { useCallback, useEffect, useRef, useState } from "react";
import { rasterStyle, S2_YEARS, s2Tiles } from "@/lib/basemaps";
import { IMAGERY_LAYERS } from "@/lib/imagery";
import { C } from "@/lib/theme";
import ImageryControls, { type ImageryState, syncImagery, useImageryStatus } from "./ImageryControls";

/**
 * Satellite view of one event: yearly Sentinel-2 cloud-free mosaics (before / after) as the
 * base, plus live Sentinel-1 / Sentinel-2 layers on the event's own date.
 */
export default function EventMap({
  lon,
  lat,
  date,
  surface,
  areaHa,
}: {
  lon: number;
  lat: number;
  date: string;
  surface: "water" | "land";
  areaHa: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const year = Number(date.slice(0, 4));
  // Nearest available mosaic strictly before / after the event year.
  const before = [...S2_YEARS].reverse().find((y) => y < year) ?? S2_YEARS[0];
  const after = S2_YEARS.find((y) => y > year) ?? S2_YEARS[S2_YEARS.length - 1];
  const [shown, setShown] = useState(after);
  const [loaded, setLoaded] = useState(false);
  // Water events open on the radar pass that caught them; land on the mosaic comparison.
  const [img, setImg] = useState<ImageryState>({
    layerId: surface === "water" ? "S1_VV" : "none",
    date,
    opacity: 1,
    exact: false,
    nonce: 0,
  });
  const patchImg = useCallback((p: Partial<ImageryState>) => setImg((s) => ({ ...s, ...p })), []);
  const [panel, setPanel] = useState(false);
  const [mapObj, setMapObj] = useState<maplibregl.Map | null>(null);
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const retry = useCallback(() => patchImg({ nonce: Date.now() }), [patchImg]);
  const imgLoading = useImageryStatus(mapObj, retry);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: rasterStyle([s2Tiles(after)], "Sentinel-2 cloudless by EOX (Copernicus data)", 16),
      center: [lon, lat],
      zoom: surface === "water" ? 11.5 : 13,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      // Approximate footprint: a circle with the detected area.
      const r = Math.sqrt((areaHa * 1e4) / Math.PI);
      const ring = Array.from({ length: 65 }, (_, i) => {
        const t = (i / 64) * 2 * Math.PI;
        return [lon + (r * Math.cos(t)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.sin(t)) / 110540];
      });
      map.addSource("fp", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } } });
      map.addLayer({ id: "fp-line", type: "line", source: "fp", paint: { "line-color": C.status.unverified, "line-width": 2, "line-dasharray": [2, 1.5] } });
      setLoaded(true);
      setMapObj(map);
      const onView = () => {
        const b = map.getBounds();
        setBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      };
      map.on("moveend", onView);
      onView();
    });
    return () => map.remove();
  }, [lon, lat, after, areaHa, surface]);

  useEffect(() => {
    const src = mapRef.current?.getSource("base") as maplibregl.RasterTileSource | undefined;
    src?.setTiles([s2Tiles(shown)]);
  }, [shown]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    syncImagery(map, img, "fp-line");
  }, [img, loaded]);

  const live = IMAGERY_LAYERS.find((l) => l.id === img.layerId);

  return (
    <div className="relative h-[420px] overflow-hidden rounded-xl border border-line">
      <div className="absolute inset-0"><div ref={ref} className="h-full w-full" /></div>
      <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2">
        {!live && (
          <div className="flex rounded-md bg-page/90 p-0.5 text-xs">
            {[before, after].filter((y, i, a) => a.indexOf(y) === i).map((y, i) => (
              <button
                key={y}
                onClick={() => setShown(y)}
                className={`rounded px-2.5 py-1 ${shown === y ? "bg-white text-black" : "text-ink-2"}`}
              >
                {i === 0 && before !== after ? "Before" : "After"} · {y}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setPanel((p) => !p)}
          className={`rounded-md px-2.5 py-1 text-xs ${panel ? "bg-white text-black" : "bg-page/90 text-ink-2"}`}
        >
          {live ? `Imagery: ${live.label}` : "Imagery layers"} ▾
        </button>
      </div>
      {panel && (
        <div className="card absolute left-3 top-12 z-10 max-h-[calc(100%-4rem)] w-[280px] overflow-y-auto p-3 shadow-2xl">
          <ImageryControls state={img} onChange={patchImg} bbox={bbox} loading={imgLoading} />
        </div>
      )}
      <div className="absolute bottom-3 left-3 z-10 rounded bg-page/80 px-2 py-1 text-[11px] text-ink-2">
        Dashed ring ≈ detected area ·{" "}
        {live ? `${live.label}, ${img.date}${live.windowDays && !img.exact ? ` ±${live.windowDays} days` : ""}` : "annual cloud-free mosaic"}
        {live && imgLoading && " · loading…"}
      </div>
    </div>
  );
}
