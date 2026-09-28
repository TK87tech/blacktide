"""Step 0 — verify Earth Engine access before running the pipeline.

Checks authentication, the datasets the pipeline reads, and creates the
BlackTide asset folder in your project if it doesn't exist yet.

    py -3 pipeline/scripts/check_setup.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402

from blacktide import auth, features, sentinel1, sentinel2  # noqa: E402
from blacktide.config import AOIS, ASSET_ROOT, GEE_PROJECT, LABELS  # noqa: E402


def ok(msg):
    print(f"  [ok]   {msg}")


def fail(msg):
    print(f"  [FAIL] {msg}")


def main():
    print("Earth Engine")
    try:
        auth.init()
        ok(f"initialised (project: {GEE_PROJECT or 'from service account'})")
    except Exception as e:  # noqa: BLE001
        fail(f"could not initialise: {e}")
        print("\n  Run `earthengine authenticate` and set GEE_PROJECT to your Cloud project id.")
        return 1

    print("Data access (pilot area, January 2024)")
    aoi = features.bbox(AOIS["pilot"])
    checks = {
        "Sentinel-1 GRD scenes": lambda: sentinel1.collection(aoi, "2024-01-01", "2024-02-01").size(),
        "Sentinel-2 SR scenes": lambda: sentinel2.collection(aoi, "2024-01-01", "2024-02-01").size(),
        "WorldPop Nigeria 2020": lambda: ee.ImageCollection("WorldPop/GP/100m/pop")
        .filter(ee.Filter.eq("country", "NGA")).filter(ee.Filter.eq("year", 2020)).size(),
    }
    failed = False
    for name, fn in checks.items():
        try:
            n = fn().getInfo()
            (ok if n else fail)(f"{name}: {n}")
            failed |= not n
        except Exception as e:  # noqa: BLE001
            fail(f"{name}: {e}")
            failed = True

    print("Feature stack")
    try:
        vals = features.stack(aoi, "2024-01-01", "2024-02-01").reduceRegion(
            ee.Reducer.mean(), aoi.centroid(1).buffer(2000), 20, maxPixels=1e8
        ).getInfo()
        ok("computed: " + ", ".join(f"{k}={v:.2f}" for k, v in vals.items() if v is not None))
    except Exception as e:  # noqa: BLE001
        fail(f"feature stack: {e}")
        failed = True

    print("Asset folder")
    if not ASSET_ROOT:
        fail("GEE_PROJECT not set, so no asset folder can be used")
        failed = True
    else:
        try:
            ee.data.getAsset(ASSET_ROOT)
            ok(f"{ASSET_ROOT} exists")
        except ee.EEException:
            ee.data.createAsset({"type": "FOLDER"}, ASSET_ROOT)
            ok(f"created {ASSET_ROOT}")

    print("Labels")
    labels_ready = False
    if LABELS.exists():
        import json

        feats = json.loads(LABELS.read_text())["features"]
        oil = sum(1 for f in feats if int(f["properties"]["class"]) == 1)
        labels_ready = oil >= 50 and len(feats) - oil >= 50
        (ok if labels_ready else fail)(
            f"{len(feats)} labels ({oil} oil, {len(feats) - oil} clean) — aim for 200+ of each"
        )
    else:
        fail("pipeline/labels/labels.geojson not found — create it with pipeline/gee/label_tool.js")

    print()
    if failed:
        print("Fix the items marked FAIL above.")
    elif not labels_ready:
        print("Earth Engine is ready. Next: collect labels, then run sample_training.py.")
    else:
        print("All good. Next: py -3 pipeline/scripts/sample_training.py")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
