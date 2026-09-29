import { Suspense } from "react";
import EventView from "@/components/EventView";
import Loading from "@/components/Loading";

export const metadata = { title: "Event — BlackTide" };

export default function EventPage() {
  return (
    <Suspense fallback={<Loading />}>
      <EventView />
    </Suspense>
  );
}
