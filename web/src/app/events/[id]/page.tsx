import Link from "next/link";
import { notFound } from "next/navigation";
import Card from "@/components/Card";
import EventMap from "@/components/EventMap";
import StatusBadge from "@/components/StatusBadge";
import { getEvents } from "@/lib/data";
import { fmt1, fmtDate, fmtInt, fmtPct } from "@/lib/format";
import type { SpillEvent } from "@/lib/types";

export const dynamicParams = false;

export function generateStaticParams() {
  return getEvents().map((e) => ({ id: e.id }));
}

export async function generateMetadata({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  return { title: `${id} — BlackTide` };
}

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

function distKm(a: SpillEvent, b: SpillEvent) {
  const dx = (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  const dy = (a.lat - b.lat) * 110.54;
  return Math.hypot(dx, dy);
}

export default async function EventPage({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  const events = getEvents();
  const e = events.find((x) => x.id === id);
  if (!e) notFound();

  const nearby = events
    .filter((x) => x.id !== e.id && x.status !== "false_positive")
    .map((x) => ({ x, d: distKm(e, x) }))
    .filter(({ d }) => d <= 5)
    .sort((a, b) => b.x.date.localeCompare(a.x.date))
    .slice(0, 8);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <Link href="/events/" className="text-sm text-ink-2 hover:text-ink">← All events</Link>
      <header className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="tabular text-xs text-muted">{e.id}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{e.site}</h1>
          <p className="text-sm text-ink-2">
            {e.lga} LGA, {e.state} State · detected {fmtDate(e.date)}
          </p>
        </div>
        <StatusBadge status={e.status} />
      </header>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EventMap lon={e.lon} lat={e.lat} year={Number(e.date.slice(0, 4))} areaHa={e.area_ha} />
        </div>
        <Card title="Summary">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
            <Item label="Surface" value={e.surface === "water" ? "Water" : "Land"} />
            <Item label="Detected area" value={`${fmt1(e.area_ha)} ha`} />
            <Item label="Model confidence" value={fmtPct(e.confidence, 1)} />
            <Item label="Sensors" value={e.sensors.map((s) => (s === "S1" ? "Sentinel-1" : "Sentinel-2")).join(", ")} />
            <Item label="People within 5 km" value={fmtInt(e.people_5km)} />
            <Item label="Mangrove affected" value={`${fmt1(e.mangrove_ha)} ha`} />
            <Item label="NOSDRA record" value={e.nosdra_match === null ? "Not checked" : e.nosdra_match ? "Matched" : "None found"} />
            <Item label="Coordinates" value={`${e.lat.toFixed(4)}, ${e.lon.toFixed(4)}`} />
          </dl>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>Confidence</span>
              <span className="tabular">{fmtPct(e.confidence)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-white" style={{ width: fmtPct(e.confidence) }} />
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card title="Spectral & radar signature" desc="Feature values the model saw for this event" className="lg:col-span-2">
          <table className="w-full text-sm">
            <tbody>
              {SIGNATURE.map((f) => {
                const v = e.features[f.key];
                return (
                  <tr key={f.key} className="border-b border-line/50 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{f.label}</td>
                    <td className="tabular py-2 pr-3 text-right whitespace-nowrap">
                      {v === null ? "—" : `${v} ${f.unit}`}
                    </td>
                    <td className="py-2 text-xs text-ink-2">{f.hint}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Other detections within 5 km" desc="Recurring spills at the same place often point to chronic leaks or repeat theft">
          {nearby.length ? (
            <ul className="space-y-2 text-sm">
              {nearby.map(({ x, d }) => (
                <li key={x.id} className="flex justify-between gap-2">
                  <Link href={`/events/${x.id}/`} className="text-ink-2 hover:text-ink">
                    {fmtDate(x.date)}
                  </Link>
                  <span className="tabular text-xs text-muted">
                    {fmt1(x.area_ha)} ha · {d.toFixed(1)} km
                  </span>
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
