import Link from "next/link";
import Card from "@/components/Card";
import { SeasonChart, StateChart, YearlyChart } from "@/components/charts";
import { getEvents, getMeta } from "@/lib/data";
import { fmtCompact, fmtDate, fmtInt, fmtPct } from "@/lib/format";
import { byState, byYear, hotspots, seasonality, summary } from "@/lib/stats";

export const metadata = { title: "Dashboard — BlackTide" };

export default function Dashboard() {
  const events = getEvents();
  const meta = getMeta();
  const s = summary(events);
  const season = seasonality(events);
  const dryAvg = season.filter((m) => m.dry).reduce((a, m) => a + m.avg, 0) / 5;
  const wetAvg = season.filter((m) => !m.dry).reduce((a, m) => a + m.avg, 0) / 7;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Regional overview</h1>
          <p className="text-sm text-ink-2">
            {meta.aoi} · {fmtDate(meta.period_start)} – {fmtDate(meta.period_end)}
          </p>
        </div>
        <p className="text-xs text-muted">Updated {fmtDate(meta.generated_at.slice(0, 10))} · model {meta.model_version}</p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Detections" value={fmtInt(s.detections)} sub={`${fmtInt(s.falsePositives)} ruled out as false positives`} />
        <Tile
          label="Verified spills"
          value={fmtInt(s.verified)}
          sub={`${fmtPct(s.verified / Math.max(s.detections, 1))} of detections · ${fmtInt(s.unverified)} awaiting review`}
        />
        <Tile label="Area affected" value={`${fmtCompact(s.areaHa)} ha`} sub={`incl. ${fmtCompact(s.mangroveHa)} ha of mangrove`} />
        <Tile
          label="Not in official records"
          value={fmtInt(s.unreported)}
          sub="verified spills with no matching NOSDRA report"
        />
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Spills per year" desc="Verified and unverified detections, by surface">
          <YearlyChart data={byYear(events)} />
        </Card>
        <Card
          title="Seasonality"
          desc={`Dry-season months average ${(dryAvg / Math.max(wetAvg, 0.01)).toFixed(1)}× the detections of wet-season months`}
        >
          <SeasonChart data={season} />
        </Card>
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-5">
        <Card title="By state" desc="Detections, excluding false positives" className="lg:col-span-2">
          <StateChart data={byState(events)} />
        </Card>
        <Card title="Hotspots" desc="Locations with the most recurring detections" className="lg:col-span-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 font-medium">Location</th>
                  <th className="py-2 font-medium">State</th>
                  <th className="py-2 text-right font-medium">Detections</th>
                  <th className="py-2 text-right font-medium">Area (ha)</th>
                  <th className="py-2 text-right font-medium">Latest</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {hotspots(events).map((h) => (
                  <tr key={h.site} className="border-b border-line/50">
                    <td className="py-2">
                      <div>{h.site}</div>
                      <div className="text-xs text-muted">{h.lga}</div>
                    </td>
                    <td className="py-2 text-ink-2">{h.state}</td>
                    <td className="py-2 text-right">{h.count}</td>
                    <td className="py-2 text-right text-ink-2">{fmtInt(h.area)}</td>
                    <td className="py-2 text-right text-ink-2">{fmtDate(h.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link href="/events/" className="mt-3 inline-block text-sm text-ink-2 hover:text-ink">
            Browse all events →
          </Link>
        </Card>
      </section>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-ink-2">{sub}</div>
    </div>
  );
}
