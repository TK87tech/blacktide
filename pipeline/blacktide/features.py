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
    """Permanent / seasonal water from JRC Global Surface Water (occurrence ≥ 50%)."""
    return ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence").gte(50).unmask(0)
