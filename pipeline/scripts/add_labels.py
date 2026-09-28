"""Merge labels printed by the Code Editor tools (label_tool.js / review_tool.js)
into pipeline/labels/labels.geojson. Re-adding the same label id replaces it.

    py -3 pipeline/scripts/add_labels.py reviewed.json [more.json ...]
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from blacktide.config import LABELS  # noqa: E402


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    current = json.loads(LABELS.read_text())["features"] if LABELS.exists() else []
    by_id = {f["properties"].get("id"): f for f in current}
    added = 0
    for path in sys.argv[1:]:
        for f in json.loads(Path(path).read_text(encoding="utf-8-sig"))["features"]:
            f["properties"].setdefault("verified", True)
            added += f["properties"].get("id") not in by_id
            by_id[f["properties"].get("id")] = f
    LABELS.write_text(json.dumps({"type": "FeatureCollection", "features": list(by_id.values())}))
    feats = list(by_id.values())
    oil = sum(int(f["properties"]["class"]) == 1 for f in feats)
    print(f"{added} new labels. Total {len(feats)} ({oil} oil, {len(feats) - oil} clean).")


if __name__ == "__main__":
    main()
