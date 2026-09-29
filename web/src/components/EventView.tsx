"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import Card from "@/components/Card";
import EventMap from "@/components/EventMap";
import Loading from "@/components/Loading";
import StatusBadge from "@/components/StatusBadge";
import { fmt1, fmtDate, fmtInt, fmtPct, sourceLabel } from "@/lib/format";
import type { SpillEvent } from "@/lib/types";
import { eventHref, useEvents } from "@/lib/useEvents";

// What each feature means and which direction points towards oil.
const SIGNATURE: { key: keyof SpillEvent["features"]; label: string; unit: string; hint: string }[] = [
  { key: "vv_db", label: "VV backscatter", unit: "dB", hint: "Oil damps surface ripples → darker (more negative) radar return" },
  { key: "vh_db", label: "VH backscatter", unit: "dB", hint: "Cross-polarised return, also reduced over slicks" },
  { key: "vv_vh_db", label: "VV/VH ratio", unit: "dB", hint: "Separates oil from look-alikes such as calm water" },
  { key: "glcm_entropy", label: "GLCM entropy", unit: "", hint: "Texture: slicks are smoother (lower entropy) than open water" },
  { key: "ndvi_delta", label: "NDVI change (yr/yr)", unit: "", hint: "Negative = vegetation die-back, typical of land spills" },
  { key: "ndwi", label: "NDWI", unit: "", hint: "Positive over water, negative over vegetation/soil" },
  { key: "osi", label: "Oil Spill Index", unit: "", hint: "(Green + Red) / Blue — higher over oil-coated surfaces" },
];

const IMPACT_TEXT: Record<string, { tone: string; text: string }> = {
  "clear vegetation damage": {
    tone: "text-st-verified",
    text: "Vegetation at the site died back clearly more than its surroundings after the incident (dry season before vs after). Only about 1% of random, spill-free land shows a change this strong.",
  },
  "possible damage": {
    tone: "text-st-unverified",
    text: "Vegetation at the site declined somewhat more than its surroundings. Could be spill damage, or ordinary variation.",
  },
  "not visible": {
    tone: "text-ink-2",
    text: "No clear change at 10–20 m resolution. Most reported spills are small (median ~3 barrels), cleaned up quickly, or their coordinates are approximate — so this doesn't mean nothing happened.",
  },
  "no clear imagery": {
    tone: "text-muted",
    text: "Cloud hid the site in one of the dry seasons, so it couldn't be checked.",
  },
  pending: {
    tone: "text-muted",
    text: "The satellite check for this report is still being computed and will appear in the next update.",
  },
};

function distKm(a: SpillEvent, b: SpillEvent) {
  const dx = (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  const dy = (a.lat - b.lat) * 110.54;
  return Math.hypot(dx, dy);
}

export default function EventView() {
  const id = useSearchParams().get("id") ?? "";
  const { events, error } = useEvents();
  const e = useMemo(() => events?.find((x) => x.id === id), [events, id]);
  const nearby = useMemo(
    () =>
      e && events
        ? events
            .filter((x) => x.id !== e.id && x.status !== "false_positive")
            .map((x) => ({ x, d: distKm(e, x) }))
            .filter(({ d }) => d <= 5)
            .sort((a, b) => b.x.date.localeCompare(a.x.date))
            .slice(0, 10)
        : [],
    [e, events],
  );

  if (!events) return <Loading error={error} />;
  if (!e) return <Loading label={`No event with id “${id}”.`} />;

  const reported = e.source === "nosdra";
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <Link href="/events/" className="text-sm text-ink-2 hover:text-ink">← All events</Link>
      <header className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="tabular text-xs text-muted">{e.id}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{e.site}</h1>
          <p className="text-sm text-ink-2">
            {[e.lga && `${e.lga} LGA`, e.state && e.state !== "Offshore" ? `${e.state} State` : e.state].filter(Boolean).join(", ")}
            {" · "}
            {reported ? "incident" : "detected"} {fmtDate(e.date)}
          </p>
        </div>
        <StatusBadge status={e.status} label={reported ? "Official report" : undefined} />
      </header>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EventMap lon={e.lon} lat={e.lat} date={e.date} surface={e.surface} areaHa={e.area_ha} />
        </div>
        <Card title="Summary">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
            <Item label="Source" value={sourceLabel(e.source)} />
            <Item label="Surface" value={reported ? e.habitat ?? "—" : e.surface === "water" ? "Water" : "Land"} />
            {reported ? (
              <>
                <Item label="Operator" value={e.operator || "—"} />
                <Item label="Cause (reported)" value={e.cause || "—"} />
                <Item label="Volume (reported)" value={e.volume_bbl != null ? `${fmt1(e.volume_bbl)} bbl` : "—"} />
                <Item label="Area (reported)" value={e.area_ha ? `${fmt1(e.area_ha)} ha` : "—"} />
                <Item label="Incident no." value={e.incident_number ?? "—"} />
              </>
            ) : (
              <>
                <Item label="Detected area" value={`${fmt1(e.area_ha)} ha`} />
                <Item label="Model confidence" value={fmtPct(e.confidence, 1)} />
                <Item label="Sensors" value={e.sensors.map((s) => (s === "S1" ? "Sentinel-1" : "Sentinel-2")).join(", ")} />
                <Item label="People within 5 km" value={fmtInt(e.people_5km)} />
                <Item label="Mangrove affected" value={`${fmt1(e.mangrove_ha)} ha`} />
              </>
            )}
            <Item label="Coordinates" value={`${e.lat.toFixed(4)}, ${e.lon.toFixed(4)}`} />
          </dl>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {reported ? (
          <Card title="Satellite check" desc="Did the reported spill leave visible damage?" className="lg:col-span-2">
            {e.sat_impact ? (
              <>
                <p className={`text-base font-semibold capitalize ${IMPACT_TEXT[e.sat_impact].tone}`}>{e.sat_impact}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{IMPACT_TEXT[e.sat_impact].text}</p>
                {e.sat_local_dndvi != null && (
                  <p className="tabular mt-2 text-xs text-muted">
                    Local NDVI change {e.sat_local_dndvi > 0 ? "+" : ""}
                    {e.sat_local_dndvi.toFixed(3)} (site vs 300–1000 m ring) · radar VH {e.sat_local_dvh != null ? `${e.sat_local_dvh > 0 ? "+" : ""}${e.sat_local_dvh.toFixed(2)} dB` : "—"}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-2">
                {e.surface === "water"
                  ? "Water incidents aren't scored — oil on water doesn't leave a lasting mark. Use the radar imagery above for the incident date."
                  : "Not scored: the incident is outside the Sentinel-2 period covered by the check (Apr 2017 – Oct 2025)."}
              </p>
            )}
            <p className="mt-3 text-xs text-muted">
              Official report from the National Oil Spill Detection and Response Agency (NOSDRA), based on the Joint
              Investigation Visit.{" "}
              <a href={e.source_url} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                Nigerian Oil Spill Monitor ↗
              </a>
            </p>
          </Card>
        ) : e.source === "cerulean" ? (
          <Card title="Source" desc="This marine detection comes from SkyTruth Cerulean" className="lg:col-span-2">
            <p className="text-sm leading-relaxed text-ink-2">
              Cerulean runs a deep-learning slick detector on every Sentinel-1 radar pass and has part of its
              detections reviewed by people.{" "}
              {e.cause
                ? `A reviewer attributed this slick to: ${e.cause}.`
                : e.status === "verified"
                  ? "It was reviewed by a person."
                  : "This one is a machine detection that hasn't been reviewed yet."}
            </p>
            {e.source_url && (
              <a href={e.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black">
                View the slick outline on Cerulean ↗
              </a>
            )}
          </Card>
        ) : (
          <Card title="Spectral & radar signature" desc="Feature values the model saw for this event" className="lg:col-span-2">
            <table className="w-full text-sm">
              <tbody>
                {SIGNATURE.map((f) => {
                  const v = e.features[f.key];
                  return (
                    <tr key={f.key} className="border-b border-line/50 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">{f.label}</td>
                      <td className="tabular py-2 pr-3 text-right whitespace-nowrap">{v === null ? "—" : `${v} ${f.unit}`}</td>
                      <td className="py-2 text-xs text-ink-2">{f.hint}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
        <Card title="Other events within 5 km" desc="Recurring spills at the same place often point to chronic leaks or repeat theft">
          {nearby.length ? (
            <ul className="space-y-2 text-sm">
              {nearby.map(({ x, d }) => (
                <li key={x.id} className="flex justify-between gap-2">
                  <Link href={eventHref(x.id)} className="text-ink-2 hover:text-ink">
                    {fmtDate(x.date)} <span className="text-xs text-muted">· {sourceLabel(x.source)}</span>
                  </Link>
                  <span className="tabular text-xs text-muted">{d.toFixed(1)} km</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">None — this looks like an isolated event.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
