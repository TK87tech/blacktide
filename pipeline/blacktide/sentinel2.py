"""Sentinel-2 preprocessing: Cloud Score+ masking and spectral indices.

Indices:
  NDVI  = (B8 - B4) / (B8 + B4)      vegetation health
  NDWI  = (B3 - B8) / (B3 + B8)      open water
  MNDWI = (B3 - B11) / (B3 + B11)    water, robust to built-up/soil
  OSI   = (B3 + B4) / B2             oil spill index (Rajendran et al.)
"""

import ee

CLOUD_SCORE = "GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED"


def _indices(img: ee.Image) -> ee.Image:
    r = img.select(["B2", "B3", "B4", "B8", "B11"]).divide(10000)
    return ee.Image.cat(
        r.normalizedDifference(["B8", "B4"]).rename("NDVI"),
        r.normalizedDifference(["B3", "B8"]).rename("NDWI"),
        r.normalizedDifference(["B3", "B11"]).rename("MNDWI"),
        r.select("B3").add(r.select("B4")).divide(r.select("B2")).rename("OSI"),
    ).copyProperties(img, ["system:time_start"])


def collection(aoi: ee.Geometry, start: str, end: str, clear: float = 0.6) -> ee.ImageCollection:
    return (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(aoi)
        .filterDate(start, end)
        .linkCollection(ee.ImageCollection(CLOUD_SCORE), ["cs_cdf"])
        .map(lambda img: img.updateMask(img.select("cs_cdf").gte(clear)))
        .map(_indices)
    )


def composite(aoi: ee.Geometry, start: str, end: str) -> ee.Image:
    """Median indices for the window plus NDVI change against the same window a year earlier."""
    now = collection(aoi, start, end).median()
    s, e = ee.Date(start), ee.Date(end)
    before = collection(aoi, s.advance(-1, "year"), e.advance(-1, "year")).select("NDVI").median()
    delta = now.select("NDVI").subtract(before).rename("NDVI_delta")
    return now.select(["NDVI", "NDWI", "MNDWI", "OSI"]).addBands(delta).select(
        ["NDVI", "NDVI_delta", "NDWI", "MNDWI", "OSI"]
    )
