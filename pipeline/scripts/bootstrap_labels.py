"""Build a starting training set automatically — no clicking.

Water labels are tied to a specific Sentinel-1 pass ("scene"), for the per-pass water model:
  * Oil on water   — SkyTruth Cerulean slick polygons (human-reviewed first,
                     then high-confidence machine detections)
  * Clean water    — random water pixels in randomly chosen passes
  * Look-alikes    — dark radar water where GFS winds were calm (< 3 m/s), i.e.
                     darkness explained by wind, not oil; labelled clean
Land labels are monthly, for the land model:
  * Clean land     — stratified random points from ESA WorldCover land classes

Land / creek oil is NOT covered here — that comes from the Earth Engine
change-detection candidates you confirm afterwards.

    py -3 pipeline/scripts/bootstrap_labels.py
    py -3 pipeline/scripts/bootstrap_labels.py --merge        # keep reviewed / hand-made labels
"""

import argparse
import json
import random
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402
from shapely.geometry import Point, shape  # noqa: E402

from blacktide import auth, cerulean  # noqa: E402
from blacktide.config import AOIS, LABELS  # noqa: E402

DELTA = AOIS["delta"]
YEARS = range(2017, date.today().year)
WORLDCOVER = {10: "tree cover", 30: "grassland", 40: "cropland", 50: "built-up", 90: "wetland", 95: "mangrove"}

rng = random.Random(87)


def point_label(lon, lat, cls, day, source, verified, lid, scene=None):
    props = {"id": lid, "class": cls, "date": day, "source": source, "verified": verified}
    if scene:
        props["scene"] = scene
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]}, "properties": props}


def points_inside(geom, n: int) -> list[Point]:
    """A guaranteed-interior point plus up to n-1 random interior points."""
    pts = [geom.representative_point()]
    minx, miny, maxx, maxy = geom.bounds
    tries = 0
    while len(pts) < n and tries < 200:
        tries += 1
        p = Point(rng.uniform(minx, maxx), rng.uniform(miny, maxy))
        if geom.contains(p):
            pts.append(p)
    return pts


def oil_labels(max_machine: int) -> tuple[list[dict], list[tuple]]:
    slicks = cerulean.fetch_slicks(DELTA)
    print(f"Cerulean: {len(slicks)} slicks in the Niger Delta")
    reviewed, machine = [], []
    for s in slicks:
        p = s["properties"]
        if not s.get("geometry") or not p.get("slick_timestamp") or not p.get("s1_scene_id"):
            continue
        if p.get("hitl_cls_name") in cerulean.OIL_CLASSES:
            reviewed.append(s)
        elif p.get("hitl_cls_name") is None and (p.get("machine_confidence") or 0) >= 0.9:
            machine.append(s)
    rng.shuffle(machine)
    machine = machine[:max_machine]

    labels, footprints = [], []
    for group, verified in ((reviewed, True), (machine, False)):
        for s in group:
            geom = shape(s["geometry"])
            day = s["properties"]["slick_timestamp"][:10]
            footprints.append((geom, day[:7]))
            # Large reviewed slicks get a second point; keeps oil vs clean roughly balanced.
            n = 2 if verified and (s["properties"].get("area") or 0) > 1e6 else 1
            for i, pt in enumerate(points_inside(geom, n)):
                labels.append(point_label(pt.x, pt.y, 1, day, "cerulean-reviewed" if verified else "cerulean-machine",
                                          verified, f"cer-{s['properties']['id']}-{i}", s["properties"]["s1_scene_id"]))
    print(f"  oil labels: {len(labels)} ({len(reviewed)} reviewed slicks, {len(machine)} machine slicks)")
    return labels, footprints


def random_day() -> str:
    return f"{rng.choice(list(YEARS))}-{rng.randint(1, 12):02d}-15"


def clean_labels(per_class: int, footprints) -> list[dict]:
    wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    classes = list(WORLDCOVER)
    pts = wc.stratifiedSample(
        numPoints=0, classBand="Map", region=ee.Geometry.Rectangle(DELTA), scale=30,
        classValues=classes, classPoints=[per_class] * len(classes), seed=87, geometries=True,
    ).getInfo()["features"]
    labels = []
    for i, f in enumerate(pts):
        if f["properties"]["Map"] not in WORLDCOVER:
            continue
        lon, lat = f["geometry"]["coordinates"]
        day = random_day()
        # Never call a point "clean" if a known slick covered it that month.
        if any(g.distance(Point(lon, lat)) < 0.05 and m == day[:7] for g, m in footprints):
            continue
        labels.append(point_label(lon, lat, 0, day, f"worldcover-{WORLDCOVER[f['properties']['Map']]}", False, f"wc-{i}"))
    print(f"  clean labels: {len(labels)}")
    return labels


def water_labels(n_scenes: int, per_scene: int, footprints) -> list[dict]:
    delta = ee.Geometry.Rectangle(DELTA)
    water = (
        ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence").unmask(0).gte(80)
        .Or(ee.ImageCollection("ESA/WorldCover/v200").first().eq(80).unmask(0))
    )
    scenes = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterBounds(delta)
        .filterDate(f"{YEARS[0]}-01-01", f"{YEARS[-1] + 1}-01-01")
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .randomColumn("r", 87).sort("r").limit(n_scenes)
    )
    info = scenes.aggregate_array("system:index").zip(scenes.aggregate_array("system:time_start")).getInfo()
    labels = []
    for sid, t in info:
        try:
            img = ee.Image(f"COPERNICUS/S1_GRD/{sid}")
            gfs = (
                ee.ImageCollection("NOAA/GFS0P25")
                .filter(ee.Filter.eq("forecast_hours", 0))
                .filterDate(ee.Date(t).advance(-3, "hour"), ee.Date(t).advance(3, "hour"))
            )
            if gfs.size().getInfo() == 0:
                continue
            g = gfs.first()
            wind = g.select("u_component_of_wind_10m_above_ground").hypot(g.select("v_component_of_wind_10m_above_ground"))
            dark = img.select("VV").focalMedian(50, "circle", "meters").lt(-22)
            region = img.geometry().intersection(delta, 100)
            look = dark.And(water).And(wind.lt(3)).selfMask().rename("m").sample(
                region=region, scale=50, numPixels=2000, seed=87, geometries=True,
            ).limit(per_scene).map(lambda f: f.set("kind", "lookalike-lowwind"))
            clean = water.selfMask().rename("m").sample(
                region=region, scale=100, numPixels=500, seed=88, geometries=True,
            ).limit(per_scene).map(lambda f: f.set("kind", "water-scene"))
            pts = look.merge(clean).getInfo()["features"]
        except ee.EEException as e:
            print(f"  skip {sid[:40]}: {str(e)[:80]}")
            continue
        day = date.fromtimestamp(t / 1000).isoformat()
        for i, f in enumerate(pts):
            lon, lat = f["geometry"]["coordinates"]
            if any(g_.distance(Point(lon, lat)) < 0.05 and m == day[:7] for g_, m in footprints):
                continue
            kind = f["properties"]["kind"]
            labels.append(point_label(lon, lat, 0, day, kind, False, f"{kind[:2]}-{sid[-6:]}-{i}", sid))
    n_look = sum(lb["properties"]["source"] == "lookalike-lowwind" for lb in labels)
    print(f"  clean water labels: {len(labels) - n_look}, look-alikes: {n_look} (from {len(info)} scenes)")
    return labels


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-machine-slicks", type=int, default=300)
    ap.add_argument("--negatives-per-class", type=int, default=150)
    ap.add_argument("--water-scenes", type=int, default=150)
    ap.add_argument("--per-scene", type=int, default=6, help="look-alikes and clean-water points per scene")
    ap.add_argument("--merge", action="store_true", help="keep existing labels (e.g. hand-made ones) and add to them")
    args = ap.parse_args()

    auth.init()
    oil, footprints = oil_labels(args.max_machine_slicks)
    clean = clean_labels(args.negatives_per_class, footprints)
    looks = water_labels(args.water_scenes, args.per_scene, footprints)

    feats = oil + clean + looks
    if args.merge and LABELS.exists():
        existing = json.loads(LABELS.read_text())["features"]
        auto = ("cerulean", "worldcover", "lookalike", "water-scene")
        kept = [f for f in existing if not str(f["properties"].get("source", "")).startswith(auto)]
        feats = kept + feats
        print(f"  kept {len(kept)} existing hand-made labels")

    LABELS.parent.mkdir(parents=True, exist_ok=True)
    LABELS.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    n_oil = sum(f["properties"]["class"] == 1 for f in feats)
    print(f"\nWrote {len(feats)} labels ({n_oil} oil, {len(feats) - n_oil} clean) to {LABELS}")


if __name__ == "__main__":
    main()
