import { STATUS_LABEL } from "@/lib/format";
import type { Status } from "@/lib/types";

// Status colour always ships with an icon + label, never colour alone.
const ICON: Record<Status, string> = { verified: "●", unverified: "◐", false_positive: "○" };
const CLS: Record<Status, string> = {
  verified: "text-st-verified border-st-verified/40 bg-st-verified/10",
  unverified: "text-st-unverified border-st-unverified/40 bg-st-unverified/10",
  false_positive: "text-st-fp border-st-fp/40 bg-st-fp/10",
};

export default function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${CLS[status]}`}>
      <span aria-hidden>{ICON[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}
