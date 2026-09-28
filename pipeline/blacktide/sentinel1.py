"""Sentinel-1 SAR preprocessing.

GEE's COPERNICUS/S1_GRD collection is already thermal-noise corrected,
radiometrically calibrated (sigma0) and terrain corrected, so we only add
speckle filtering, border-noise masking and derived bands here.

Note: GRD products carry no phase, so a full polarimetric (H/A/alpha)
decomposition is not possible — the VV/VH ratio is used as the polarimetric
feature instead.
"""

import ee


def _prep(img: ee.Image) -> ee.Image:
    # Border noise only lives along the scene edges. Mask very low values there, and
    # nowhere else: thick oil slicks are often darker than -30 dB and must be kept.
    interior = ee.Image.constant(1).clip(img.geometry().buffer(-5000)).unmask(0)
    edge = img.select("VV").gt(-30).Or(interior)
    linear = ee.Image(10).pow(img.select(["VV", "VH"]).divide(10))
    filtered = linear.focalMedian(radius=30, kernelType="circle", units="meters")
    db = filtered.log10().multiply(10).rename(["VV", "VH"])
    ratio = db.select("VV").subtract(db.select("VH")).rename("VV_VH")
    return db.addBands(ratio).updateMask(edge).copyProperties(img, ["system:time_start"])


def collection(aoi: ee.Geometry, start: str, end: str) -> ee.ImageCollection:
    return (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterBounds(aoi)
        .filterDate(start, end)
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
        .map(_prep)
    )


def texture(db: ee.Image) -> ee.Image:
    """GLCM texture on VV over a 7x7 window (size=3). Oil-damped water is smoother."""
    quantised = db.select("VV").unitScale(-30, 0).clamp(0, 1).multiply(63).toInt()
    glcm = quantised.glcmTexture(size=3)
    return glcm.select(["VV_ent", "VV_contrast", "VV_corr"], ["GLCM_ent", "GLCM_contrast", "GLCM_corr"])


def composite(aoi: ee.Geometry, start: str, end: str) -> ee.Image:
    """Dark-spot composite: the 10th percentile keeps transient slicks that a median would erase."""
    col = collection(aoi, start, end).select(["VV", "VH", "VV_VH"])
    db = col.reduce(ee.Reducer.percentile([10])).rename(["VV", "VH", "VV_VH"])
    return db.addBands(texture(db))


def wind_at(date: ee.Date) -> ee.Image:
    """10 m wind speed (m/s) from the GFS analysis nearest the pass; masked if none exists."""
    gfs = (
        ee.ImageCollection("NOAA/GFS0P25")
        .filter(ee.Filter.eq("forecast_hours", 0))
        .filterDate(date.advance(-3, "hour"), date.advance(3, "hour"))
        .map(lambda g: g.set("rank", 0))
    )
    empty = ee.Image.constant([0, 0]).rename(
        ["u_component_of_wind_10m_above_ground", "v_component_of_wind_10m_above_ground"]
    ).toFloat().updateMask(0).set("rank", 1)
    g = ee.Image(gfs.merge(ee.ImageCollection([empty])).sort("rank").first())
    return (
        g.select("u_component_of_wind_10m_above_ground")
        .hypot(g.select("v_component_of_wind_10m_above_ground"))
        .resample("bilinear")
        .rename("wind")
    )


def scene_features(img: ee.Image) -> ee.Image:
    """Per-pass features for the water model.

    VV_local is darkness relative to the surrounding 1.5 km: a slick is a dark patch
    inside brighter sea, whereas calm water is uniformly dark.
    """
    db = ee.Image(_prep(img))
    vv = db.select("VV")
    local = vv.subtract(vv.focalMedian(1500, "circle", "meters")).rename("VV_local")
    return ee.Image.cat(
        db, local, texture(db), wind_at(img.date()), img.select("angle").rename("angle")
    ).copyProperties(img, ["system:time_start", "system:index"])
