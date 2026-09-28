"""Step 1 — build the training table from labelled locations.

Reads pipeline/labels/labels.geojson (see pipeline/labels/README.md), samples the
Sentinel-1/2 feature stack for the month of each label (months run in parallel),
then:
  * saves pipeline/output/training_samples.csv   (used by train.py)
  * exports an Earth Engine table asset          (used by detect.py)

    py -3 pipeline/scripts/sample_training.py
"""

import csv
import json
import random
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402

from blacktide import auth, features  # noqa: E402
from blacktide.config import (  # noqa: E402
    ALL_FEATURES, ASSET_ROOT, LABELS, OPTICAL_FEATURES, OUTPUT, SAR_FEATURES, SCALE,
)

PROPS = ["class", "date", "label_id", "source", "verified"]


def month_window(iso: str) -> tuple[str, str]:
    y, m = int(iso[:4]), int(iso[5:7])
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{y}-{m:02d}-01", f"{ny}-{nm:02d}-01"


MISSING = -9999  # sampleRegions drops a point if ANY band is masked; cloud-masked optical bands get this instead


def sample_month(start: str, end: str, feats: list[dict]) -> list[dict]:
    fc = ee.FeatureCollection(feats)
    img = features.stack(fc.geometry().bounds().buffer(2000), start, end)
    img = img.select(SAR_FEATURES).addBands(img.select(OPTICAL_FEATURES).unmask(MISSING))
    out = img.sampleRegions(collection=fc, properties=PROPS, scale=SCALE, geometries=True, tileScale=4)
    rows = out.getInfo()["features"]
    for r in rows:
        p = r["properties"]
        for k in OPTICAL_FEATURES:
            if p.get(k) == MISSING:
                p[k] = None
    return rows


def main():
    auth.init()
    labels = json.loads(LABELS.read_text())["features"]
    by_month = defaultdict(list)
    for i, f in enumerate(labels):
        p = f["properties"]
        f["properties"] = {
            "class": int(p["class"]),
            "date": p["date"],
            "label_id": p.get("id", f"L{i:05d}"),
            "source": p.get("source", "manual"),
            "verified": int(bool(p.get("verified", p.get("source", "manual") in ("manual", "visual", "field")))),
        }
        by_month[month_window(p["date"])].append(f)
    print(f"{len(labels)} labels across {len(by_month)} months")

    rows, failed = [], []
    with ThreadPoolExecutor(max_workers=8) as pool:
        jobs = {pool.submit(sample_month, s, e, fs): s for (s, e), fs in by_month.items()}
        for n, job in enumerate(as_completed(jobs), 1):
            month = jobs[job]
            try:
                got = job.result()
                rows.extend(got)
            except Exception as e:  # noqa: BLE001
                failed.append(month)
                print(f"  {month}: FAILED {str(e)[:100]}")
            if n % 10 == 0:
                print(f"  {n}/{len(jobs)} months done, {len(rows)} samples")

    rng = random.Random(87)
    for r in rows:
        r["properties"]["random"] = rng.random()

    OUTPUT.mkdir(parents=True, exist_ok=True)
    cols = ["label_id", "date", "class", "source", "verified", "random", *ALL_FEATURES]
    with open(OUTPUT / "training_samples.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r["properties"])
    n_oil = sum(r["properties"]["class"] == 1 for r in rows)
    print(f"Saved {len(rows)} samples ({n_oil} oil) to {OUTPUT / 'training_samples.csv'}")
    if failed:
        print(f"{len(failed)} months failed (re-run to retry): {', '.join(sorted(failed))}")

    if ASSET_ROOT:
        asset_id = f"{ASSET_ROOT}/training_samples"
        try:
            ee.data.deleteAsset(asset_id)
        except ee.EEException:
            pass
        fc = ee.FeatureCollection([
            ee.Feature(ee.Geometry.Point(r["geometry"]["coordinates"]), {k: v for k, v in r["properties"].items() if v is not None})
            for r in rows
        ])
        task = ee.batch.Export.table.toAsset(fc, "blacktide_training_samples", asset_id)
        task.start()
        print(f"Uploading samples to {asset_id} (task {task.id}) — takes a few minutes; detect.py needs it finished.")


if __name__ == "__main__":
    main()
