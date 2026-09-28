import type { StyleSpecification } from "maplibre-gl";

// Free, keyless tile sources.
// Sentinel-2 cloudless © EOX IT Services GmbH (contains modified Copernicus Sentinel data), CC BY-NC-SA 4.0.
// The 2017 mosaic has no coverage over Nigeria, so 2016 serves as the pre-study baseline.
export const S2_YEARS = [2016, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

export function s2Tiles(year: number) {
  const layer = year === 2016 ? "s2cloudless_3857" : `s2cloudless-${year}_3857`;
  return `https://tiles.maps.eox.at/wmts/1.0.0/${layer}/default/g/{z}/{y}/{x}.jpg`;
}

export const S2_ATTR =
  '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless</a> by EOX (Copernicus Sentinel data)';

export function rasterStyle(tiles: string[], attribution: string, maxzoom = 19): StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: "raster", tiles, tileSize: 256, attribution, maxzoom } },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

// OpenFreeMap: free vector tiles from OpenStreetMap, no API key.
export const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

export const DELTA_VIEW = { center: [6.35, 4.95] as [number, number], zoom: 7.3 };
export const DELTA_BOUNDS: [[number, number], [number, number]] = [[3.8, 3.4], [9.4, 7.2]];
