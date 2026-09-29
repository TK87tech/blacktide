import EventTable from "@/components/EventTable";

export const metadata = { title: "Events — BlackTide" };

export default function EventsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Oil spill events</h1>
      <p className="mb-4 text-sm text-ink-2">
        Marine slicks detected by SkyTruth Cerulean and official spill reports from NOSDRA, with a satellite check of
        reported land spills.
      </p>
      <EventTable />
    </div>
  );
}
