import MapExplorer from "@/components/MapExplorer";
import { getEvents } from "@/lib/data";
import { monthRange } from "@/lib/stats";

export default function Home() {
  const events = getEvents();
  return <MapExplorer events={events} months={monthRange(events)} />;
}
