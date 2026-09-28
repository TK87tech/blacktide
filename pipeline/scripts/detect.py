"""Step 3 — detect oil and publish events to web/data/.

Two detectors:
  * water — every Sentinel-1 pass over the area is classified on its own with the
            per-pass model; only water pixels, and only where the wind was between
            MIN_WIND and MAX_WIND (outside that range slicks can't be judged).
            Event date = the pass date.
  * land  — monthly SAR + optical stack, fused / SAR-only models, land pixels only.
            Runs only once a land training table exists.

High-probability pixels are grouped into events and enriched (area, people within
5 km, mangrove area), then merged into web/data/events.json.

    py -3 pipeline/scripts/detect.py --aoi pilot --start 2024-01-01 --end 2024-04-01 --dry-run
    py -3 pipeline/scripts/detect.py            # last complete month, full Delta
"""

import argparse
import hashlib
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402

from blacktide import auth, features, model, sentinel1  # noqa: E402
from blacktide.config import (  # noqa: E402
    ALL_FEATURES, AOIS, ASSET_ROOT, DETECTION_THRESHOLD, MAX_WIND, MIN_PIXELS, MIN_WIND, OUTPUT, SCALE,
    SCENE_FEATURES, WEB_DATA,
)
from blacktide.sites import SITES  # noqa: E402

MAX_EVENTS_PER_IMAGE = 100
VECTOR_SCALE = 40  # grouping pixels into events; 20 m is 4x slower for no real gain


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
    return min(SITES, key=lambda s: math.hypot(s[3] - lat, (s[4] - lon) * math.cos(math.radians(lat))))


def load_samples(name: str):
    try:
        ee.data.getAsset(f"{ASSET_ROOT}/{name}")
    except ee.EEException:
        return None
    fc = ee.FeatureCollection(f"{ASSET_ROOT}/{name}")
    classes = fc.aggregate_histogram("class").getInfo()
    return fc if len(classes) == 2 else None


def vectorise(p: ee.Image, valid: ee.Image, region: ee.Geometry, threshold: float) -> ee.FeatureCollection:
    hit = p.gte(threshold).And(valid)
    hit = hit.updateMask(hit.connectedPixelCount(100, True).gte(MIN_PIXELS)).selfMask()
    blobs = hit.addBands(p).reduceToVectors(
        geometry=region, scale=VECTOR_SCALE, geometryType="polygon", eightConnected=True,
        reducer=ee.Reducer.mean(), maxPixels=1e10, tileScale=4,
    )
    return blobs.map(lambda f: f.set("area_ha", f.geometry().area(1).divide(1e4))).sort("area_ha", False).limit(MAX_EVENTS_PER_IMAGE)


def enrich(blobs: ee.FeatureCollection, img: ee.Image, bands: list[str]) -> list[dict]:
    mangrove = ee.ImageCollection("LANDSAT/MANGROVE_FORESTS").mosaic().unmask(0).multiply(ee.Image.pixelArea()).divide(1e4)
    out = img.select(bands).reduceRegions(blobs, ee.Reducer.mean(), VECTOR_SCALE, tileScale=4)
    out = mangrove.rename("mangrove_ha").reduceRegions(out, ee.Reducer.sum().setOutputs(["mangrove_ha"]), 30, tileScale=4)
    pop = (
        ee.ImageCollection("WorldPop/GP/100m/pop")
        .filter(ee.Filter.eq("country", "NGA")).filter(ee.Filter.eq("year", 2020)).first()
    )
    out = out.map(lambda f: f.set(
        "people_5km", pop.reduceRegion(ee.Reducer.sum(), f.geometry().centroid(1).buffer(5000), 100).get("population"),
        "centroid", f.geometry().centroid(1).coordinates(),
    ))
    return out.select([".*"], None, False).getInfo()["features"]


def detect_water_scene(scene_id: str, aoi, clf, water, threshold):
    raw = ee.Image(f"COPERNICUS/S1_GRD/{scene_id}")
    img = ee.Image(sentinel1.scene_features(raw))
    wind = img.select("wind")
    valid = water.And(wind.gte(MIN_WIND)).And(wind.lte(MAX_WIND))
    p = img.select(SCENE_FEATURES).classify(clf).rename("p_oil")
    region = raw.geometry().intersection(aoi, 100)
    return enrich(vectorise(p, valid, region, threshold), img, SCENE_FEATURES)


def detect_land_month(start, end, aoi, fused, sar_only, water, threshold):
    stack = features.stack(aoi, start, end)
    p = model.probability(stack, fused, sar_only)
    return enrich(vectorise(p, water.Not(), aoi, threshold), stack, ALL_FEATURES)


def _r(v, n=2):
    return None if v is None else round(v, n)


def to_event(props: dict, day: str, surface: str, sensors: list[str], model_name: str) -> dict:
    lon, lat = props["centroid"]
    name, lga, state, *_ = nearest_site(lat, lon)
    uid = hashlib.sha1(f"{day}:{lat:.4f}:{lon:.4f}".encode()).hexdigest()[:6]
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        "properties": {
            "id": f"BT-{day[:7].replace('-', '')}-{uid}",
            "date": day,
            "site": name,
            "lga": lga,
            "state": state,
            "surface": surface,
            "area_ha": round(props["area_ha"], 2),
            "confidence": round(props.get("mean") or 0, 3),
            "status": "unverified",
            "model": model_name,
            "sensors": sensors,
            "nosdra_match": None,
            "people_5km": int(props.get("people_5km") or 0),
            "mangrove_ha": round(props.get("mangrove_ha") or 0, 2),
            "wind_ms": _r(props.get("wind"), 1),
            "features": {
                "vv_db": _r(props.get("VV")), "vh_db": _r(props.get("VH")), "vv_vh_db": _r(props.get("VV_VH")),
                "glcm_entropy": _r(props.get("GLCM_ent")), "ndvi_delta": _r(props.get("NDVI_delta"), 3),
                "ndwi": _r(props.get("NDWI"), 3), "osi": _r(props.get("OSI"), 3),
            },
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", choices=AOIS, default="delta")
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--threshold", type=float, default=DETECTION_THRESHOLD)
    ap.add_argument("--dry-run", action="store_true", help="write pipeline/output/events_preview.json instead of web/data")
    args = ap.parse_args()
    start, end = (args.start, args.end) if args.start and args.end else last_month()

    auth.init()
    if not ASSET_ROOT:
        raise SystemExit("Set GEE_PROJECT (or BLACKTIDE_ASSET_ROOT) so the training assets can be found.")
    aoi = features.bbox(AOIS[args.aoi])
    water = features.water_mask()

    water_samples = load_samples("training_water")
    land_samples = load_samples("training_land")
    if not water_samples and not land_samples:
        raise SystemExit("No training assets found — run sample_training.py first (and wait for the uploads).")
    water_clf = model.train_water(water_samples) if water_samples else None
    land_clfs = model.train(land_samples) if land_samples else None
    print(f"Models: water={'yes' if water_clf else 'no'}, land={'yes' if land_clfs else 'no'}")

    found: list[dict] = []
    for ms, me in months(start, end):
        n_before = len(found)
        if water_clf:
            scenes = (
                ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(aoi).filterDate(ms, me)
                .filter(ee.Filter.eq("instrumentMode", "IW"))
                .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
                .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
            )
            info = scenes.aggregate_array("system:index").zip(scenes.aggregate_array("system:time_start")).getInfo()

            def run_scene(item):
                sid, t = item
                day = date.fromtimestamp(t / 1000).isoformat()
                for attempt in range(3):
                    try:
                        return [to_event(f["properties"], day, "water", ["S1"], "rf-water")
                                for f in detect_water_scene(sid, aoi, water_clf, water, args.threshold)]
                    except Exception as e:  # noqa: BLE001 — timeouts, EE errors: retry, then skip the pass
                        err = e
                        time.sleep(5 * (attempt + 1))
                print(f"  skipped {sid[17:32]}: {str(err)[:90]}", flush=True)
                return []

            with ThreadPoolExecutor(max_workers=6) as pool:
                for evs in pool.map(run_scene, info):
                    found.extend(evs)
        if land_clfs:
            try:
                found.extend(
                    to_event(f["properties"], ms, "land", ["S1", "S2"] if f["properties"].get("NDVI") is not None else ["S1"], "rf-land")
                    for f in detect_land_month(ms, me, aoi, *land_clfs, water, args.threshold)
                )
            except Exception as e:  # noqa: BLE001
                print(f"  land {ms}: {str(e)[:90]}")
        print(f"{ms}: {len(found) - n_before} events", flush=True)

    if args.dry_run:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        path = OUTPUT / "events_preview.json"
        path.write_text(json.dumps({"type": "FeatureCollection", "features": found}, indent=1))
        print(f"Dry run: {len(found)} events written to {path}")
        return

    events_path, meta_path = WEB_DATA / "events.json", WEB_DATA / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    existing = [] if meta.get("sample", True) else json.loads(events_path.read_text())["features"]
    by_id = {e["properties"]["id"]: e for e in existing}
    for e in found:
        old = by_id.get(e["properties"]["id"])
        if old:  # keep analyst decisions on re-runs
            e["properties"]["status"] = old["properties"]["status"]
            e["properties"]["nosdra_match"] = old["properties"]["nosdra_match"]
        by_id[e["properties"]["id"]] = e

    events = sorted(by_id.values(), key=lambda e: e["properties"]["date"])
    events_path.write_text(json.dumps({"type": "FeatureCollection", "features": events}, separators=(",", ":")))
    dates = [e["properties"]["date"] for e in events]
    meta.update({
        "sample": False,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "period_start": min(dates) if dates else start,
        "period_end": max(dates) if dates else end,
        "model_version": "rf-water" + ("+rf-land" if land_clfs else ""),
        "aoi": args.aoi,
        "source": "Sentinel-1 GRD + Sentinel-2 SR (Copernicus) via Google Earth Engine",
    })
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"Wrote {len(events)} events")


if __name__ == "__main__":
    main()
