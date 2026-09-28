"""Step 1 — build the training table from labelled locations.

Reads pipeline/labels/labels.geojson (see pipeline/labels/README.md), samples the
Sentinel-1/2 feature stack for the month of each label, then:
  * saves pipeline/output/training_samples.csv   (used by train.py)
  * exports an Earth Engine table asset          (used by detect.py)

    py -3 pipeline/scripts/sample_training.py
"""

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402

from blacktide import auth, features  # noqa: E402
from blacktide.config import ALL_FEATURES, ASSET_ROOT, LABELS, OUTPUT, SCALE  # noqa: E402


def month_window(iso: str) -> tuple[str, str]:
    y, m = int(iso[:4]), int(iso[5:7])
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{y}-{m:02d}-01", f"{ny}-{nm:02d}-01"


def main():
    auth.init()
    labels = json.loads(LABELS.read_text())["features"]
    by_month = defaultdict(list)
    for i, f in enumerate(labels):
        p = f["properties"]
        f["properties"] = {"class": int(p["class"]), "date": p["date"], "label_id": p.get("id", f"L{i:05d}")}
        by_month[month_window(p["date"])].append(f)

    parts = []
    for (start, end), feats in sorted(by_month.items()):
        fc = ee.FeatureCollection(feats)
        img = features.stack(fc.geometry().bounds().buffer(2000), start, end)
        parts.append(img.sampleRegions(collection=fc, properties=["class", "date", "label_id"], scale=SCALE, geometries=True))
        print(f"{start}: {len(feats)} labels")

    samples = ee.FeatureCollection(parts).flatten().filter(ee.Filter.notNull(["VV"])).randomColumn("random", 87)

    OUTPUT.mkdir(parents=True, exist_ok=True)
    rows = samples.getInfo()["features"]
    cols = ["label_id", "date", "class", "random", *ALL_FEATURES]
    with open(OUTPUT / "training_samples.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r["properties"])
    print(f"Saved {len(rows)} samples to {OUTPUT / 'training_samples.csv'}")

    if ASSET_ROOT:
        task = ee.batch.Export.table.toAsset(samples, "blacktide_training_samples", f"{ASSET_ROOT}/training_samples")
        task.start()
        print(f"Export to {ASSET_ROOT}/training_samples started (task {task.id}). Create the folder first if needed.")


if __name__ == "__main__":
    main()
