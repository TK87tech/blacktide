import type { SpillEvent } from "./types";

export const isSpill = (e: SpillEvent) => e.status !== "false_positive";

export function summary(events: SpillEvent[]) {
  const spills = events.filter(isSpill);
  const verified = events.filter((e) => e.status === "verified");
  return {
    detections: events.length,
    verified: verified.length,
    unverified: events.filter((e) => e.status === "unverified").length,
    falsePositives: events.length - spills.length,
    areaHa: spills.reduce((s, e) => s + e.area_ha, 0),
    mangroveHa: spills.reduce((s, e) => s + e.mangrove_ha, 0),
    unreported: verified.filter((e) => e.nosdra_match === false).length,
    water: spills.filter((e) => e.surface === "water").length,
    land: spills.filter((e) => e.surface === "land").length,
  };
}

/** Detections per year, split by surface (false positives excluded). */
export function byYear(events: SpillEvent[]) {
  const m = new Map<string, { year: string; water: number; land: number }>();
  for (const e of events.filter(isSpill)) {
    const y = e.date.slice(0, 4);
    const row = m.get(y) ?? { year: y, water: 0, land: 0 };
    row[e.surface]++;
    m.set(y, row);
  }
  return [...m.values()].sort((a, b) => a.year.localeCompare(b.year));
}

/** Events per year, split by data source. */
export function byYearSource(events: SpillEvent[]) {
  const m = new Map<string, Record<string, string | number>>();
  for (const e of events.filter(isSpill)) {
    const y = e.date.slice(0, 4);
    const row = m.get(y) ?? { year: y, cerulean: 0, nosdra: 0, blacktide: 0 };
    const k = e.source ?? "blacktide";
    row[k] = (row[k] as number) + 1;
    m.set(y, row);
  }
  return [...m.values()].sort((a, b) => String(a.year).localeCompare(String(b.year)));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Average detections per calendar month — the seasonal signal. */
export function seasonality(events: SpillEvent[]) {
  const counts = new Array(12).fill(0);
  const years = new Set<string>();
  for (const e of events.filter(isSpill)) {
    counts[Number(e.date.slice(5, 7)) - 1]++;
    years.add(e.date.slice(0, 4));
  }
  const n = Math.max(years.size, 1);
  return MONTHS.map((month, i) => ({
    month,
    avg: +(counts[i] / n).toFixed(2),
    dry: [10, 11, 0, 1, 2].includes(i),
  }));
}

export function byState(events: SpillEvent[]) {
  const m = new Map<string, { state: string; count: number; area: number }>();
  for (const e of events.filter(isSpill)) {
    const row = m.get(e.state) ?? { state: e.state, count: 0, area: 0 };
    row.count++;
    row.area += e.area_ha;
    m.set(e.state, row);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

/** Group key: LGA where known (official reports), else the site; offshore slicks by nearest place. */
export const hotspotName = (e: SpillEvent) =>
  e.site.startsWith("Offshore") || !e.lga ? e.site.replace(/^Offshore, \d+ km from /, "Offshore near ") : `${e.lga} LGA`;

export function hotspots(events: SpillEvent[], limit = 8) {
  const m = new Map<string, { site: string; lga: string; state: string; count: number; area: number; last: string }>();
  for (const e of events.filter(isSpill)) {
    const site = hotspotName(e);
    const row = m.get(site) ?? { site, lga: e.lga, state: e.state, count: 0, area: 0, last: e.date };
    row.count++;
    row.area += e.area_ha;
    if (e.date > row.last) row.last = e.date;
    m.set(site, row);
  }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/** Every YYYY-MM from first to last event, inclusive. */
export function monthRange(events: SpillEvent[]): string[] {
  if (!events.length) return [];
  const dates = events.map((e) => e.date).sort();
  let [y, m] = dates[0].slice(0, 7).split("-").map(Number);
  const [ey, em] = dates[dates.length - 1].slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (m === 12) {
      y += 1;
      m = 1;
    } else {
      m += 1;
    }
  }
  return out;
}
