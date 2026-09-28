"""SkyTruth Cerulean — open Sentinel-1 oil slick detections (https://cerulean.skytruth.org).

Used as a source of *marine / coastal* oil labels. Please credit SkyTruth Cerulean
when publishing results built on these labels.
"""

import requests

API = "https://api.cerulean.skytruth.org/collections/public.slick_plus/items"
FIELDS = "id,slick_timestamp,machine_confidence,hitl_cls_name,area"
PAGE = 500

# Human-in-the-loop classes that describe real oil on the water.
OIL_CLASSES = {"Infrastructure", "Anthropogenic", "Vessel", "Vessel, coincident", "Vessel, old", "Natural"}


def fetch_slicks(bbox: list[float]) -> list[dict]:
    """All slick polygons intersecting bbox [w, s, e, n], as GeoJSON features."""
    out, offset = [], 0
    while True:
        r = requests.get(
            API,
            params={
                "bbox": ",".join(map(str, bbox)),
                "limit": PAGE,
                "offset": offset,
                "f": "geojson",
                "properties": FIELDS,
            },
            timeout=120,
        )
        r.raise_for_status()
        feats = r.json().get("features", [])
        out.extend(feats)
        if len(feats) < PAGE:
            return out
        offset += PAGE
