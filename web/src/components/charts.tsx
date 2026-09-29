"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { fmt1, fmtInt } from "@/lib/format";
import { C } from "@/lib/theme";

const axis = { stroke: C.axis, tick: { fill: C.muted, fontSize: 11 }, tickLine: false } as const;

type Row = { name?: string; value?: number | string; color?: string; dataKey?: string | number };

function Tip({ active, payload, label, unit, labelFmt }: Partial<TooltipContentProps> & { unit?: string; labelFmt?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  const rows = payload as unknown as Row[];
  const total = rows.reduce((s, r) => s + Number(r.value ?? 0), 0);
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-ink">{labelFmt ? labelFmt(String(label)) : label}</div>
      {rows.map((r) => (
        <div key={String(r.dataKey)} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
          <span className="flex-1">{r.name}</span>
          <span className="tabular text-ink">
            {typeof r.value === "number" && !Number.isInteger(r.value) ? fmt1(r.value) : fmtInt(Number(r.value))}
            {unit}
          </span>
        </div>
      ))}
      {rows.length > 1 && (
        <div className="mt-1 flex border-t border-line pt-1 text-ink-2">
          <span className="flex-1">Total</span>
          <span className="tabular text-ink">{fmtInt(total)}</span>
        </div>
      )}
    </div>
  );
}

function LegendRow({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-2 flex gap-4 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function YearlyChart({
  data,
  series = [
    { key: "water", label: "Water", color: C.water },
    { key: "land", label: "Land", color: C.land },
  ],
}: {
  data: Record<string, string | number>[];
  series?: { key: string; label: string; color: string }[];
}) {
  return (
    <div>
      <LegendRow items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis dataKey="year" {...axis} />
          <YAxis {...axis} axisLine={false} allowDecimals={false} />
          <Tooltip content={<Tip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="s"
              fill={s.color}
              stroke={C.surface}
              strokeWidth={2}
              maxBarSize={36}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SeasonChart({ data }: { data: { month: string; avg: number }[] }) {
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-white/10" />
          Dry season (Nov–Mar)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <ReferenceArea x1="Jan" x2="Mar" fill="#ffffff" fillOpacity={0.05} />
          <ReferenceArea x1="Nov" x2="Dec" fill="#ffffff" fillOpacity={0.05} />
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis dataKey="month" {...axis} />
          <YAxis {...axis} axisLine={false} />
          <Tooltip content={<Tip unit=" / yr" />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="avg" name="Avg. detections" fill={C.water} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StateChart({ data }: { data: { state: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 10 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="state" {...axis} axisLine={false} width={80} />
        <Tooltip content={<Tip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Bar
          dataKey="count"
          name="Detections"
          fill={C.water}
          radius={[0, 4, 4, 0]}
          barSize={20}
          label={{ position: "right", fill: C.ink2, fontSize: 11 }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ImportanceChart({ data }: { data: { feature: string; importance: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={data.length * 30 + 10}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 10 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="feature" {...axis} axisLine={false} width={120} />
        <Tooltip content={<Tip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Bar
          dataKey="importance"
          name="Importance"
          fill={C.water}
          radius={[0, 4, 4, 0]}
          barSize={16}
          label={{ position: "right", fill: C.ink2, fontSize: 11, formatter: (v: unknown) => Number(v).toFixed(2) }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PRChart({ series }: { series: { name: string; points: { recall: number; precision: number }[] }[] }) {
  const colors = [C.water, C.land];
  // Merge onto a shared recall axis.
  const map = new Map<number, Record<string, number>>();
  series.forEach((s, i) =>
    s.points.forEach((p) => {
      const row = map.get(p.recall) ?? { recall: p.recall };
      row[`s${i}`] = p.precision;
      map.set(p.recall, row);
    }),
  );
  const data = [...map.values()].sort((a, b) => a.recall - b.recall);
  return (
    <div>
      <LegendRow items={series.map((s, i) => ({ label: s.name, color: colors[i] }))} />
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 16, left: -12 }}>
          <CartesianGrid stroke={C.grid} />
          <XAxis
            dataKey="recall"
            type="number"
            domain={[0, 1]}
            {...axis}
            label={{ value: "Recall", fill: C.muted, fontSize: 11, position: "insideBottom", offset: -8 }}
          />
          <YAxis domain={[0, 1]} {...axis} axisLine={false} />
          <Tooltip
            content={<Tip labelFmt={(l) => `Recall ${Number(l).toFixed(2)}`} />}
            cursor={{ stroke: C.axis }}
          />
          <Legend content={() => null} />
          {series.map((s, i) => (
            <Line
              key={s.name}
              dataKey={`s${i}`}
              name={s.name}
              stroke={colors[i]}
              strokeWidth={2}
              dot={false}
              connectNulls
              activeDot={{ r: 4, stroke: C.surface, strokeWidth: 2 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
