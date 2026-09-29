"""Can satellites see known land / swamp spills? A sensitivity test on NOSDRA incidents.

For each reported spill (land or swamp, big enough to matter, 2018-2025) and for random
control points (natural cover, no reported spill within 2 km), compare the dry season
before the incident with the dry season after it:

  * dNDVI and dVH at the spill core (100 m radius)
  * the same in the surrounding ring (300-1000 m), which absorbs regional change
    (drought, haze, seasonal differences)
  * local change = core change - ring change   (negative = the spot died back more
    than its surroundings)

If spill sites show clearly more negative local change than controls, the method works
and these sites become positive training labels. Runs as one Earth Engine batch task.

    py -3 pipeline/scripts/test_known_sites.py --max-sites 150
"""

import argparse
import json
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402
import pandas as pd  # noqa: E402

from blacktide import auth, sentinel2  # noqa: E402
from blacktide.config import ASSET_ROOT, OUTPUT, ROOT  # noqa: E402

NOSDRA = ROOT / "pipeline" / "data" / "nosdra_spills.csv"
DELTA = [4.8, 3.9, 8.6, 6.6]


def load_sites(min_area_m2: float, min_bbl: float, max_sites: int) -> pd.DataFrame:
    d = pd.read_csv(NOSDRA, on_bad_lines="skip", engine="python")
    for c in ("latitude", "longitude", "estimatedspillarea"):
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d["bbl"] = pd.to_numeric(d["estimatedquantity"].astype(str).str.extract(r"([\d.]+)")[0], errors="coerce")
    d["incidentdate"] = pd.to_datetime(d["incidentdate"], errors="coerce")
    d = d.dropna(subset=["latitude", "longitude", "incidentdate"])
    d = d[d.latitude.between(DELTA[1], DELTA[3]) & d.longitude.between(DELTA[0], DELTA[2])]
    d = d[d.incidentdate.between("2018-01-01", "2025-06-30")]
    d = d[d["spillareahabitat"].astype(str).str.contains("la|sw", regex=True)]
    big = d[(d.estimatedspillarea >= min_area_m2) | (d.bbl >= min_bbl)]
    big = big.drop_duplicates(subset=["incidentnumber"]).sort_values("estimatedspillarea", ascending=False)
    return big.head(max_sites), d


def seasons(ts: pd.Timestamp):
    """(before, after) dry seasons around the incident; season k = Nov k-1 .. Mar k."""
    y, m = ts.year, ts.month
    return (y, y + 1) if m >= 4 else (y - 1, y)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-area-m2", type=float, default=5000)
    ap.add_argument("--min-bbl", type=float, default=50)
    ap.add_argument("--max-sites", type=int, default=150)
    ap.add_argument("--controls", type=int, default=150)
    args = ap.parse_args()

    sites, all_incidents = load_sites(args.min_area_m2, args.min_bbl, args.max_sites)
    print(f"{len(sites)} spill sites selected (area >= {args.min_area_m2} m² or >= {args.min_bbl} bbl)")

    auth.init()
    rows = []
    for _, r in sites.iterrows():
        b, a = seasons(r.incidentdate)
        rows.append({"lon": r.longitude, "lat": r.latitude, "before": b, "after": a, "group": "spill",
                     "ref": str(r.incidentnumber), "area_m2": float(r.estimatedspillarea) if pd.notna(r.estimatedspillarea) else 0.0, "bbl": float(r.bbl) if pd.notna(r.bbl) else 0.0,
                     "habitat": str(r.spillareahabitat), "date": r.incidentdate.date().isoformat()})

    # Controls: natural-cover points with no reported spill within ~2 km, matched on season years.
    wc = ee.ImageCollection("ESA/WorldCover/v200").first()
    natural = wc.remap([10, 20, 90, 95], [1, 1, 1, 1], 0).selfMask()
    pts = natural.sample(region=ee.Geometry.Rectangle(DELTA), scale=100, numPixels=args.controls * 6,
                         seed=87, geometries=True).getInfo()["features"]
    inc = all_incidents[["latitude", "longitude"]].to_numpy()
    rng = random.Random(87)
    years = [(x["before"], x["after"]) for x in rows]
    for f in pts:
        lon, lat = f["geometry"]["coordinates"]
        if ((abs(inc[:, 0] - lat) < 0.018) & (abs(inc[:, 1] - lon) < 0.018)).any():
            continue
        b, a = rng.choice(years)
        rows.append({"lon": lon, "lat": lat, "before": b, "after": a, "group": "control", "ref": "", "area_m2": 0,
                     "bbl": 0, "habitat": "", "date": ""})
        if sum(x["group"] == "control" for x in rows) >= args.controls:
            break
    print(f"{sum(x['group'] == 'control' for x in rows)} control points")

    def season_img(pt, k):
        region = pt.buffer(1500)
        ndvi = sentinel2.collection(region, ee.Date.fromYMD(ee.Number(k).subtract(1), 11, 1), ee.Date.fromYMD(k, 4, 1), clear=0.8).select("NDVI").median()
        vh = (ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(region)
              .filterDate(ee.Date.fromYMD(ee.Number(k).subtract(1), 11, 1), ee.Date.fromYMD(k, 4, 1))
              .filter(ee.Filter.eq("instrumentMode", "IW"))
              .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH")).select("VH").median())
        return ndvi.addBands(vh)

    def measure(f):
        pt = f.geometry()
        before, after = season_img(pt, f.get("before")), season_img(pt, f.get("after"))
        diff = after.subtract(before).rename(["dNDVI", "dVH"])
        core = diff.reduceRegion(ee.Reducer.mean(), pt.buffer(100), 20)
        ring = diff.reduceRegion(ee.Reducer.mean(), pt.buffer(1000).difference(pt.buffer(300), 5), 40)
        return f.set({"core_dNDVI": core.get("dNDVI"), "core_dVH": core.get("dVH"),
                      "ring_dNDVI": ring.get("dNDVI"), "ring_dVH": ring.get("dVH")})

    fc = ee.FeatureCollection([ee.Feature(ee.Geometry.Point([x["lon"], x["lat"]]), x) for x in rows]).map(measure)
    asset = f"{ASSET_ROOT}/known_site_test"
    try:
        ee.data.deleteAsset(asset)
    except ee.EEException:
        pass
    task = ee.batch.Export.table.toAsset(fc, "blacktide_known_site_test", asset)
    task.start()
    print("Submitted; waiting…", flush=True)
    while task.status()["state"] not in ("COMPLETED", "FAILED", "CANCELLED"):
        time.sleep(20)
    st = task.status()
    print(f"{st['state']} — {(st.get('batch_eecu_usage_seconds') or 0) / 3600:.2f} EECU-hours {st.get('error_message', '')}")
    if st["state"] != "COMPLETED":
        return
    out = pd.DataFrame([f["properties"] for f in ee.FeatureCollection(asset).getInfo()["features"]])
    out["local_dNDVI"] = out.core_dNDVI - out.ring_dNDVI
    out["local_dVH"] = out.core_dVH - out.ring_dVH
    OUTPUT.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUTPUT / "known_site_test.csv", index=False)

    s, c = out[out.group == "spill"].dropna(subset=["local_dNDVI"]), out[out.group == "control"].dropna(subset=["local_dNDVI"])
    print(f"\nwith usable imagery: {len(s)} spill sites, {len(c)} controls")
    for col in ("local_dNDVI", "local_dVH"):
        print(f"{col}: spill median {s[col].median():+.3f}  control median {c[col].median():+.3f}")
    for thr in (-0.05, -0.1, -0.15):
        print(f"local dNDVI <= {thr}: spill {(s.local_dNDVI <= thr).mean():.0%}  control {(c.local_dNDVI <= thr).mean():.0%}")
    # AUC: probability a random spill site died back more (locally) than a random control
    auc = sum((a < b) + 0.5 * (a == b) for a in s.local_dNDVI for b in c.local_dNDVI) / (len(s) * len(c))
    print(f"AUC (local dNDVI separates spills from controls): {auc:.2f}   0.5 = no better than chance")
    big = s[s.area_m2 >= 10000]
    if len(big):
        print(f"spills >= 1 ha ({len(big)}): local dNDVI median {big.local_dNDVI.median():+.3f}, "
              f"<= -0.1 in {(big.local_dNDVI <= -0.1).mean():.0%}")


if __name__ == "__main__":
    main()
