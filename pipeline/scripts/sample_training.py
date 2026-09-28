"""Step 1 — build the training tables from labelled locations.

Reads pipeline/labels/labels.geojson (see pipeline/labels/README.md) and builds two tables:

  * water — labels with a "scene" (Sentinel-1 pass id) are sampled from that exact
            pass with SCENE_FEATURES (incl. wind at that moment)
  * land  — all other labels are sampled from the monthly SAR + optical stack

For each: pipeline/output/training_<domain>.csv (train.py) and an Earth Engine
table asset <ASSET_ROOT>/training_<domain> (detect.py).

    py -3 pipeline/scripts/sample_training.py
"""

import csv
import json
import hashlib
import time
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402

from blacktide import auth, features, sentinel1  # noqa: E402
from blacktide.config import (  # noqa: E402
    ALL_FEATURES, ASSET_ROOT, LABELS, OPTICAL_FEATURES, OUTPUT, SAR_FEATURES, SCALE, SCENE_FEATURES,
)

PROPS = ["class", "date", "label_id", "source", "verified"]
MISSING = -9999  # sampleRegions drops a point if ANY band is masked; possibly-masked bands get this instead


def month_window(iso: str) -> tuple[str, str]:
    y, m = int(iso[:4]), int(iso[5:7])
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{y}-{m:02d}-01", f"{ny}-{nm:02d}-01"


def _sample(img: ee.Image, feats: list[dict], nullable: list[str]) -> list[dict]:
    rows = img.sampleRegions(
        collection=ee.FeatureCollection(feats), properties=PROPS, scale=SCALE, geometries=True, tileScale=4
    ).getInfo()["features"]
    for r in rows:
        p = r["properties"]
        for k in nullable:
            if p.get(k) == MISSING:
                p[k] = None
    return rows


def sample_land(window: tuple[str, str], feats: list[dict]) -> list[dict]:
    region = ee.FeatureCollection(feats).geometry().bounds().buffer(2000)
    img = features.stack(region, *window)
    img = img.select(SAR_FEATURES).addBands(img.select(OPTICAL_FEATURES).unmask(MISSING))
    return _sample(img, feats, OPTICAL_FEATURES)


def sample_water(scene: str, feats: list[dict]) -> list[dict]:
    img = ee.Image(sentinel1.scene_features(ee.Image(f"COPERNICUS/S1_GRD/{scene}")))
    img = img.select([b for b in SCENE_FEATURES if b != "wind"]).addBands(img.select("wind").unmask(MISSING))
    return _sample(img, feats, ["wind"])


def with_retry(fn, key, feats, tries=3):
    for attempt in range(tries):
        try:
            return fn(key, feats)
        except Exception:  # noqa: BLE001 — network hiccups and EE "too many requests"
            if attempt == tries - 1:
                raise
            time.sleep(5 * (attempt + 1))


def run(groups: dict, fn, label: str) -> list[dict]:
    rows, failed = [], []
    with ThreadPoolExecutor(max_workers=8) as pool:
        jobs = {pool.submit(with_retry, fn, key, fs): key for key, fs in groups.items()}
        for n, job in enumerate(as_completed(jobs), 1):
            try:
                rows.extend(job.result())
            except Exception as e:  # noqa: BLE001
                failed.append(jobs[job])
                print(f"  {label} {str(jobs[job])[:60]}: FAILED {str(e)[:100]}")
            if n % 50 == 0 or n == len(jobs):
                print(f"  {label}: {n}/{len(jobs)} groups, {len(rows)} samples")
    if failed:
        print(f"  {label}: {len(failed)} groups failed")
    return rows


def split_key(label_id: str) -> float:
    """Stable 0–1 value per label, so the 80/20 split doesn't change between runs."""
    return int(hashlib.sha1(str(label_id).encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def save(rows: list[dict], domain: str, feature_cols: list[str]) -> None:
    for r in rows:
        r["properties"]["random"] = split_key(r["properties"]["label_id"])

    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / f"training_{domain}.csv"
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["label_id", "date", "class", "source", "verified", "random", *feature_cols], extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r["properties"])
    n_oil = sum(r["properties"]["class"] == 1 for r in rows)
    print(f"Saved {len(rows)} {domain} samples ({n_oil} oil) to {path}")

    if ASSET_ROOT and rows:
        asset_id = f"{ASSET_ROOT}/training_{domain}"
        try:
            ee.data.deleteAsset(asset_id)
        except ee.EEException:
            pass
        fc = ee.FeatureCollection([
            ee.Feature(ee.Geometry.Point(r["geometry"]["coordinates"]), {k: v for k, v in r["properties"].items() if v is not None})
            for r in rows
        ])
        task = ee.batch.Export.table.toAsset(fc, f"blacktide_training_{domain}", asset_id)
        task.start()
        print(f"  uploading to {asset_id} (task {task.id})")


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["water", "land"], help="rebuild just one table")
    args = ap.parse_args()
    auth.init()
    labels = json.loads(LABELS.read_text())["features"]
    water, land = defaultdict(list), defaultdict(list)
    for i, f in enumerate(labels):
        p = f["properties"]
        src = p.get("source", "manual")
        props = {
            "class": int(p["class"]),
            "date": p["date"],
            "label_id": p.get("id", f"L{i:05d}"),
            "source": src,
            "verified": int(bool(p.get("verified", src in ("manual", "visual", "field", "review")))),
        }
        feat = {"type": "Feature", "geometry": f["geometry"], "properties": props}
        if p.get("scene"):
            water[p["scene"]].append(feat)
        else:
            land[month_window(p["date"])].append(feat)
    print(f"{len(labels)} labels: {sum(map(len, water.values()))} water across {len(water)} passes, "
          f"{sum(map(len, land.values()))} land across {len(land)} months")

    if args.only != "land":
        save(run(water, sample_water, "water"), "water", SCENE_FEATURES)
    if args.only != "water":
        save(run(land, sample_land, "land"), "land", ALL_FEATURES)
    print("detect.py needs both uploads finished (a few minutes).")


if __name__ == "__main__":
    main()
