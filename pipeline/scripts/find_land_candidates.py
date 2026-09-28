"""Find likely land / creek-bank oil spill sites for human review.

Oil kills vegetation: mangrove and swamp forest along a creek, farmland along a
pipeline. For each year this compares the dry-season (Nov–Mar, the clearest
optical window) NDVI with the previous dry season and keeps patches that:

  * were healthy vegetation before   (NDVI_before >= 0.5)
  * lost a lot of it                 (NDVI drop >= 0.25)
  * are not built-up / not open water, and cover >= ~1 ha

Each candidate is flagged "creek bank" if it lies within 200 m of water. Fires
(including illegal refining sites) also kill vegetation, which is why these are
*candidates*: review them in pipeline/gee/review_tool.js, and your yes/no
answers become verified land labels (the "no"s are valuable too).

    py -3 pipeline/scripts/find_land_candidates.py --aoi pilot
    py -3 pipeline/scripts/find_land_candidates.py --aoi delta --years 2019 2025 --per-year 60
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ee  # noqa: E402

from blacktide import auth, features, sentinel2  # noqa: E402
from blacktide.config import AOIS, ASSET_ROOT, LABELS  # noqa: E402

CANDIDATES = LABELS.parent / "land_candidates.geojson"
LAND_COVER_OK = [10, 20, 30, 40, 90, 95]  # tree, shrub, grass, crop, wetland, mangrove (WorldCover)


def dry_ndvi(aoi, year: int) -> ee.Image:
    return sentinel2.collection(aoi, f"{year - 1}-11-01", f"{year}-04-01").select("NDVI").median()


def candidates_for_year(aoi, year: int, per_year: int, drop: float) -> list[dict]:
    before, after = dry_ndvi(aoi, year - 1), dry_ndvi(aoi, year)
    delta = after.subtract(before)
    wc = ee.ImageCollection("ESA/WorldCover/v200").first()
    water = features.water_mask()
    cand = (
        before.gte(0.5).And(delta.lte(-drop))
        .And(wc.remap(LAND_COVER_OK, [1] * len(LAND_COVER_OK), 0))
        .And(water.Not())
    )
    cand = cand.updateMask(cand.connectedPixelCount(200, True).gte(25)).selfMask()  # >= 25 px at 20 m ≈ 1 ha
    # Distance (m) to the nearest water pixel; the water mask is on the 30 m JRC grid.
    dist_water = water.fastDistanceTransform(30).sqrt().multiply(30)

    blobs = cand.addBands(delta.rename("drop")).reduceToVectors(
        geometry=aoi, scale=20, geometryType="polygon", eightConnected=True,
        reducer=ee.Reducer.mean(), maxPixels=1e10, tileScale=4,
    )
    blobs = blobs.map(lambda f: f.set("area_ha", f.geometry().area(1).divide(1e4)))
    # Rank by how much vegetation was lost: drop x area.
    blobs = blobs.map(lambda f: f.set("score", ee.Number(f.get("mean")).abs().multiply(f.get("area_ha")))).sort("score", False).limit(per_year)
    stats = ee.Image.cat(
        before.rename("ndvi_before"), after.rename("ndvi_after"), dist_water.rename("dist_water"), wc.rename("landcover")
    ).reduceRegions(blobs, ee.Reducer.mean().combine(ee.Reducer.mode().unweighted(), "", True), 20, tileScale=4)
    stats = stats.map(lambda f: f.set("centroid", f.geometry().centroid(1).coordinates()))
    rows = stats.select([".*"], None, False).getInfo()["features"]

    out = []
    for i, r in enumerate(rows):
        p = r["properties"]
        lon, lat = p["centroid"]
        out.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
            "properties": {
                "id": f"cand-{year}-{i:03d}",
                "year": year,
                "date": f"{year}-02-15",  # middle of the "after" dry season
                "area_ha": round(p["area_ha"], 2),
                "ndvi_before": round(p.get("ndvi_before_mean") or 0, 3),
                "ndvi_after": round(p.get("ndvi_after_mean") or 0, 3),
                "ndvi_drop": round(p.get("mean") or 0, 3),
                "creek_bank": bool((p.get("dist_water_mean") or 1e9) <= 200),
                "landcover": int(p.get("landcover_mode") or 0),
                "score": round(p["score"], 3),
            },
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", choices=AOIS, default="pilot")
    ap.add_argument("--years", nargs=2, type=int, default=[2019, 2025], metavar=("FIRST", "LAST"))
    ap.add_argument("--per-year", type=int, default=40)
    ap.add_argument("--drop", type=float, default=0.25, help="minimum NDVI loss")
    args = ap.parse_args()

    auth.init()
    aoi = features.bbox(AOIS[args.aoi])
    feats = []
    for year in range(args.years[0], args.years[1] + 1):
        try:
            got = candidates_for_year(aoi, year, args.per_year, args.drop)
        except ee.EEException as e:
            print(f"{year}: FAILED {str(e)[:120]}")
            continue
        feats.extend(got)
        print(f"{year}: {len(got)} candidates ({sum(f['properties']['creek_bank'] for f in got)} on creek banks)")

    CANDIDATES.parent.mkdir(parents=True, exist_ok=True)
    CANDIDATES.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"Wrote {len(feats)} candidates to {CANDIDATES}")

    if ASSET_ROOT and feats:
        asset_id = f"{ASSET_ROOT}/land_candidates"
        try:
            ee.data.deleteAsset(asset_id)
        except ee.EEException:
            pass
        fc = ee.FeatureCollection([
            ee.Feature(ee.Geometry.Point(f["geometry"]["coordinates"]), f["properties"]) for f in feats
        ])
        task = ee.batch.Export.table.toAsset(fc, "blacktide_land_candidates", asset_id)
        task.start()
        print(f"Uploading to {asset_id} (task {task.id}) — then open pipeline/gee/review_tool.js in the Code Editor.")


if __name__ == "__main__":
    main()
