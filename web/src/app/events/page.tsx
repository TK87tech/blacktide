import EventTable from "@/components/EventTable";
import { getEvents } from "@/lib/data";

export const metadata = { title: "Events — BlackTide" };

export default function EventsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Detected events</h1>
      <p className="mb-4 text-sm text-ink-2">
        Every contiguous area the model flagged as likely oil contamination. Unverified events await analyst or field review.
      </p>
      <EventTable events={getEvents()} />
    </div>
  );
}
