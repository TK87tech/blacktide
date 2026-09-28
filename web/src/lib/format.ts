const nf = new Intl.NumberFormat("en-NG");
const nf1 = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 1 });

export const fmtInt = (n: number) => nf.format(Math.round(n));
export const fmt1 = (n: number) => nf1.format(n);
export const fmtCompact = (n: number) => compact.format(n);
export const fmtPct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

export function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export function fmtMonth(ym: string) {
  return new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", {
    month: "short", year: "numeric", timeZone: "UTC",
  });
}

export const STATUS_LABEL = {
  verified: "Verified spill",
  unverified: "Unverified",
  false_positive: "False positive",
} as const;
