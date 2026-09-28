"use client";

import { maplibregl } from "@/lib/maplibre";
import { useEffect, useRef, useState } from "react";
import { rasterStyle, S2_YEARS, s2Tiles } from "@/lib/basemaps";
import { C } from "@/lib/theme";

/** Satellite view of one event with a before/after toggle on the yearly Sentinel-2 cloudless mosaics. */
export default function EventMap({ lon, lat, year, areaHa }: { lon: number; lat: number; year: number; areaHa: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Nearest available mosaic strictly before / after the event year.
  const before = [...S2_YEARS].reverse().find((y) => y < year) ?? S2_YEARS[0];
  const after = S2_YEARS.find((y) => y > year) ?? S2_YEARS[S2_YEARS.length - 1];
  const [shown, setShown] = useState(after);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: rasterStyle([s2Tiles(after)], "Sentinel-2 cloudless by EOX (Copernicus data)", 16),
      center: [lon, lat],
      zoom: 13,
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
    });
    return () => map.remove();
  }, [lon, lat, after, areaHa]);

  useEffect(() => {
    const src = mapRef.current?.getSource("base") as maplibregl.RasterTileSource | undefined;
    src?.setTiles([s2Tiles(shown)]);
  }, [shown]);

  return (
    <div className="relative h-[360px] overflow-hidden rounded-xl border border-line">
      <div className="absolute inset-0"><div ref={ref} className="h-full w-full" /></div>
      <div className="absolute left-3 top-3 z-10 flex rounded-md bg-page/90 p-0.5 text-xs">
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
      <div className="absolute bottom-3 left-3 z-10 rounded bg-page/80 px-2 py-1 text-[11px] text-ink-2">
        Dashed ring ≈ detected area · annual cloud-free mosaic
      </div>
    </div>
  );
}
