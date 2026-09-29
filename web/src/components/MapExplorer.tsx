"use client";

import Link from "next/link";
import { maplibregl } from "@/lib/maplibre";
import type { GeoJSONSource } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { DARK_STYLE, DELTA_BOUNDS, DELTA_VIEW, S2_ATTR, s2Tiles } from "@/lib/basemaps";
import { fmt1, fmtDate, fmtInt, fmtMonth, fmtPct, sourceLabel, STATUS_LABEL } from "@/lib/format";
import { C } from "@/lib/theme";
import type { SpillEvent, Status, Surface } from "@/lib/types";
import StatusBadge from "./StatusBadge";

type Mode = "points" | "heat";
type ColorBy = "surface" | "status";
type Base = "dark" | "satellite";

const WINDOWS = [
  { months: 0, label: "All time" },
  { months: 12, label: "12 months" },
  { months: 3, label: "3 months" },
  { months: 1, label: "1 month" },
];

const colorExpr = (by: ColorBy) =>
  (by === "surface"
    ? ["match", ["get", "surface"], "water", C.water, C.land]
    : ["match", ["get", "status"], "verified", C.status.verified, "unverified", C.status.unverified, C.status.false_positive]) as never;

function toGeoJSON(events: SpillEvent[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: events.map((e) => ({
      type: "Feature",
      id: e.id,
      geometry: { type: "Point", coordinates: [e.lon, e.lat] },
      properties: { id: e.id, surface: e.surface, status: e.status, area_ha: e.area_ha, confidence: e.confidence },
    })),
  };
}

export default function MapExplorer({ events, months }: { events: SpillEvent[]; months: string[] }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [endIdx, setEndIdx] = useState(months.length - 1);
  const [windowMonths, setWindowMonths] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [surfaces, setSurfaces] = useState<Record<Surface, boolean>>({ water: true, land: true });
  const [statuses, setStatuses] = useState<Record<Status, boolean>>({
    verified: true,
    unverified: true,
    false_positive: false,
  });
  const [minConf, setMinConf] = useState(0.5);
  const [mode, setMode] = useState<Mode>("points");
  const [colorBy, setColorBy] = useState<ColorBy>("surface");
  const [base, setBase] = useState<Base>("dark");
  const [selected, setSelected] = useState<SpillEvent | null>(null);
  const [panelOpen, setPanelOpen] = useState(false); // mobile only; always shown from md up

  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  const endMonth = months[endIdx];
  const startMonth = windowMonths ? months[Math.max(0, endIdx - windowMonths + 1)] : months[0];

  const filtered = useMemo(
    () =>
      events.filter((e) => {
        const ym = e.date.slice(0, 7);
        return (
          ym >= startMonth &&
          ym <= endMonth &&
          surfaces[e.surface] &&
          statuses[e.status] &&
          e.confidence >= minConf
        );
      }),
    [events, startMonth, endMonth, surfaces, statuses, minConf],
  );
  const verifiedCount = useMemo(() => filtered.filter((e) => e.status === "verified").length, [filtered]);

  // Map setup — once.
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: DARK_STYLE,
      center: DELTA_VIEW.center,
      zoom: DELTA_VIEW.zoom,
      maxBounds: DELTA_BOUNDS,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

    map.on("load", () => {
      // Satellite sits under the labels; toggled on demand.
      const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
      map.addSource("satellite", { type: "raster", tiles: [s2Tiles(2024)], tileSize: 256, maxzoom: 16, attribution: S2_ATTR });
      map.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } }, firstSymbol);
      map.addSource("events", { type: "geojson", data: toGeoJSON([]) });
      map.addLayer({
        id: "heat",
        type: "heatmap",
        source: "events",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["ln", ["+", 1, ["get", "area_ha"]]], 0, 0.05, 6, 0.4],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 6, 18, 11, 45],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 6, 0.25, 11, 1],
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)", 0.15, "#104281", 0.35, "#1c5cab", 0.55, "#3987e5", 0.75, "#86b6ef", 1, "#ffffff",
          ],
          "heatmap-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "pts",
        type: "circle",
        source: "events",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, ["min", 7, ["+", 2, ["*", 0.12, ["sqrt", ["get", "area_ha"]]]]],
            12, ["min", 28, ["+", 5, ["*", 1, ["sqrt", ["get", "area_ha"]]]]],
          ],
          "circle-color": colorExpr("surface"),
          "circle-opacity": 0.75,
          "circle-stroke-color": C.surface,
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({
        id: "pts-selected",
        type: "circle",
        source: "events",
        filter: ["==", ["get", "id"], ""],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 9, 12, 18],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
      map.on("mousemove", "pts", (ev) => {
        const f = ev.features?.[0];
        const e = f && byId.get(f.properties.id as string);
        if (!e) return;
        map.getCanvas().style.cursor = "pointer";
        popup
          .setLngLat([e.lon, e.lat])
          .setHTML(
            `<div style="font-size:12px;line-height:1.5">
              <div style="font-weight:600">${e.site}</div>
              <div style="color:${C.ink2}">${fmtDate(e.date)} · ${e.surface === "water" ? "Water" : "Land"}</div>
              <div class="tabular">${fmt1(e.area_ha)} ha · ${fmtPct(e.confidence)} confidence</div>
            </div>`,
          )
          .addTo(map);
      });
      map.on("mouseleave", "pts", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      map.on("click", "pts", (ev) => {
        const id = ev.features?.[0]?.properties.id as string | undefined;
        if (id) setSelected(byId.get(id) ?? null);
      });
      setLoaded(true);
    });

    return () => map.remove();
  }, [byId]);

  // Data
  useEffect(() => {
    if (!loaded) return;
    (mapRef.current?.getSource("events") as GeoJSONSource | undefined)?.setData(toGeoJSON(filtered));
  }, [filtered, loaded]);

  // Styling toggles
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    map.setLayoutProperty("heat", "visibility", mode === "heat" ? "visible" : "none");
    map.setPaintProperty("pts", "circle-opacity", mode === "heat" ? 0 : 0.75);
    map.setPaintProperty("pts", "circle-stroke-width", mode === "heat" ? 0 : 1.5);
    map.setPaintProperty("pts", "circle-color", colorExpr(colorBy));
    map.setLayoutProperty("satellite", "visibility", base === "satellite" ? "visible" : "none");
  }, [mode, colorBy, base, loaded]);

  useEffect(() => {
    if (!loaded) return;
    mapRef.current?.setFilter("pts-selected", ["==", ["get", "id"], selected?.id ?? ""]);
  }, [selected, loaded]);

  // Time-lapse
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setEndIdx((i) => {
        if (i >= months.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 280);
    return () => clearInterval(t);
  }, [playing, months.length]);

  const play = () => {
    if (!playing && endIdx >= months.length - 1) setEndIdx(windowMonths ? windowMonths - 1 : 0);
    setPlaying((p) => !p);
  };

  const flyTo = (e: SpillEvent) => mapRef.current?.flyTo({ center: [e.lon, e.lat], zoom: 12, speed: 1.4 });

  return (
    <div className="relative flex-1 min-h-[560px]">
      <div className="absolute inset-0"><div ref={container} className="h-full w-full" /></div>

      {/* Control panel */}
      <button
        onClick={() => setPanelOpen((o) => !o)}
        className="absolute left-3 top-3 z-20 rounded-md border border-line bg-surface px-3 py-1.5 text-xs text-ink-2 md:hidden"
      >
        {panelOpen ? "Hide filters" : "Filters"}
      </button>
      {(
        <aside className={`card absolute left-3 top-12 z-10 ${panelOpen ? "block" : "hidden"} md:block max-h-[calc(100%-4.5rem)] w-[300px] overflow-y-auto p-4 shadow-2xl md:top-3`}>
          <div className="flex items-baseline justify-between">
            <h1 className="text-sm font-semibold">Oil spill detections</h1>
            <span className="text-xs text-muted">Sentinel-1 · Sentinel-2</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-surface-2 p-2.5">
              <div className="text-2xl font-semibold">{fmtInt(filtered.length)}</div>
              <div className="text-xs text-muted">detections</div>
            </div>
            <div className="rounded-lg bg-surface-2 p-2.5">
              <div className="text-2xl font-semibold">{fmtInt(verifiedCount)}</div>
              <div className="text-xs text-muted">human-verified</div>
            </div>
          </div>

          {/* Time */}
          <Section title="Time">
            <div className="flex items-center gap-2">
              <button
                onClick={play}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black"
                aria-label={playing ? "Pause time-lapse" : "Play time-lapse"}
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <div className="flex-1">
                <input
                  type="range"
                  min={0}
                  max={months.length - 1}
                  value={endIdx}
                  onChange={(e) => {
                    setPlaying(false);
                    setEndIdx(Number(e.target.value));
                  }}
                  className="w-full"
                  aria-label="End month"
                />
                <div className="tabular flex justify-between text-[11px] text-muted">
                  <span>{fmtMonth(startMonth)}</span>
                  <span className="text-ink">{fmtMonth(endMonth)}</span>
                </div>
              </div>
            </div>
            <Segmented
              value={windowMonths}
              onChange={setWindowMonths}
              options={WINDOWS.map((w) => ({ value: w.months, label: w.label }))}
            />
          </Section>

          <Section title="Surface">
            {(["water", "land"] as Surface[]).map((s) => (
              <Check
                key={s}
                checked={surfaces[s]}
                onChange={(v) => setSurfaces({ ...surfaces, [s]: v })}
                swatch={colorBy === "surface" ? (s === "water" ? C.water : C.land) : undefined}
                label={s === "water" ? "Water (marine, creeks)" : "Land (mangrove, farmland)"}
              />
            ))}
          </Section>

          <Section title="Status">
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <Check
                key={s}
                checked={statuses[s]}
                onChange={(v) => setStatuses({ ...statuses, [s]: v })}
                swatch={colorBy === "status" ? C.status[s] : undefined}
                label={STATUS_LABEL[s]}
              />
            ))}
          </Section>

          <Section title={`Min. model confidence · ${fmtPct(minConf)}`}>
            <input
              type="range"
              min={0.5}
              max={0.95}
              step={0.05}
              value={minConf}
              onChange={(e) => setMinConf(Number(e.target.value))}
              className="w-full"
              aria-label="Minimum confidence"
            />
          </Section>

          <Section title="Display">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "points", label: "Points" },
                { value: "heat", label: "Hotspots" },
              ]}
            />
            {mode === "points" && (
              <Segmented
                value={colorBy}
                onChange={setColorBy}
                options={[
                  { value: "surface", label: "Colour: surface" },
                  { value: "status", label: "Colour: status" },
                ]}
              />
            )}
            <Segmented
              value={base}
              onChange={setBase}
              options={[
                { value: "dark", label: "Dark map" },
                { value: "satellite", label: "Satellite" },
              ]}
            />
          </Section>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            Circle size is proportional to detected area. Hover for details, click to inspect.
          </p>
        </aside>
      )}

      {/* Detail drawer */}
      {selected && (
        <aside className="card absolute bottom-3 right-3 z-10 w-[320px] max-w-[calc(100%-1.5rem)] p-4 shadow-2xl md:bottom-auto md:top-3 md:mr-12">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs text-muted tabular">{selected.id}</div>
              <h2 className="text-base font-semibold">{selected.site}</h2>
              <div className="text-xs text-ink-2">
                {selected.lga}, {selected.state} · {fmtDate(selected.date)}
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="text-muted hover:text-ink" aria-label="Close">
              ✕
            </button>
          </div>
          <div className="mt-2">
            <StatusBadge status={selected.status} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <Stat label="Detected by" value={sourceLabel(selected.source)} />
            <Stat label="Surface" value={selected.surface === "water" ? "Water" : "Land"} />
            <Stat label="Area" value={`${fmt1(selected.area_ha)} ha`} />
            <Stat label="Confidence" value={fmtPct(selected.confidence)} />
            <Stat label="Sensors" value={selected.sensors.join(" + ")} />
            <Stat label="People within 5 km" value={fmtInt(selected.people_5km)} />
            <Stat label="Mangrove affected" value={`${fmt1(selected.mangrove_ha)} ha`} />
            <Stat
              label="In NOSDRA records"
              value={selected.nosdra_match === null ? "—" : selected.nosdra_match ? "Yes" : "No — unreported"}
            />
          </dl>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => flyTo(selected)}
              className="flex-1 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-white/5"
            >
              Zoom to
            </button>
            <Link
              href={`/events/${selected.id}/`}
              className="flex-1 rounded-md bg-white px-3 py-1.5 text-center text-sm font-medium text-black"
            >
              Full details →
            </Link>
          </div>
        </aside>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 border-t border-line pt-3">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Check({
  checked,
  onChange,
  label,
  swatch,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  swatch?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-white" />
      {swatch && <span className="h-2.5 w-2.5 rounded-full" style={{ background: swatch }} />}
      {label}
    </label>
  );
}

function Segmented<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex rounded-md bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
            value === o.value ? "bg-white text-black" : "text-ink-2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
