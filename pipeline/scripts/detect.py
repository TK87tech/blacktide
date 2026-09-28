"""Step 5 — detect oil and publish events to web/data/.

Two detectors:
  * water — every Sentinel-1 pass over the area is classified on its own with the
            per-pass model; only water pixels, and only where the wind was between
            MIN_WIND and MAX_WIND (outside that range slicks can't be judged).
            Event date = the pass date.
  * land  — monthly SAR + optical stack, fused / SAR-only models, land pixels only.
            Runs only once a land training table exists.

A whole pass is too big for Earth Engine's ~5-minute interactive limit, so each
month runs as a batch task (no time limit, runs on Google's side) that writes an
asset <ASSET_ROOT>/detections/<domain>_<YYYYMM>. The script waits for the tasks,
then reads the events back and merges them into web/data/events.json.

    py -3 pipeline/scripts/detect.py --aoi delta --start 2024-09-01 --end 2024-10-01 --dry-run
    py -3 pipeline/scripts/detect.py --collect ...   # re-read finished assets, don't resubmit
    py -3 pipeline/scripts/detect.py                 # last complete month, full Delta
"""

import argparse
import hashlib
import json
import math
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402

from blacktide import auth, features, model, sentinel1  # noqa: E402
from blacktide.config import (  # noqa: E402
    AOIS, ASSET_ROOT, DARK_SPOT_DB, DETECTION_THRESHOLD, MAX_WIND, MIN_PIXELS, MIN_WIND, OUTPUT,
    SCENE_FEATURES, WATER_SCALE, WEB_DATA,
)
from blacktide.sites import SITES  # noqa: E402

MAX_EVENTS_PER_IMAGE = 100
VECTOR_SCALE = WATER_SCALE  # grouping pixels into events


def start_task(task) -> None:
    """Start a batch task; a client-side retry of an already-accepted start is harmless."""
    try:
        task.start()
    except ee.EEException as e:
        if "already started" not in str(e):
            raise


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


def asset_exists(asset_id: str) -> bool:
    try:
        ee.data.getAsset(asset_id)
        return True
    except ee.EEException:
        return False


def load_samples(name: str):
    if not asset_exists(f"{ASSET_ROOT}/{name}"):
        return None
    fc = ee.FeatureCollection(f"{ASSET_ROOT}/{name}")
    return fc if len(fc.aggregate_histogram("class").getInfo()) == 2 else None


# ---------------------------------------------------------------- server-side graph

def vectorise(p: ee.Image, valid: ee.Image, region: ee.Geometry, threshold: float) -> ee.FeatureCollection:
    hit = p.gte(threshold).And(valid)
    hit = hit.updateMask(hit.connectedPixelCount(100, True).gte(MIN_PIXELS)).selfMask()
    blobs = hit.addBands(p).reduceToVectors(
        geometry=region, scale=VECTOR_SCALE, geometryType="polygon", eightConnected=True,
        reducer=ee.Reducer.mean(), maxPixels=1e10, tileScale=4,
    )
    return blobs.map(lambda f: f.set("area_ha", f.geometry().area(1).divide(1e4))).sort("area_ha", False).limit(MAX_EVENTS_PER_IMAGE)


def add_context(fc: ee.FeatureCollection) -> ee.FeatureCollection:
    """Mangrove area inside, people within 5 km, centroid."""
    mangrove = ee.ImageCollection("LANDSAT/MANGROVE_FORESTS").mosaic().unmask(0).multiply(ee.Image.pixelArea()).divide(1e4)
    fc = mangrove.rename("mangrove_ha").reduceRegions(fc, ee.Reducer.sum().setOutputs(["mangrove_ha"]), 30, tileScale=4)
    pop = (
        ee.ImageCollection("WorldPop/GP/100m/pop")
        .filter(ee.Filter.eq("country", "NGA")).filter(ee.Filter.eq("year", 2020)).first()
    )
    return fc.map(lambda f: f.set(
        "people_5km", pop.reduceRegion(ee.Reducer.sum(), f.geometry().centroid(1).buffer(5000), 100).get("population"),
        "lon", f.geometry().centroid(1).coordinates().get(0),
        "lat", f.geometry().centroid(1).coordinates().get(1),
    ))


def water_month(start, end, aoi, clf, water, threshold) -> ee.FeatureCollection:
    scenes = (
        ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(aoi).filterDate(start, end)
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
    )

    def per_scene(raw):
        raw = ee.Image(raw)
        img = ee.Image(sentinel1.scene_features(raw))
        wind = img.select("wind")
        valid = water.And(wind.gte(MIN_WIND)).And(wind.lte(MAX_WIND))
        # Stage 1 (cheap): dark spots only. Stage 2: the model, on those pixels alone.
        candidate = valid.And(img.select("VV").lt(DARK_SPOT_DB))
        p = img.updateMask(candidate).select(SCENE_FEATURES).classify(clf).rename("p_oil")
        blobs = vectorise(p, candidate, raw.geometry().intersection(aoi, 100), threshold)
        blobs = img.select(SCENE_FEATURES).reduceRegions(blobs, ee.Reducer.mean(), VECTOR_SCALE, tileScale=4)
        return blobs.map(lambda f: f.set("day", raw.date().format("YYYY-MM-dd"), "scene", raw.get("system:index")))

    return add_context(ee.FeatureCollection(scenes.map(per_scene)).flatten())


def land_month(start, end, aoi, fused, sar_only, water, threshold) -> ee.FeatureCollection:
    stack = features.stack(aoi, start, end)
    p = model.probability(stack, fused, sar_only)
    blobs = vectorise(p, water.Not(), aoi, threshold)
    blobs = stack.reduceRegions(blobs, ee.Reducer.mean(), VECTOR_SCALE, tileScale=4)
    return add_context(blobs.map(lambda f: f.set("day", start)))


# ---------------------------------------------------------------- client side

def submit(fc: ee.FeatureCollection, asset_id: str) -> ee.batch.Task:
    if asset_exists(asset_id):
        ee.data.deleteAsset(asset_id)
    task = ee.batch.Export.table.toAsset(fc, asset_id.split("/")[-1], asset_id)
    start_task(task)
    return task


def wait(tasks: dict[str, ee.batch.Task]) -> None:
    pending = dict(tasks)
    while pending:
        time.sleep(30)
        for aid, t in list(pending.items()):
            s = t.status()
            if s["state"] in ("COMPLETED", "FAILED", "CANCELLED"):
                eecu = (s.get("batch_eecu_usage_seconds") or 0) / 3600
                print(f"  {aid.split('/')[-1]}: {s['state']} — {eecu:.1f} EECU-hours {s.get('error_message', '')}", flush=True)
                del pending[aid]
        if pending:
            print(f"  waiting for {len(pending)} task(s)…", flush=True)


def _r(v, n=2):
    return None if v is None else round(v, n)


def to_event(p: dict, surface: str, model_name: str) -> dict:
    lon, lat, day = p["lon"], p["lat"], p["day"]
    name, lga, state, *_ = nearest_site(lat, lon)
    uid = hashlib.sha1(f"{day}:{lat:.4f}:{lon:.4f}".encode()).hexdigest()[:6]
    sensors = ["S1"] if surface == "water" or p.get("NDVI") is None else ["S1", "S2"]
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
            "area_ha": round(p["area_ha"], 2),
            "confidence": round(p.get("mean") or 0, 3),
            "status": "unverified",
            "model": model_name,
            "sensors": sensors,
            "nosdra_match": None,
            "people_5km": int(p.get("people_5km") or 0),
            "mangrove_ha": round(p.get("mangrove_ha") or 0, 2),
            "wind_ms": _r(p.get("wind"), 1),
            "features": {
                "vv_db": _r(p.get("VV")), "vh_db": _r(p.get("VH")), "vv_vh_db": _r(p.get("VV_VH")),
                "glcm_entropy": _r(p.get("GLCM_ent")), "ndvi_delta": _r(p.get("NDVI_delta"), 3),
                "ndwi": _r(p.get("NDWI"), 3), "osi": _r(p.get("OSI"), 3),
            },
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", choices=AOIS, default="delta")
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--threshold", type=float, default=DETECTION_THRESHOLD)
    ap.add_argument("--collect", action="store_true", help="only read existing detection assets")
    ap.add_argument("--dry-run", action="store_true", help="write pipeline/output/events_preview.json instead of web/data")
    args = ap.parse_args()
    start, end = (args.start, args.end) if args.start and args.end else last_month()

    auth.init()
    if not ASSET_ROOT:
        raise SystemExit("Set GEE_PROJECT (or BLACKTIDE_ASSET_ROOT) so the training assets can be found.")
    folder = f"{ASSET_ROOT}/detections"
    if not asset_exists(folder):
        ee.data.createAsset({"type": "FOLDER"}, folder)

    jobs = []  # (asset_id, surface, model_name)
    tasks = {}
    aoi = features.bbox(AOIS[args.aoi])
    if args.collect:
        for ms, _ in months(start, end):
            for dom in ("water", "land"):
                aid = f"{folder}/{dom}_{args.aoi}_{ms[:7].replace('-', '')}"
                if asset_exists(aid):
                    jobs.append((aid, dom, f"rf-{dom}"))
    else:
        water = features.water_mask()
        water_samples, land_samples = load_samples("training_water"), load_samples("training_land")
        if not water_samples and not land_samples:
            raise SystemExit("No training assets found — run sample_training.py first (and wait for the uploads).")
        water_clf = model.train_water(water_samples) if water_samples else None
        land_clfs = model.train(land_samples) if land_samples else None
        print(f"Models: water={'yes' if water_clf else 'no'}, land={'yes' if land_clfs else 'no'}")
        for ms, me in months(start, end):
            tag = f"{args.aoi}_{ms[:7].replace('-', '')}"
            if water_clf:
                aid = f"{folder}/water_{tag}"
                tasks[aid] = submit(water_month(ms, me, aoi, water_clf, features.open_water_mask(), args.threshold), aid)
                jobs.append((aid, "water", "rf-water"))
            if land_clfs:
                aid = f"{folder}/land_{tag}"
                tasks[aid] = submit(land_month(ms, me, aoi, *land_clfs, water, args.threshold), aid)
                jobs.append((aid, "land", "rf-land"))
        print(f"Submitted {len(tasks)} batch task(s); progress also shows at https://code.earthengine.google.com/tasks")
        wait(tasks)

    found = []
    for aid, surface, model_name in jobs:
        if not asset_exists(aid):
            continue
        feats = ee.FeatureCollection(aid).getInfo()["features"]
        found.extend(to_event(f["properties"], surface, model_name) for f in feats)
        print(f"{aid.split('/')[-1]}: {len(feats)} events")

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
        "model_version": " + ".join(sorted({m for _, _, m in jobs})),
        "aoi": args.aoi,
        "source": "Sentinel-1 GRD + Sentinel-2 SR (Copernicus) via Google Earth Engine",
    })
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"Wrote {len(events)} events")


if __name__ == "__main__":
    main()
