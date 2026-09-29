import { CDSE_INSTANCE, type ImageryLayer } from "./imagery";

export interface Pass {
  date: string;
  /** Share of the view (0–1) covered by that day's acquisitions. */
  cover: number;
  /** Sentinel-2 only: lowest scene cloud cover that day, percent. */
  cloud: number | null;
}

type Bbox = [number, number, number, number]; // west, south, east, north
type Ring = [number, number][];

// Sutherland–Hodgman: clip a polygon ring to the view rectangle.
function clip(ring: Ring, [w, s, e, n]: Bbox): Ring {
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [(p) => p[0] >= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= e, (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= s, (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s]],
    [(p) => p[1] <= n, (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n]],
  ];
  let out = ring;
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) {
        out.push(cross(prev, cur));
      }
    }
    if (!out.length) break;
  }
  return out;
}

const area = (r: Ring) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

function rings(geom: { type: string; coordinates: unknown }): Ring[] {
  if (geom.type === "Polygon") return [(geom.coordinates as Ring[])[0]];
  if (geom.type === "MultiPolygon") return (geom.coordinates as Ring[][]).map((p) => p[0]);
  return [];
}

function shift(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Acquisition dates near `date` for the current view, from the CDSE WFS catalogue
 * (public, no login). Radar = DSS3 (Sentinel-1 GRD), optical = DSS2 (Sentinel-2 L2A).
 */
export async function fetchPasses(layer: ImageryLayer, bbox: Bbox, date: string, days = 30, signal?: AbortSignal): Promise<Pass[]> {
  const radar = layer.group.startsWith("Radar");
  const params = new URLSearchParams({
    SERVICE: "WFS", REQUEST: "GetFeature", TYPENAMES: radar ? "DSS3" : "DSS2", SRSNAME: "EPSG:4326",
    BBOX: [bbox[1], bbox[0], bbox[3], bbox[2]].join(","), // WFS 1.x + EPSG:4326 = lat,lon order
    TIME: `${shift(date, -days)}/${shift(date, days)}`, OUTPUTFORMAT: "application/json", MAXFEATURES: "300",
  });
  const res = await fetch(`https://sh.dataspace.copernicus.eu/ogc/wfs/${CDSE_INSTANCE}?${params}`, { signal });
  if (!res.ok) throw new Error(`WFS ${res.status}`);
  const fc = (await res.json()) as { features: { geometry: { type: string; coordinates: unknown }; properties: { date: string; cloudCoverPercentage?: number } }[] };

  const viewArea = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
  const byDate = new Map<string, { cover: number; cloud: number | null }>();
  for (const f of fc.features) {
    const covered = rings(f.geometry).reduce((a, r) => a + area(clip(r, bbox)), 0) / viewArea;
    const cur = byDate.get(f.properties.date) ?? { cover: 0, cloud: null };
    cur.cover = Math.min(1, cur.cover + covered); // overlapping footprints can double-count; capped
    const cc = f.properties.cloudCoverPercentage;
    if (cc != null) cur.cloud = cur.cloud == null ? cc : Math.min(cur.cloud, cc);
    byDate.set(f.properties.date, cur);
  }
  return [...byDate.entries()]
    .map(([d, v]) => ({ date: d, cover: v.cover, cloud: v.cloud }))
    .filter((p) => p.cover > 0.02)
    .sort((a, b) => a.date.localeCompare(b.date));
}
