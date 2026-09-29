"""Inland & creek oil detection by SAR + optical change detection (no training labels needed).

Land / creek banks — oil kills vegetation. For year Y, compare the dry season
(Nov Y-1 → Mar Y, clearest optical window) with the previous one:
  * optical evidence: healthy before (NDVI >= 0.5) and NDVI drop >= 0.2   (Sentinel-2)
  * radar evidence:   VH drop >= 1.5 dB — less volume scattering from dying canopy (Sentinel-1)
  Candidate = optical evidence; radar agreement raises confidence. Built-up areas excluded;
  MODIS burned area and proximity to water (creek bank) are recorded.

Creek water — creeks are radar-dark all the time, so "dark" means nothing there. Instead each
pass in year Y is compared with that pixel's own median VV over year Y-1; a patch >= 3 dB darker
than its normal on a pass is a possible slick, dated by its most anomalous pass.

Each year runs as one Earth Engine batch task (cost printed afterwards) and results are merged
into web/data/events.json as unverified detections.

    py -3 pipeline/scripts/detect_inland.py --aoi pilot --years 2024 2024 --dry-run
    py -3 pipeline/scripts/detect_inland.py --aoi delta --years 2020 2025
"""

import argparse
import hashlib
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402

from blacktide import auth, features, sentinel2  # noqa: E402
from blacktide.config import AOIS, ASSET_ROOT, OUTPUT, WEB_DATA  # noqa: E402
from blacktide.sites import SITES  # noqa: E402

SCALE = 40
NDVI_HEALTHY, NDVI_DROP, VH_DROP_DB, CREEK_ANOM_DB = 0.5, 0.2, 1.5, 3.0
CLEAR = 0.8               # Cloud Score+ threshold for the land composites (stricter than the 0.6 default)
MIN_CLEAR_LOOKS = 3       # clear observations needed in each dry season
MAX_BRIGHT = 0.12         # visible reflectance; above this the "dead" patch is sand, concrete or bare clearing
NATURAL_COVER = [10, 20, 90, 95]  # WorldCover tree, shrub, herbaceous wetland, mangrove
MAX_FLOOD_SHARE = 0.2     # creek darkening is dropped if >20% of land within 300 m darkened too
MIN_PX_LAND, MIN_PX_CREEK = 10, 6          # at 40 m: ~1.6 ha, ~1 ha
MAX_PER_KIND = 400
# First-run estimate, EECU-hours per km² per year; replaced by the measured figure after the pilot.
EECU_PER_KM2_YEAR = 1.0 / 1000


def s1(aoi, start, end):
    return (
        ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(aoi).filterDate(start, end)
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
    )


def db40(img: ee.Image, bands: list[str]) -> ee.Image:
    """Backscatter in dB. No explicit resampling: everything here is requested at 40 m, and
    S1_GRD's mean pyramids average the 10 m pixels (removing speckle). No focal filters are
    used, so nothing runs at a finer resolution than requested."""
    return img.select(bands)


def season_vh(aoi, year: int) -> ee.Image:
    return s1(aoi, f"{year - 1}-11-01", f"{year}-04-01").map(lambda i: db40(i, ["VH"])).median()


def season_optical(aoi, year: int):
    """Dry-season median NDVI / brightness from strictly clear pixels, and how many clear looks."""
    col = sentinel2.collection(aoi, f"{year - 1}-11-01", f"{year}-04-01", clear=CLEAR)
    return col.select("NDVI").median(), col.select("BRIGHT").median(), col.select("NDVI").count()


def land_candidates(aoi, year: int, water, wc) -> ee.FeatureCollection:
    nb, _, cb = season_optical(aoi, year - 1)
    na, bright_a, ca = season_optical(aoi, year)
    vb, va = season_vh(aoi, year - 1), season_vh(aoi, year)
    d_ndvi, d_vh = na.subtract(nb), va.subtract(vb)
    optical = nb.gte(NDVI_HEALTHY).And(d_ndvi.lte(-NDVI_DROP))
    radar = d_vh.lte(-VH_DROP_DB)
    # Look-alikes seen in the pilot, removed:
    #   haze      -> at least MIN_CLEAR_LOOKS strictly clear observations in BOTH seasons
    #   sand/fill -> dead oiled ground is dark; bright after-season surfaces are construction or clearing
    #   farming   -> only natural cover: tree, shrub, wetland, mangrove (no cropland / grassland / built-up)
    natural = wc.remap(NATURAL_COVER, [1] * len(NATURAL_COVER), 0)
    cand = (
        optical.And(water.Not()).And(natural)
        .And(cb.gte(MIN_CLEAR_LOOKS)).And(ca.gte(MIN_CLEAR_LOOKS))
        .And(bright_a.lt(MAX_BRIGHT))
    )
    cand = cand.updateMask(cand.connectedPixelCount(200, True).gte(MIN_PX_LAND)).selfMask()
    burned = (
        ee.ImageCollection("MODIS/061/MCD64A1").filterDate(f"{year - 1}-11-01", f"{year}-04-01")
        .select("BurnDate").max().gt(0).unmask(0)
    )
    dist_water = water.fastDistanceTransform(30).sqrt().multiply(30)
    stack = ee.Image.cat(
        d_ndvi.rename("d_ndvi"), d_vh.rename("d_vh"), nb.rename("ndvi_before"), na.rename("ndvi_after"),
        radar.rename("radar_agree"), burned.rename("burned"), dist_water.rename("dist_water"),
        bright_a.rename("bright_after"),
    )
    blobs = cand.reduceToVectors(
        geometry=aoi, scale=SCALE, geometryType="polygon", eightConnected=True, maxPixels=1e10, tileScale=4,
    )
    blobs = blobs.map(lambda f: f.set("area_ha", f.geometry().area(1).divide(1e4))).sort("area_ha", False).limit(MAX_PER_KIND)
    blobs = stack.reduceRegions(blobs, ee.Reducer.mean(), SCALE, tileScale=4)
    blobs = wc.rename("landcover").reduceRegions(blobs, ee.Reducer.mode(), SCALE, tileScale=4)
    return blobs.map(lambda f: f.set("kind", "land", "day", f"{year}-02-15"))


def creek_candidates(aoi, year: int, water, open_water) -> ee.FeatureCollection:
    """Creek darkening vs the same place, same orbit, same season a year earlier —
    kept only where it stays inside the channel (floodplain darkening = flooding)."""
    creek = water.And(open_water.Not())
    land = water.Not()
    passes = s1(aoi, f"{year}-01-01", f"{year + 1}-01-01")

    def anomaly(img):
        d = img.date()
        base = (
            s1(aoi, d.advance(-1, "year").advance(-30, "day"), d.advance(-1, "year").advance(30, "day"))
            .filter(ee.Filter.eq("relativeOrbitNumber_start", img.get("relativeOrbitNumber_start")))
            .map(lambda i: db40(i, ["VV"]))
            .merge(ee.ImageCollection([ee.Image.constant(0).rename("VV").toFloat().updateMask(0)]))
            .median()
        )
        a = db40(img, ["VV"]).subtract(base)
        dark = a.lte(-CREEK_ANOM_DB)
        # share of nearby LAND that also darkened: high = floodplain / wet ground, not a slick
        flood = dark.And(land).unmask(0).focalMean(300, "circle", "meters").rename("flood")
        ok = dark.And(creek).And(flood.lt(MAX_FLOOD_SHARE))
        strength = a.multiply(-1).updateMask(ok).unmask(0).rename("strength")
        return ee.Image.cat(a.rename("anom"), strength, flood, ee.Image.constant(d.millis()).toDouble().rename("t"))

    worst = passes.map(anomaly).qualityMosaic("strength")
    cand = worst.select("strength").gte(CREEK_ANOM_DB)
    cand = cand.updateMask(cand.connectedPixelCount(100, True).gte(MIN_PX_CREEK)).selfMask()
    blobs = cand.reduceToVectors(
        geometry=aoi, scale=SCALE, geometryType="polygon", eightConnected=True, maxPixels=1e10, tileScale=4,
    )
    blobs = blobs.map(lambda f: f.set("area_ha", f.geometry().area(1).divide(1e4))).sort("area_ha", False).limit(MAX_PER_KIND)
    blobs = worst.select(["anom", "t", "flood"]).reduceRegions(
        blobs, ee.Reducer.mean().combine(ee.Reducer.mode(), "", True), SCALE, tileScale=4
    )
    return blobs.map(lambda f: f.set("kind", "creek"))


def add_context(fc: ee.FeatureCollection) -> ee.FeatureCollection:
    mangrove = ee.ImageCollection("LANDSAT/MANGROVE_FORESTS").mosaic().unmask(0).multiply(ee.Image.pixelArea()).divide(1e4)
    fc = mangrove.rename("mangrove_ha").reduceRegions(fc, ee.Reducer.sum().setOutputs(["mangrove_ha"]), 30, tileScale=4)
    pop = ee.ImageCollection("WorldPop/GP/100m/pop").filter(ee.Filter.eq("country", "NGA")).filter(ee.Filter.eq("year", 2020)).first()
    return fc.map(lambda f: f.set(
        "people_5km", pop.reduceRegion(ee.Reducer.sum(), f.geometry().centroid(1).buffer(5000), 100).get("population"),
        "lon", f.geometry().centroid(1).coordinates().get(0),
        "lat", f.geometry().centroid(1).coordinates().get(1),
    ))


# ------------------------------------------------------------------ client side

def asset_exists(a):
    try:
        ee.data.getAsset(a)
        return True
    except ee.EEException:
        return False


def nearest_site(lat, lon):
    return min(SITES, key=lambda s: math.hypot(s[3] - lat, (s[4] - lon) * math.cos(math.radians(lat))))


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def to_event(p: dict) -> dict | None:
    lon, lat = p.get("lon"), p.get("lat")
    if lon is None:
        return None
    name, lga, state, *_ = nearest_site(lat, lon)
    if p["kind"] == "land":
        d_ndvi, d_vh = p.get("d_ndvi") or 0, p.get("d_vh") or 0
        agree = (p.get("radar_agree") or 0) >= 0.5
        conf = clamp(0.5 + 0.2 * clamp((-d_ndvi - NDVI_DROP) / 0.3) + (0.25 * clamp((-d_vh - VH_DROP_DB) / 3) + 0.05 if agree else 0), 0.5, 0.95)
        day = p["day"]
        extra = {
            "evidence": "optical + radar" if agree else "optical only",
            "ndvi_before": round(p.get("ndvi_before") or 0, 3),
            "ndvi_after": round(p.get("ndvi_after") or 0, 3),
            "vh_change_db": round(d_vh, 2),
            "burned": (p.get("burned") or 0) >= 0.3,
            "creek_bank": (p.get("dist_water") or 1e9) <= 200,
        }
        surface, feats = "land", {"ndvi_delta": round(d_ndvi, 3)}
    else:
        anom = p.get("anom_mean") or 0
        t = p.get("t_mode")
        day = datetime.fromtimestamp(t / 1000, timezone.utc).date().isoformat() if t else None
        if not day:
            return None
        conf = clamp(0.5 + (-anom - CREEK_ANOM_DB) / 8, 0.5, 0.9)
        extra = {"evidence": "radar anomaly (creek)", "vv_anomaly_db": round(anom, 2)}
        surface, feats = "water", {}
    uid = hashlib.sha1(f"{p['kind']}:{day}:{lat:.4f}:{lon:.4f}".encode()).hexdigest()[:6]
    base_feats = {k: None for k in ("vv_db", "vh_db", "vv_vh_db", "glcm_entropy", "ndvi_delta", "ndwi", "osi")}
    base_feats.update(feats)
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        "properties": {
            "id": f"BT-{day[:7].replace('-', '')}-{uid}",
            "date": day,
            "site": name, "lga": lga, "state": state,
            "surface": surface,
            "area_ha": round(p.get("area_ha") or 0, 2),
            "confidence": round(conf, 3),
            "status": "unverified",
            "model": "inland-change-v1",
            "sensors": ["S1", "S2"] if p["kind"] == "land" else ["S1"],
            "nosdra_match": None,
            "people_5km": int(p.get("people_5km") or 0),
            "mangrove_ha": round(p.get("mangrove_ha") or 0, 2),
            "source": "blacktide",
            "kind": p["kind"],
            **extra,
            "features": base_feats,
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", choices=AOIS, default="pilot")
    ap.add_argument("--years", nargs=2, type=int, default=[2024, 2024], metavar=("FIRST", "LAST"))
    ap.add_argument("--collect", action="store_true", help="only read finished assets")
    ap.add_argument("--dry-run", action="store_true", help="write pipeline/output/inland_preview.json instead of web/data")
    ap.add_argument("--max-eecu", type=float, default=20.0)
    args = ap.parse_args()

    auth.init()
    folder = f"{ASSET_ROOT}/detections"
    if not asset_exists(folder):
        ee.data.createAsset({"type": "FOLDER"}, folder)
    years = list(range(args.years[0], args.years[1] + 1))
    assets = {y: f"{folder}/inland_{args.aoi}_{y}" for y in years}

    if not args.collect:
        w, s_, e_, n_ = AOIS[args.aoi]
        km2 = (e_ - w) * 111 * math.cos(math.radians((s_ + n_) / 2)) * (n_ - s_) * 111
        est = EECU_PER_KM2_YEAR * km2 * len(years)
        print(f"Estimated cost: {est:.1f} EECU-hours ({km2:,.0f} km², {len(years)} year(s))")
        if est > args.max_eecu:
            raise SystemExit(f"Over budget (--max-eecu {args.max_eecu}).")
        aoi = features.bbox(AOIS[args.aoi])
        water, open_water = features.water_mask(), features.open_water_mask()
        wc = ee.ImageCollection("ESA/WorldCover/v200").first()
        tasks = {}
        for y in years:
            fc = add_context(land_candidates(aoi, y, water, wc).merge(creek_candidates(aoi, y, water, open_water)))
            if asset_exists(assets[y]):
                ee.data.deleteAsset(assets[y])
            t = ee.batch.Export.table.toAsset(fc, f"inland_{args.aoi}_{y}", assets[y])
            t.start()
            tasks[y] = t
        print(f"Submitted {len(tasks)} task(s) — https://code.earthengine.google.com/tasks")
        pending = dict(tasks)
        while pending:
            time.sleep(30)
            for y, t in list(pending.items()):
                st = t.status()
                if st["state"] in ("COMPLETED", "FAILED", "CANCELLED"):
                    print(f"  {y}: {st['state']} — {(st.get('batch_eecu_usage_seconds') or 0) / 3600:.2f} EECU-hours "
                          f"{st.get('error_message', '')}", flush=True)
                    del pending[y]

    events = []
    for y, a in assets.items():
        if not asset_exists(a):
            continue
        feats = ee.FeatureCollection(a).getInfo()["features"]
        got = [e for e in (to_event(f["properties"]) for f in feats) if e]
        events.extend(got)
        n_land = sum(e["properties"]["kind"] == "land" for e in got)
        print(f"{y}: {n_land} land / creek-bank, {len(got) - n_land} creek-water candidates")

    if args.dry_run:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        (OUTPUT / "inland_preview.json").write_text(json.dumps({"type": "FeatureCollection", "features": events}, indent=1))
        print(f"Dry run: {len(events)} events → {OUTPUT / 'inland_preview.json'}")
        return

    path, meta_path = WEB_DATA / "events.json", WEB_DATA / "meta.json"
    existing = json.loads(path.read_text())["features"]
    old = {e["properties"]["id"]: e for e in existing}
    kept = [e for e in existing if e["properties"].get("model") != "inland-change-v1" or e["properties"]["date"][:4] not in {str(y) for y in years}]
    for e in events:
        prev = old.get(e["properties"]["id"])
        if prev:
            e["properties"]["status"] = prev["properties"]["status"]
    merged = sorted(kept + events, key=lambda e: e["properties"]["date"])
    path.write_text(json.dumps({"type": "FeatureCollection", "features": merged}, separators=(",", ":")))
    meta = json.loads(meta_path.read_text())
    meta["source"] = "Marine: SkyTruth Cerulean (Sentinel-1). Land & creeks: BlackTide SAR + optical change detection (Sentinel-1/2)."
    meta["model_version"] = "cerulean + inland-change-v1"
    meta["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"Wrote {len(merged)} events ({len(events)} inland)")


if __name__ == "__main__":
    main()
