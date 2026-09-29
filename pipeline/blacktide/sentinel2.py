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
        # Clamped: a near-zero blue band (haze, shadow) otherwise blows the ratio up.
        r.select("B3").add(r.select("B4")).divide(r.select("B2").max(0.01)).clamp(0, 5).rename("OSI"),
        # Visible brightness: sand fill, concrete and bare clearings are bright; oiled ground is dark.
        r.select(["B2", "B3", "B4"]).reduce(ee.Reducer.mean()).rename("BRIGHT"),
    ).copyProperties(img, ["system:time_start"])


# Fully masked stand-in, so windows with no usable scenes (pre-2017, all-cloud months)
# yield masked optical bands instead of an error — the SAR-only model covers those pixels.
def _empty() -> ee.Image:
    return ee.Image.constant([0, 0, 0, 0, 0]).rename(["NDVI", "NDWI", "MNDWI", "OSI", "BRIGHT"]).toFloat().updateMask(0)


def collection(aoi: ee.Geometry, start: str, end: str, clear: float = 0.6) -> ee.ImageCollection:
    return (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(aoi)
        .filterDate(start, end)
        .linkCollection(ee.ImageCollection(CLOUD_SCORE), ["cs_cdf"])
        .map(lambda img: img.updateMask(img.select("cs_cdf").gte(clear)))
        .map(lambda img: ee.Image(_indices(img)).toFloat())
        .merge(ee.ImageCollection([_empty()]))
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
