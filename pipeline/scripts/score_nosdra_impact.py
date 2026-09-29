"""Satellite impact score for NOSDRA land / swamp incidents.

Same measure as test_known_sites.py (validated: clear local die-back at 23% of reported
spills vs 1% of control points): dry season before vs after the incident, spill core
(100 m) against its surrounding ring (300-1000 m), for Sentinel-2 NDVI and Sentinel-1 VH.
Writes pipeline/data/nosdra_impact.csv (incidentnumber → local dNDVI / dVH).

    py -3 pipeline/scripts/score_nosdra_impact.py --max-eecu 5
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402
import pandas as pd  # noqa: E402

from blacktide import auth, nosdra, sentinel2  # noqa: E402
from blacktide.config import ASSET_ROOT, ROOT  # noqa: E402

OUT = ROOT / "pipeline" / "data" / "nosdra_impact.csv"
# Measured: 272 points cost ~0 EECU-hours in the known-site test; budget conservatively.
EECU_PER_SITE = 0.002


def season_img(pt, k):
    region = pt.buffer(1500)
    start, end = ee.Date.fromYMD(ee.Number(k).subtract(1), 11, 1), ee.Date.fromYMD(k, 4, 1)
    ndvi = sentinel2.collection(region, start, end, clear=0.8).select("NDVI").median()
    vh = (ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(region).filterDate(start, end)
          .filter(ee.Filter.eq("instrumentMode", "IW"))
          .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH")).select("VH").median())
    return ndvi.addBands(vh)


def measure(f):
    pt = f.geometry()
    diff = season_img(pt, f.get("after")).subtract(season_img(pt, f.get("before"))).rename(["dNDVI", "dVH"])
    core = diff.reduceRegion(ee.Reducer.mean(), pt.buffer(100), 20)
    ring = diff.reduceRegion(ee.Reducer.mean(), pt.buffer(1000).difference(pt.buffer(300), 5), 40)
    return f.set({"core_dNDVI": core.get("dNDVI"), "core_dVH": core.get("dVH"),
                  "ring_dNDVI": ring.get("dNDVI"), "ring_dVH": ring.get("dVH")})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-eecu", type=float, default=5.0)
    args = ap.parse_args()

    d = nosdra.load("2017-04-01")
    d = d[(d.surface == "land") & (d.incidentdate <= "2025-10-31")]  # need a full dry season afterwards
    est = EECU_PER_SITE * len(d)
    print(f"{len(d)} land / swamp incidents to score — estimated {est:.1f} EECU-hours")
    if est > args.max_eecu:
        raise SystemExit(f"Over budget (--max-eecu {args.max_eecu}).")

    auth.init()
    feats = []
    for _, r in d.iterrows():
        y, m = r.incidentdate.year, r.incidentdate.month
        before, after = (y, y + 1) if m >= 4 else (y - 1, y)
        feats.append(ee.Feature(ee.Geometry.Point([float(r.longitude), float(r.latitude)]),
                                {"incidentnumber": str(r.incidentnumber), "before": before, "after": after}))
    fc = ee.FeatureCollection(feats).map(measure)
    asset = f"{ASSET_ROOT}/nosdra_impact"
    try:
        ee.data.deleteAsset(asset)
    except ee.EEException:
        pass
    task = ee.batch.Export.table.toAsset(fc, "blacktide_nosdra_impact", asset)
    task.start()
    print("Submitted; waiting…", flush=True)
    while task.status()["state"] not in ("COMPLETED", "FAILED", "CANCELLED"):
        time.sleep(30)
    st = task.status()
    print(f"{st['state']} — {(st.get('batch_eecu_usage_seconds') or 0) / 3600:.2f} EECU-hours {st.get('error_message', '')}")
    if st["state"] != "COMPLETED":
        return
    rows, fc_done = [], ee.FeatureCollection(asset)
    n = fc_done.size().getInfo()
    for off in range(0, n, 4000):  # getInfo is capped at 5000 features
        rows += [f["properties"] for f in ee.FeatureCollection(fc_done.toList(4000, off)).getInfo()["features"]]
    out = pd.DataFrame(rows)
    out["local_dNDVI"] = out.core_dNDVI - out.ring_dNDVI
    out["local_dVH"] = out.core_dVH - out.ring_dVH
    out[["incidentnumber", "local_dNDVI", "local_dVH", "core_dNDVI", "ring_dNDVI"]].to_csv(OUT, index=False)
    s = out.dropna(subset=["local_dNDVI"])
    print(f"Saved {len(out)} scores ({len(s)} with clear imagery) to {OUT}")
    print(f"clear die-back (<= -0.1): {(s.local_dNDVI <= -0.1).mean():.0%}, possible (<= -0.05): {(s.local_dNDVI <= -0.05).mean():.0%}")


if __name__ == "__main__":
    main()
