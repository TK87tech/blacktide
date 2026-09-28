"""Generate a realistic SAMPLE dataset so the web app works before the real
pipeline has run. Every file written here is flagged `"sample": true` and the UI
shows a banner while that flag is set.

    py -3 pipeline/scripts/generate_sample_data.py

Output: web/data/events.json, web/data/model_metrics.json, web/data/meta.json
"""

import json
import math
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

from blacktide.sites import SITES  # noqa: E402

OUT = ROOT / "web" / "data"
START = date(2017, 1, 1)
END = date(2026, 8, 31)
SEED = 87

random.seed(SEED)


def month_weight(d: date) -> float:
    # Dry season (Nov–Mar) is busier: easier access for theft, and clearer optical imagery.
    return 1.45 if d.month in (11, 12, 1, 2, 3) else 0.8


def year_weight(d: date) -> float:
    # A rough rise-and-fall shape across the archive rather than a flat rate.
    return {2017: 0.8, 2018: 0.95, 2019: 1.2, 2020: 1.05, 2021: 1.3,
            2022: 1.1, 2023: 1.0, 2024: 0.9, 2025: 0.95, 2026: 0.85}[d.year]


def jitter(lat: float, lon: float, km: float) -> tuple[float, float]:
    r = km * math.sqrt(random.random())
    t = random.random() * 2 * math.pi
    return lat + (r / 111.0) * math.sin(t), lon + (r / (111.0 * math.cos(math.radians(lat)))) * math.cos(t)


def sar_features(surface: str, is_oil: bool) -> dict:
    # Oil damps capillary waves -> darker VV/VH and smoother texture on water.
    if surface == "water":
        vv = random.gauss(-23.5, 1.8) if is_oil else random.gauss(-17.0, 2.0)
        vh = vv - random.gauss(7.5, 1.2)
        ent = random.gauss(3.1, 0.35) if is_oil else random.gauss(4.2, 0.4)
        ndvi_delta = random.gauss(0.0, 0.03)
        ndwi = random.gauss(0.32, 0.08)
    else:
        vv = random.gauss(-11.5, 1.6) if is_oil else random.gauss(-8.5, 1.5)
        vh = vv - random.gauss(6.0, 1.0)
        ent = random.gauss(4.6, 0.4)
        ndvi_delta = random.gauss(-0.22, 0.07) if is_oil else random.gauss(-0.05, 0.05)
        ndwi = random.gauss(-0.25, 0.1)
    return {
        "vv_db": round(vv, 2),
        "vh_db": round(vh, 2),
        "vv_vh_db": round(vv - vh, 2),
        "glcm_entropy": round(ent, 2),
        "ndvi_delta": round(ndvi_delta, 3),
        "ndwi": round(ndwi, 3),
        "osi": round(random.gauss(1.55 if is_oil else 1.2, 0.12), 3),
    }


def build_events() -> list[dict]:
    events = []
    d = START
    n = 0
    while d <= END:
        # Expected ~0.12 detections/day across the region, shaped by season and year.
        lam = 0.12 * month_weight(d) * year_weight(d)
        for _ in range(sum(random.random() < lam / 3 for _ in range(3))):
            name, lga, state, lat, lon, dominant = random.choice(SITES)
            surface = dominant if random.random() < 0.8 else ("land" if dominant == "water" else "water")
            plat, plon = jitter(lat, lon, 6 if "offshore" in name else 3)
            age_days = (END - d).days
            conf = min(0.99, max(0.52, random.betavariate(5, 2)))
            if age_days < 90:
                status = "unverified"
            else:
                status = random.choices(
                    ["verified", "false_positive", "unverified"],
                    weights=[0.62 * conf + 0.1, 0.35 * (1 - conf) + 0.03, 0.18],
                )[0]
            is_oil = status != "false_positive"
            area = math.exp(random.gauss(1.6 if surface == "land" else 2.6, 1.0))
            n += 1
            events.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(plon, 5), round(plat, 5)]},
                "properties": {
                    "id": f"BT-{d.year}-{n:04d}",
                    "date": d.isoformat(),
                    "site": name,
                    "lga": lga,
                    "state": state,
                    "surface": surface,
                    "area_ha": round(area, 2),
                    "confidence": round(conf, 3),
                    "status": status,
                    "model": "rf-sample",
                    "sensors": ["S1"] if (surface == "water" or random.random() < 0.35) else ["S1", "S2"],
                    "nosdra_match": (random.random() < 0.55) if status == "verified" else (False if status == "false_positive" else None),
                    "people_5km": int(math.exp(random.gauss(8.8, 0.9))) if "offshore" not in name else 0,
                    "mangrove_ha": round(max(0.0, area * random.uniform(0.1, 0.9)) if surface == "water" and "offshore" not in name else 0.0, 2),
                    "features": sar_features(surface, is_oil),
                },
            })
        d += timedelta(days=1)
    return events


def confusion(tp, fn, fp, tn):
    total = tp + fn + fp + tn
    oa = (tp + tn) / total
    pe = ((tp + fn) * (tp + fp) + (fp + tn) * (fn + tn)) / total**2
    precision = tp / (tp + fp)
    recall = tp / (tp + fn)
    return {
        "overall_accuracy": round(oa, 4),
        "kappa": round((oa - pe) / (1 - pe), 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(2 * precision * recall / (precision + recall), 4),
        "confusion": {"labels": ["Oil", "Non-oil"], "matrix": [[tp, fn], [fp, tn]]},
    }


def pr_curve(skill: float) -> list[dict]:
    pts = []
    for i in range(0, 21):
        r = i / 20
        p = 1 - (1 - skill) * (r ** 3) * 1.6 - 0.02 * r
        pts.append({"recall": round(r, 3), "precision": round(max(0.35, min(1.0, p)), 3)})
    return pts


def build_metrics() -> dict:
    rf = {"key": "rf", "name": "Random Forest", **confusion(412, 38, 44, 706)}
    ann = {"key": "ann", "name": "Neural Network (MLP)", **confusion(398, 52, 57, 693)}
    rf["feature_importance"] = [
        {"feature": "VV backscatter", "importance": 0.21},
        {"feature": "GLCM entropy", "importance": 0.16},
        {"feature": "VV/VH ratio", "importance": 0.14},
        {"feature": "VH backscatter", "importance": 0.12},
        {"feature": "NDVI change", "importance": 0.11},
        {"feature": "OSI", "importance": 0.09},
        {"feature": "MNDWI", "importance": 0.07},
        {"feature": "NDWI", "importance": 0.05},
        {"feature": "GLCM contrast", "importance": 0.03},
        {"feature": "GLCM correlation", "importance": 0.02},
    ]
    ann["feature_importance"] = None
    rf["pr_curve"] = pr_curve(0.86)
    ann["pr_curve"] = pr_curve(0.80)
    return {"sample": True, "train_samples": 4800, "test_samples": 1200, "split": "80/20 stratified", "models": [rf, ann]}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    events = build_events()
    (OUT / "events.json").write_text(json.dumps({"type": "FeatureCollection", "features": events}, separators=(",", ":")))
    (OUT / "model_metrics.json").write_text(json.dumps(build_metrics(), indent=2))
    meta = {
        "sample": True,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "period_start": START.isoformat(),
        "period_end": END.isoformat(),
        "model_version": "rf-sample",
        "aoi": "Niger Delta (Rivers, Bayelsa, Delta, Akwa Ibom)",
        "source": "Synthetic sample data. Replace by running the Earth Engine pipeline.",
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"Wrote {len(events)} sample events to {OUT}")


if __name__ == "__main__":
    main()
