"""Step 3 — run detection month by month and publish events to web/data/.

Trains the fused + SAR-only Random Forests from the training asset, classifies
each monthly feature stack, vectorises contiguous high-probability pixels into
events, enriches them (area, water/land, people within 5 km, mangrove area) and
merges them into web/data/events.json.

    py -3 pipeline/scripts/detect.py --aoi pilot --start 2024-01-01 --end 2024-07-01
    py -3 pipeline/scripts/detect.py            # last complete month, full Delta
"""

import argparse
import hashlib
import json
import math
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402

from blacktide import auth, features, model  # noqa: E402
from blacktide.config import (  # noqa: E402
    ALL_FEATURES, AOIS, ASSET_ROOT, DETECTION_THRESHOLD, MIN_PIXELS, SCALE, WEB_DATA,
)
from blacktide.sites import SITES  # noqa: E402

MAX_EVENTS_PER_MONTH = 300


def months(start: str, end: str):
    y, m = int(start[:4]), int(start[5:7])
    while f"{y}-{m:02d}-01" < end:
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        yield f"{y}-{m:02d}-01", f"{ny}-{nm:02d}-01"
        y, m = ny, nm


def last_month() -> tuple[str, str]:
    t = date.today()
    y, m = (t.year - 1, 12) if t.month == 1 else (t.year, t.month - 1)
    return f"{y}-{m:02d}-01", f"{t.year}-{t.month:02d}-01"


def nearest_site(lat: float, lon: float):
    def dist(s):
        return math.hypot(s[3] - lat, (s[4] - lon) * math.cos(math.radians(lat)))
    return min(SITES, key=dist)


def detect_month(aoi, start, end, fused, sar_only, threshold):
    stack = features.stack(aoi, start, end)
    p = model.probability(stack, fused, sar_only)
    hit = p.gte(threshold)
    hit = hit.updateMask(hit.connectedPixelCount(100, True).gte(MIN_PIXELS)).selfMask()

    blobs = hit.addBands(p).reduceToVectors(
        geometry=aoi, scale=SCALE, geometryType="polygon", eightConnected=True,
        reducer=ee.Reducer.mean(), maxPixels=1e10, tileScale=4,
    )
    blobs = blobs.map(lambda f: f.set("area_ha", f.geometry().area(1).divide(1e4))).sort("area_ha", False).limit(MAX_EVENTS_PER_MONTH)

    enriched = ee.Image.cat(
        stack,
        features.water_mask().rename("water"),
        ee.ImageCollection("LANDSAT/MANGROVE_FORESTS").mosaic().unmask(0).multiply(ee.Image.pixelArea()).divide(1e4).rename("mangrove_ha"),
    )
    means = enriched.select([*ALL_FEATURES, "water"]).reduceRegions(blobs, ee.Reducer.mean(), SCALE, tileScale=4)
    means = enriched.select("mangrove_ha").reduceRegions(means, ee.Reducer.sum().setOutputs(["mangrove_ha"]), 30, tileScale=4)

    pop = (
        ee.ImageCollection("WorldPop/GP/100m/pop")
        .filter(ee.Filter.eq("country", "NGA")).filter(ee.Filter.eq("year", 2020)).first()
    )
    means = means.map(lambda f: f.set(
        "people_5km",
        pop.reduceRegion(ee.Reducer.sum(), f.geometry().centroid(1).buffer(5000), 100).get("population"),
        "centroid", f.geometry().centroid(1).coordinates(),
    ))
    return means.select([".*"], None, False).getInfo()["features"]


def to_event(props: dict, month_start: str) -> dict:
    lon, lat = props["centroid"]
    name, lga, state, *_ = nearest_site(lat, lon)
    uid = hashlib.sha1(f"{month_start}:{lat:.4f}:{lon:.4f}".encode()).hexdigest()[:6]
    f = {k: props.get(k) for k in ALL_FEATURES}
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        "properties": {
            "id": f"BT-{month_start[:7].replace('-', '')}-{uid}",
            "date": month_start,
            "site": name,
            "lga": lga,
            "state": state,
            "surface": "water" if (props.get("water") or 0) >= 0.5 else "land",
            "area_ha": round(props["area_ha"], 2),
            "confidence": round(props.get("mean") or 0, 3),
            "status": "unverified",
            "model": "rf-gee",
            "sensors": ["S1", "S2"] if f.get("NDVI") is not None else ["S1"],
            "nosdra_match": None,
            "people_5km": int(props.get("people_5km") or 0),
            "mangrove_ha": round(props.get("mangrove_ha") or 0, 2),
            "features": {
                "vv_db": _r(f["VV"]), "vh_db": _r(f["VH"]), "vv_vh_db": _r(f["VV_VH"]),
                "glcm_entropy": _r(f["GLCM_ent"]), "ndvi_delta": _r(f["NDVI_delta"], 3),
                "ndwi": _r(f["NDWI"], 3), "osi": _r(f["OSI"], 3),
            },
        },
    }


def _r(v, n=2):
    return None if v is None else round(v, n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", choices=AOIS, default="delta")
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--threshold", type=float, default=DETECTION_THRESHOLD)
    args = ap.parse_args()
    start, end = (args.start, args.end) if args.start and args.end else last_month()

    auth.init()
    if not ASSET_ROOT:
        raise SystemExit("Set GEE_PROJECT (or BLACKTIDE_ASSET_ROOT) so the training asset can be found.")
    fused, sar_only = model.train(ee.FeatureCollection(f"{ASSET_ROOT}/training_samples"))
    aoi = features.bbox(AOIS[args.aoi])

    events_path, meta_path = WEB_DATA / "events.json", WEB_DATA / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    existing = [] if meta.get("sample", True) else json.loads(events_path.read_text())["features"]
    by_id = {e["properties"]["id"]: e for e in existing}

    for ms, me in months(start, end):
        found = [to_event(f["properties"], ms) for f in detect_month(aoi, ms, me, fused, sar_only, args.threshold)]
        for e in found:
            # Keep analyst decisions on re-runs.
            old = by_id.get(e["properties"]["id"])
            if old:
                e["properties"]["status"] = old["properties"]["status"]
                e["properties"]["nosdra_match"] = old["properties"]["nosdra_match"]
            by_id[e["properties"]["id"]] = e
        print(f"{ms}: {len(found)} events")

    events = sorted(by_id.values(), key=lambda e: e["properties"]["date"])
    events_path.write_text(json.dumps({"type": "FeatureCollection", "features": events}, separators=(",", ":")))
    dates = [e["properties"]["date"] for e in events]
    meta.update({
        "sample": False,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "period_start": min(dates) if dates else start,
        "period_end": max(dates) if dates else end,
        "model_version": "rf-gee",
        "aoi": args.aoi,
        "source": "Sentinel-1 GRD + Sentinel-2 SR (Copernicus) via Google Earth Engine",
    })
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"Wrote {len(events)} events")


if __name__ == "__main__":
    main()
