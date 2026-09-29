import Link from "next/link";
import Card from "@/components/Card";
import { SeasonChart, StateChart, YearlyChart } from "@/components/charts";
import { getEvents, getMeta } from "@/lib/data";
import { fmtCompact, fmtDate, fmtInt, fmtPct } from "@/lib/format";
import { byState, byYearSource, hotspots, seasonality, summary } from "@/lib/stats";
import { C } from "@/lib/theme";

export const metadata = { title: "Dashboard — BlackTide" };

export default function Dashboard() {
  const events = getEvents();
  const meta = getMeta();
  const s = summary(events);
  const cer = events.filter((e) => e.source === "cerulean");
  const nos = events.filter((e) => e.source === "nosdra");
  const nosLand = nos.filter((e) => e.surface === "land");
  const scored = nosLand.filter((e) => e.sat_impact && e.sat_impact !== "no clear imagery" && e.sat_impact !== "pending");
  const visible = scored.filter((e) => e.sat_impact === "clear vegetation damage");
  const barrels = nos.reduce((a, e) => a + (e.volume_bbl ?? 0), 0);
  const coverageNote =
    "Official reports (NOSDRA) cover land, swamp and creeks; SkyTruth Cerulean's marine coverage expanded sharply in 2023, so earlier marine years are incomplete.";
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
          <p className="text-xs text-muted">{meta.source}</p>
        </div>
        <p className="text-xs text-muted">Updated {fmtDate(meta.generated_at.slice(0, 10))} · model {meta.model_version}</p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Events"
          value={fmtInt(s.detections)}
          sub={`${fmtInt(nos.length)} official reports · ${fmtInt(cer.length)} marine slicks`}
        />
        <Tile
          label="Land, swamp & creek reports"
          value={fmtInt(nosLand.length + nos.filter((e) => e.habitat?.startsWith("Inland water")).length)}
          sub={`${fmtPct(nos.filter((e) => e.cause?.startsWith("Sabotage")).length / Math.max(nos.length, 1))} attributed to sabotage / theft`}
        />
        <Tile
          label="Visible from space"
          value={scored.length ? fmtPct(visible.length / scored.length) : "—"}
          sub={
            scored.length
              ? `${fmtInt(visible.length)} of ${fmtInt(scored.length)} checked land reports show clear vegetation damage`
              : "satellite check of reported land spills in progress — 23% in the pilot test"
          }
        />
        <Tile
          label="Oil reported spilled"
          value={`${fmtCompact(barrels)} bbl`}
          sub={`across official reports · ${fmtInt(cer.filter((e) => e.status === "verified").length)} marine slicks reviewed by people`}
        />
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Spills per year" desc={coverageNote}>
          <YearlyChart
            data={byYearSource(events)}
            series={[
              { key: "nosdra", label: "Official reports (NOSDRA)", color: C.source.nosdra },
              { key: "cerulean", label: "Marine slicks (Cerulean)", color: C.source.cerulean },
              ...(events.some((e) => !e.source || e.source === "blacktide")
                ? [{ key: "blacktide", label: "BlackTide", color: C.source.blacktide }]
                : []),
            ]}
          />
        </Card>
        <Card
          title="Seasonality"
          desc={`Average events per calendar month. Dry-season months (Nov–Mar) average ${(dryAvg / Math.max(wetAvg, 0.01)).toFixed(1)}× the wet-season months.`}
        >
          <SeasonChart data={season} />
        </Card>
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-5">
        <Card title="By state" desc="All events; offshore reports and slicks are grouped by the nearest state" className="lg:col-span-2">
          <StateChart data={byState(events)} />
        </Card>
        <Card title="Hotspots" desc="LGAs and offshore areas with the most events" className="lg:col-span-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 font-medium">Location</th>
                  <th className="py-2 font-medium">State</th>
                  <th className="py-2 text-right font-medium">Events</th>
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
