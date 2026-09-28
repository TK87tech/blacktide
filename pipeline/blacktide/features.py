"""Combined Sentinel-1 + Sentinel-2 feature stack."""

import ee

from . import sentinel1, sentinel2
from .config import ALL_FEATURES


def bbox(coords: list[float]) -> ee.Geometry:
    return ee.Geometry.Rectangle(coords)


def stack(aoi: ee.Geometry, start: str, end: str) -> ee.Image:
    """SAR bands are always present; optical bands are masked wherever cloud hid every scene.
    The model layer handles that with a SAR-only fallback classifier."""
    return sentinel1.composite(aoi, start, end).addBands(sentinel2.composite(aoi, start, end)).select(ALL_FEATURES).clip(aoi)


def water_mask() -> ee.Image:
    """Water = JRC surface water (occurrence >= 50%), WorldCover water, or open sea
    (WorldCover has no data offshore)."""
    jrc = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence").unmask(0).gte(50)
    wc = ee.ImageCollection("ESA/WorldCover/v200").first().unmask(80).eq(80)
    return jrc.Or(wc).rename("water")


def open_water_mask(min_shore_m: int = 500) -> ee.Image:
    """Water at least min_shore_m from any shore: sea, estuaries, wide rivers.

    Narrow mangrove creeks are excluded on purpose — they are sheltered from the wind,
    so they stay radar-dark whatever the weather, and the water model (trained on
    open-sea slicks) can't judge them. Creeks are covered by the land / creek-bank
    die-off detector instead. Computed on a 100 m grid to stay cheap.
    """
    p100 = ee.Projection("EPSG:4326").atScale(100)
    w = water_mask().reduceResolution(ee.Reducer.mean(), maxPixels=512).reproject(p100).gte(0.5)
    return w.focalMin(min_shore_m / 100, "circle", "pixels").reproject(p100).rename("open_water")
