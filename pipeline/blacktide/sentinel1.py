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
    edge = img.select("VV").gt(-30)  # masks low-intensity border noise
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
