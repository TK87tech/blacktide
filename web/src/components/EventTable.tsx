"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmt1, fmtDate, STATUS_LABEL } from "@/lib/format";
import type { SpillEvent, Status } from "@/lib/types";
import Loading from "./Loading";
import StatusBadge from "./StatusBadge";
import { eventHref, useEvents } from "@/lib/useEvents";
import { SOURCE_LABEL, sourceLabel } from "@/lib/format";

type SortKey = "date" | "area_ha" | "confidence" | "site";
const PAGE = 25;

export default function EventTable() {
  const { events, error } = useEvents();
  if (!events) return <Loading error={error} />;
  return <Table events={events} />;
}

function Table({ events }: { events: SpillEvent[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const [state, setState] = useState("all");
  const [surface, setSurface] = useState<"all" | "water" | "land">("all");
  const [source, setSource] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });
  const [page, setPage] = useState(0);

  const states = useMemo(() => [...new Set(events.map((e) => e.state))].sort(), [events]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events
      .filter(
        (e) =>
          (status === "all" || e.status === status) &&
          (state === "all" || e.state === state) &&
          (surface === "all" || e.surface === surface) &&
          (source === "all" || (e.source ?? "blacktide") === source) &&
          (!needle || `${e.id} ${e.site} ${e.lga} ${e.state}`.toLowerCase().includes(needle)),
      )
      .sort((a, b) => {
        const av = a[sort.key], bv = b[sort.key];
        return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
      });
  }, [events, q, status, state, surface, source, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);

  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(0);
  };

  const downloadCsv = () => {
    const cols = ["id", "date", "source", "site", "lga", "state", "surface", "area_ha", "status", "cause", "operator", "volume_bbl", "sat_impact", "lat", "lon"] as const;
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "blacktide-events.csv" });
    a.click();
    URL.revokeObjectURL(url);
  };

  const th = (key: SortKey, label: string, right = false) => (
    <th className={`py-2 font-medium ${right ? "text-right" : ""}`}>
      <button
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))}
        className="hover:text-ink"
      >
        {label} {sort.key === key ? (sort.dir === -1 ? "↓" : "↑") : ""}
      </button>
    </th>
  );

  const select = "rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink-2";

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => reset(setQ)(e.target.value)}
          placeholder="Search ID, site, LGA…"
          className="min-w-[200px] flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-muted"
        />
        <select value={status} onChange={(e) => reset(setStatus)(e.target.value as Status | "all")} className={select}>
          <option value="all">All statuses</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select value={state} onChange={(e) => reset(setState)(e.target.value)} className={select}>
          <option value="all">All states</option>
          {states.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={surface} onChange={(e) => reset(setSurface)(e.target.value as "all" | "water" | "land")} className={select}>
          <option value="all">Water + land</option>
          <option value="water">Water</option>
          <option value="land">Land</option>
        </select>
        <select value={source} onChange={(e) => reset(setSource)(e.target.value)} className={select}>
          <option value="all">All sources</option>
          {Object.entries(SOURCE_LABEL).filter(([k]) => events.some((e) => (e.source ?? "blacktide") === k)).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button onClick={downloadCsv} className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-white/5">
          Export CSV
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted [&>th]:px-3">
              <th className="py-2 font-medium">ID</th>
              {th("date", "Date")}
              {th("site", "Location")}
              <th className="py-2 font-medium">Surface</th>
              {th("area_ha", "Area (ha)", true)}
              <th className="py-2 font-medium">Source</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="tabular [&_td]:px-3">
            {view.map((e) => (
              <tr key={e.id} className="border-b border-line/50 hover:bg-white/[0.03]">
                <td className="py-2">
                  <Link href={eventHref(e.id)} className="text-ink-2 underline decoration-line underline-offset-2 hover:text-ink">
                    {e.id}
                  </Link>
                </td>
                <td className="py-2 text-ink-2">{fmtDate(e.date)}</td>
                <td className="py-2">
                  {e.site} <span className="text-xs text-muted">· {e.state}</span>
                </td>
                <td className="py-2">
                  <span className="inline-flex items-center gap-1.5 text-ink-2">
                    <span className={`h-2 w-2 rounded-full ${e.surface === "water" ? "bg-water" : "bg-land"}`} />
                    {e.surface === "water" ? "Water" : "Land"}
                  </span>
                </td>
                <td className="py-2 text-right">{fmt1(e.area_ha)}</td>
                <td className="py-2 text-ink-2">
                  {sourceLabel(e.source)}
                  {e.sat_impact === "clear vegetation damage" && <span className="ml-1 text-xs text-st-verified" title="Satellite shows clear vegetation damage">● visible</span>}
                </td>
                <td className="py-2"><StatusBadge status={e.status} label={e.source === "nosdra" ? "Official report" : undefined} /></td>
              </tr>
            ))}
            {!view.length && (
              <tr><td colSpan={7} className="py-8 text-center text-muted">No events match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-ink-2">
        <span className="tabular">{rows.length} events</span>
        <div className="flex items-center gap-2">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border border-line px-2 py-1 disabled:opacity-30">←</button>
          <span className="tabular">{page + 1} / {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="rounded border border-line px-2 py-1 disabled:opacity-30">→</button>
        </div>
      </div>
    </div>
  );
}
