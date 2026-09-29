// Live Sentinel-1 / Sentinel-2 layers from the Copernicus Data Space Ecosystem (free).
// Band math lives in pipeline/sentinelhub/*.js, configured as layers of this instance.
export const CDSE_INSTANCE = process.env.NEXT_PUBLIC_CDSE_INSTANCE || "413c2eb7-950d-42c4-8eba-9a794b4a1bcd";

export interface ImageryLayer {
  id: string;
  label: string;
  group: "Radar (Sentinel-1)" | "Optical (Sentinel-2)";
  legend: string;
  /** Days either side of the chosen date to search. Radar: that day's pass only; optical: wider, for cloud. */
  windowDays: number;
}

export const IMAGERY_LAYERS: ImageryLayer[] = [
  { id: "S1_VV", label: "Radar VV", group: "Radar (Sentinel-1)", windowDays: 0,
    legend: "Oil damps the sea surface: slicks show as dark streaks. Calm water and rain cells also go dark." },
  { id: "S1_SLICK", label: "Radar — slick highlight", group: "Radar (Sentinel-1)", windowDays: 0,
    legend: "Pixels darker than −22 dB tinted magenta. Look for long, thin shapes trailing from a source." },
  { id: "S1_FALSE_COLOR", label: "Radar false colour", group: "Radar (Sentinel-1)", windowDays: 0,
    legend: "R = VV, G = VH, B = VV/VH. Slicks are dark; land and vegetation green-yellow." },
  { id: "S2_TRUE_COLOR", label: "True colour", group: "Optical (Sentinel-2)", windowDays: 20,
    legend: "Natural colour. Sheen can show as silvery or rainbow patches; clouds block the view." },
  { id: "S2_SWIR", label: "SWIR false colour", group: "Optical (Sentinel-2)", windowDays: 20,
    legend: "Healthy vegetation bright green; dead, oiled or burnt vegetation brown to black." },
  { id: "S2_NDVI", label: "NDVI (vegetation)", group: "Optical (Sentinel-2)", windowDays: 20,
    legend: "Green = healthy vegetation, brown = bare or dying, blue = water." },
  { id: "S2_NDWI", label: "NDWI (water)", group: "Optical (Sentinel-2)", windowDays: 20,
    legend: "Blue = open water, tan = land." },
  { id: "S2_MNDWI", label: "MNDWI (water)", group: "Optical (Sentinel-2)", windowDays: 20,
    legend: "Water vs land, less confused by soil and towns than NDWI." },
  { id: "S2_OSI", label: "Oil Spill Index", group: "Optical (Sentinel-2)", windowDays: 20,
    legend: "(Green + Red) / Blue. Yellow–red = high, possible oil; haze and muddy water also raise it." },
];

export const IMAGERY_MIN_ZOOM = 8; // keeps each view to a handful of tiles (free monthly quota)

function shift(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** MapLibre raster tile URL for a layer on a date (WMS, Web Mercator bbox per tile). */
export function imageryTiles(layer: ImageryLayer, date: string) {
  const time = `${shift(date, -layer.windowDays)}/${shift(date, layer.windowDays)}`;
  const params = new URLSearchParams({
    SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.3.0", LAYERS: layer.id, CRS: "EPSG:3857",
    WIDTH: "256", HEIGHT: "256", FORMAT: "image/png", TRANSPARENT: "true", SHOWLOGO: "false", TIME: time,
  });
  if (layer.group.startsWith("Optical")) params.set("MAXCC", "40");
  // {bbox-epsg-3857} is filled in by MapLibre and must stay unencoded.
  return `https://sh.dataspace.copernicus.eu/ogc/wms/${CDSE_INSTANCE}?${params}&BBOX={bbox-epsg-3857}`;
}

export const IMAGERY_ATTRIBUTION =
  'Sentinel imagery: <a href="https://dataspace.copernicus.eu" target="_blank">Copernicus Data Space Ecosystem</a>';
