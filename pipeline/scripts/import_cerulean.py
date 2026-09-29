"""Import SkyTruth Cerulean slick detections as BlackTide's marine / coastal events.

Cerulean (https://cerulean.skytruth.org) detects oil slicks on every Sentinel-1
pass with a deep-learning model and has part of its output reviewed by people.
BlackTide's own models cover what Cerulean doesn't: land, creeks and estuaries.

Kept: every human-reviewed oil slick, plus machine detections with confidence
>= --min-confidence. Each event links back to its Cerulean page. If Earth Engine
is configured, events also get people-within-5 km (WorldPop) and mangrove area.

    py -3 pipeline/scripts/import_cerulean.py
    py -3 pipeline/scripts/import_cerulean.py --min-confidence 0.9 --no-enrich
"""

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shapely.geometry import shape  # noqa: E402

from blacktide import cerulean  # noqa: E402
from blacktide.config import AOIS, WEB_DATA  # noqa: E402
from blacktide.sites import SITES  # noqa: E402

SLICK_URL = "https://cerulean.skytruth.org/slicks/{id}"


def nearest_site(lat: float, lon: float):
    return min(SITES, key=lambda s: math.hypot(s[3] - lat, (s[4] - lon) * math.cos(math.radians(lat))))


def to_event(s: dict) -> dict:
    p = s["properties"]
    geom = shape(s["geometry"])
    c = geom.representative_point()
    name, lga, state, slat, slon, _ = nearest_site(c.y, c.x)
    km = math.hypot((slat - c.y) * 111, (slon - c.x) * 111 * math.cos(math.radians(c.y)))
    if km > 15:  # don't pin a slick 60 km out at sea on a village
        name = f"Offshore, {round(km)} km from {name}"
    reviewed = p.get("hitl_cls_name")
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(c.x, 5), round(c.y, 5)]},
        "properties": {
            "id": f"CER-{p['id']}",
            "date": p["slick_timestamp"][:10],
            "site": name,
            "lga": lga,
            "state": state,
            "surface": "water",
            "area_ha": round((p.get("area") or 0) / 1e4, 2),
            "confidence": round(p.get("machine_confidence") or 0, 3),
            "status": "verified" if reviewed in cerulean.OIL_CLASSES else "unverified",
            "model": "cerulean",
            "sensors": ["S1"],
            "nosdra_match": None,
            "people_5km": 0,
            "mangrove_ha": 0,
            "source": "cerulean",
            "source_url": SLICK_URL.format(id=p["id"]),
            "cause": reviewed if reviewed in cerulean.OIL_CLASSES else None,
            "features": {k: None for k in ("vv_db", "vh_db", "vv_vh_db", "glcm_entropy", "ndvi_delta", "ndwi", "osi")},
        },
        "_geom": s["geometry"],
    }


def enrich(events: list[dict]) -> None:
    """People within 5 km and mangrove area inside the slick, via Earth Engine (cheap: points + small polygons)."""
    import ee

    from blacktide import auth

    auth.init()
    pop = (
        ee.ImageCollection("WorldPop/GP/100m/pop")
        .filter(ee.Filter.eq("country", "NGA")).filter(ee.Filter.eq("year", 2020)).first()
    )
    mangrove = ee.ImageCollection("LANDSAT/MANGROVE_FORESTS").mosaic().unmask(0).multiply(ee.Image.pixelArea()).divide(1e4).rename("m")
    for i in range(0, len(events), 250):
        chunk = events[i:i + 250]
        fc = ee.FeatureCollection([
            ee.Feature(ee.Geometry(e["_geom"]), {"i": j}) for j, e in enumerate(chunk)
        ])
        out = fc.map(lambda f: f.set(
            "people", pop.reduceRegion(ee.Reducer.sum(), f.geometry().centroid(10).buffer(5000), 100).get("population"),
            "mangrove", mangrove.reduceRegion(ee.Reducer.sum(), f.geometry(), 30, maxPixels=1e8).get("m"),
        ))
        for r in out.aggregate_array("i").zip(out.aggregate_array("people")).zip(out.aggregate_array("mangrove")).getInfo():
            (j, people), mang = r
            chunk[j]["properties"]["people_5km"] = int(people or 0)
            chunk[j]["properties"]["mangrove_ha"] = round(mang or 0, 2)
        print(f"  enriched {min(i + 250, len(events))}/{len(events)}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-confidence", type=float, default=0.8)
    ap.add_argument("--no-enrich", action="store_true", help="skip the Earth Engine population / mangrove step")
    args = ap.parse_args()

    slicks = cerulean.fetch_slicks(AOIS["delta"])
    keep = [
        s for s in slicks
        if s.get("geometry") and s["properties"].get("slick_timestamp")
        and (s["properties"].get("hitl_cls_name") in cerulean.OIL_CLASSES
             or (s["properties"].get("hitl_cls_name") is None
                 and (s["properties"].get("machine_confidence") or 0) >= args.min_confidence))
    ]
    events = [to_event(s) for s in keep]
    print(f"Cerulean: {len(slicks)} slicks, keeping {len(events)} "
          f"({sum(e['properties']['status'] == 'verified' for e in events)} human-reviewed)")

    if not args.no_enrich:
        try:
            enrich(events)
        except Exception as e:  # noqa: BLE001 — enrichment is optional
            print(f"  enrichment skipped: {str(e)[:120]}")
    for e in events:
        e.pop("_geom", None)

    events_path, meta_path = WEB_DATA / "events.json", WEB_DATA / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    existing = [] if meta.get("sample", True) else json.loads(events_path.read_text())["features"]
    # Replace previous Cerulean imports; keep BlackTide's own detections and analyst decisions.
    old = {e["properties"]["id"]: e for e in existing}
    merged = [e for e in existing if e["properties"].get("source") != "cerulean"]
    for e in events:
        prev = old.get(e["properties"]["id"])
        if prev and prev["properties"].get("nosdra_match") is not None:
            e["properties"]["nosdra_match"] = prev["properties"]["nosdra_match"]
        merged.append(e)
    merged.sort(key=lambda e: e["properties"]["date"])
    events_path.write_text(json.dumps({"type": "FeatureCollection", "features": merged}, separators=(",", ":")))

    dates = [e["properties"]["date"] for e in merged]
    sources = sorted({e["properties"].get("source", "blacktide") for e in merged})
    meta.update({
        "sample": False,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "period_start": min(dates),
        "period_end": max(dates),
        "model_version": " + ".join(sorted({e["properties"]["model"] for e in merged})),
        "aoi": "Niger Delta (Rivers, Bayelsa, Delta, Akwa Ibom) and coastal waters",
        "source": "Marine: SkyTruth Cerulean (Sentinel-1). Land & creeks: BlackTide models (Sentinel-1/2)."
        if "blacktide" in sources else "Marine: SkyTruth Cerulean (Sentinel-1). Land & creek detections coming soon.",
    })
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"Wrote {len(merged)} events ({len(events)} from Cerulean) to {events_path}")


if __name__ == "__main__":
    main()
