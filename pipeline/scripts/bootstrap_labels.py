"""Build a starting training set automatically — no clicking.

  * Oil on water   — SkyTruth Cerulean slick polygons (human-reviewed first,
                     then high-confidence machine detections)
  * Clean surfaces — stratified random points from ESA WorldCover classes
                     (mangrove, forest, cropland, grassland, wetland, built-up, water)
  * Look-alikes    — dark radar water where GFS winds were calm (< 3 m/s), i.e.
                     darkness explained by wind, not oil; labelled clean

Land / creek oil is NOT covered here — that comes from the Earth Engine
change-detection candidates you confirm afterwards.

    py -3 pipeline/scripts/bootstrap_labels.py
    py -3 pipeline/scripts/bootstrap_labels.py --lookalike-scenes 80 --negatives-per-class 150
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
WORLDCOVER = {10: "tree cover", 30: "grassland", 40: "cropland", 50: "built-up", 80: "water", 90: "wetland", 95: "mangrove"}

rng = random.Random(87)


def point_label(lon, lat, cls, day, source, verified, lid):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        "properties": {"id": lid, "class": cls, "date": day, "source": source, "verified": verified},
    }


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
        if not s.get("geometry") or not p.get("slick_timestamp"):
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
                                          verified, f"cer-{s['properties']['id']}-{i}"))
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


def lookalike_labels(n_scenes: int, per_scene: int, footprints) -> list[dict]:
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
            mask = dark.And(water).And(wind.lt(3)).selfMask().rename("m")
            pts = mask.sample(
                region=img.geometry().intersection(delta, 100), scale=50, numPixels=2000, seed=87, geometries=True,
            ).limit(per_scene).getInfo()["features"]
        except ee.EEException as e:
            print(f"  skip {sid[:40]}: {str(e)[:80]}")
            continue
        day = date.fromtimestamp(t / 1000).isoformat()
        for i, f in enumerate(pts):
            lon, lat = f["geometry"]["coordinates"]
            if any(g_.distance(Point(lon, lat)) < 0.05 and m == day[:7] for g_, m in footprints):
                continue
            labels.append(point_label(lon, lat, 0, day, "lookalike-lowwind", False, f"lk-{sid[-6:]}-{i}"))
    print(f"  look-alike labels: {len(labels)} from {len(info)} scenes")
    return labels


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-machine-slicks", type=int, default=300)
    ap.add_argument("--negatives-per-class", type=int, default=150)
    ap.add_argument("--lookalike-scenes", type=int, default=60)
    ap.add_argument("--lookalikes-per-scene", type=int, default=8)
    ap.add_argument("--merge", action="store_true", help="keep existing labels (e.g. hand-made ones) and add to them")
    args = ap.parse_args()

    auth.init()
    oil, footprints = oil_labels(args.max_machine_slicks)
    clean = clean_labels(args.negatives_per_class, footprints)
    looks = lookalike_labels(args.lookalike_scenes, args.lookalikes_per_scene, footprints)

    feats = oil + clean + looks
    if args.merge and LABELS.exists():
        existing = json.loads(LABELS.read_text())["features"]
        auto = ("cerulean", "worldcover", "lookalike")
        kept = [f for f in existing if not str(f["properties"].get("source", "")).startswith(auto)]
        feats = kept + feats
        print(f"  kept {len(kept)} existing hand-made labels")

    LABELS.parent.mkdir(parents=True, exist_ok=True)
    LABELS.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    n_oil = sum(f["properties"]["class"] == 1 for f in feats)
    print(f"\nWrote {len(feats)} labels ({n_oil} oil, {len(feats) - n_oil} clean) to {LABELS}")


if __name__ == "__main__":
    main()
