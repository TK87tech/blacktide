"""Upload inland candidates (from detect_inland.py --dry-run) for review in pipeline/gee/review_tool.js.

    py -3 pipeline/scripts/export_review.py                       # pipeline/output/inland_preview.json
    py -3 pipeline/scripts/export_review.py path/to/preview.json
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402

from blacktide import auth  # noqa: E402
from blacktide.config import ASSET_ROOT, OUTPUT  # noqa: E402

KEEP = ["id", "kind", "date", "area_ha", "confidence", "evidence", "ndvi_before", "ndvi_after",
        "vh_change_db", "creek_bank", "burned", "vv_anomaly_db"]


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else OUTPUT / "inland_preview.json"
    feats = json.loads(src.read_text())["features"]
    auth.init()
    fc = ee.FeatureCollection([
        ee.Feature(
            ee.Geometry.Point(f["geometry"]["coordinates"]),
            {k: f["properties"][k] for k in KEEP if f["properties"].get(k) is not None},
        )
        for f in feats
    ])
    asset = f"{ASSET_ROOT}/review_candidates"
    try:
        ee.data.deleteAsset(asset)
    except ee.EEException:
        pass
    task = ee.batch.Export.table.toAsset(fc, "blacktide_review_candidates", asset)
    try:
        task.start()
    except ee.EEException as e:
        if "already started" not in str(e):
            raise
    kinds = {}
    for f in feats:
        kinds[f["properties"]["kind"]] = kinds.get(f["properties"]["kind"], 0) + 1
    print(f"Uploading {len(feats)} candidates {kinds} to {asset} (task {task.id}).")
    print("Then paste pipeline/gee/review_tool.js into the Code Editor and press Run.")


if __name__ == "__main__":
    main()
