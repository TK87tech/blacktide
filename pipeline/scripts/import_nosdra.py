"""Import NOSDRA official spill reports into web/data/events.json.

Every incident in the Delta since 2015 (latest record per incident, 'invalid' ones dropped),
placed in its State / LGA from geoBoundaries outlines, with the satellite impact score from
score_nosdra_impact.py where available.

    py -3 pipeline/scripts/import_nosdra.py            # uses pipeline/data/nosdra_spills.csv
    py -3 pipeline/scripts/import_nosdra.py --download # refresh the CSV from oilspillmonitor.ng first
"""

import argparse
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402
from shapely.geometry import Point, shape  # noqa: E402
from shapely.strtree import STRtree  # noqa: E402

from blacktide import nosdra  # noqa: E402
from blacktide.config import ROOT, WEB_DATA  # noqa: E402

DATA = ROOT / "pipeline" / "data"
CLEAR, POSSIBLE = -0.10, -0.05  # local dNDVI thresholds, from the known-site test


class Boundaries:
    def __init__(self, path: Path):
        feats = json.loads(path.read_text())["features"]
        self.geoms = [shape(f["geometry"]) for f in feats]
        self.names = [f["properties"]["shapeName"] for f in feats]
        self.tree = STRtree(self.geoms)

    def name(self, lon: float, lat: float) -> str | None:
        p = Point(lon, lat)
        for i in self.tree.query(p):
            if self.geoms[i].contains(p):
                return self.names[i]
        return None


def clean(text) -> str:
    s = re.sub(r"\s+", " ", str(text or "")).strip(" ,.")
    return s[:90] if s and s.lower() != "nan" else ""


def impact_verdict(v, scored: bool = True) -> str:
    if not scored:
        return "pending"
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "no clear imagery"
    if v <= CLEAR:
        return "clear vegetation damage"
    if v <= POSSIBLE:
        return "possible damage"
    return "not visible"


def num(v, nd=2):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else round(float(v), nd)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--download", action="store_true")
    args = ap.parse_args()
    if args.download:
        nosdra.download()

    d = nosdra.load("2015-01-01")
    states, lgas = Boundaries(DATA / "nga_ADM1.geojson"), Boundaries(DATA / "nga_ADM2.geojson")
    impact = {}
    if (DATA / "nosdra_impact.csv").exists():
        im = pd.read_csv(DATA / "nosdra_impact.csv")
        impact = {str(r.incidentnumber): r for r in im.itertuples()}

    events = []
    for r in d.itertuples():
        lon, lat = float(r.longitude), float(r.latitude)
        codes = [c.strip() for c in r.habitat_codes if c.strip()]
        habitat = ", ".join(nosdra.HABITATS.get(c, c) for c in codes) or "Not stated"
        cause_code = str(r.cause or "").split(":")[0].strip()
        sc = impact.get(str(r.incidentnumber))
        local = getattr(sc, "local_dNDVI", None) if sc is not None else None
        area_ha = (r.estimatedspillarea or 0) / 1e4 if not math.isnan(r.estimatedspillarea or 0) else 0
        site = clean(r.sitelocationname) or f"{clean(r.company) or 'Unknown operator'} facility"
        props = {
            "id": "NOS-" + re.sub(r"[^A-Za-z0-9]+", "-", str(r.incidentnumber)).strip("-")[:40],
            "date": r.incidentdate.date().isoformat(),
            "site": site,
            "lga": lgas.name(lon, lat) or "",
            "state": states.name(lon, lat) or "Offshore",
            "surface": r.surface,
            "area_ha": round(area_ha, 2),
            "confidence": 1.0,
            "status": "verified",
            "model": "nosdra",
            "sensors": [],
            "nosdra_match": True,
            "people_5km": 0,
            "mangrove_ha": 0,
            "source": "nosdra",
            "source_url": "https://nosdra.oilspillmonitor.ng/",
            "cause": nosdra.CAUSES.get(cause_code, "Other / not stated"),
            "operator": clean(r.company),
            "volume_bbl": num(r.bbl, 1),
            "habitat": habitat,
            "incident_number": str(r.incidentnumber),
            "features": {k: None for k in ("vv_db", "vh_db", "vv_vh_db", "glcm_entropy", "ndvi_delta", "ndwi", "osi")},
        }
        if r.surface == "land" and r.incidentdate <= pd.Timestamp("2025-10-31") and r.incidentdate >= pd.Timestamp("2017-04-01"):
            props["sat_impact"] = impact_verdict(local, scored=bool(impact))
            props["sat_local_dndvi"] = num(local, 3)
            props["sat_local_dvh"] = num(getattr(sc, "local_dVH", None) if sc is not None else None, 2)
            props["features"]["ndvi_delta"] = num(local, 3)
        events.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
                       "properties": props})

    events_path, meta_path = WEB_DATA / "events.json", WEB_DATA / "meta.json"
    existing = json.loads(events_path.read_text())["features"]
    kept = [e for e in existing if e["properties"].get("source") != "nosdra"]
    merged = sorted(kept + events, key=lambda e: e["properties"]["date"])
    events_path.write_text(json.dumps({"type": "FeatureCollection", "features": merged}, separators=(",", ":")))

    meta = json.loads(meta_path.read_text())
    meta.update({
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "period_start": merged[0]["properties"]["date"],
        "period_end": merged[-1]["properties"]["date"],
        "source": "Sea & coast: SkyTruth Cerulean (Sentinel-1). Land, swamp & creeks: NOSDRA official reports, "
                  "with a Sentinel-1/2 satellite impact score.",
        "model_version": "cerulean + nosdra",
    })
    meta_path.write_text(json.dumps(meta, indent=2))
    scored = [e for e in events if "sat_impact" in e["properties"]]
    verdicts = pd.Series([e["properties"]["sat_impact"] for e in scored]).value_counts().to_dict()
    print(f"{len(events)} NOSDRA incidents imported ({sum(e['properties']['surface'] == 'land' for e in events)} land/swamp); "
          f"satellite verdicts: {verdicts}. Total events: {len(merged)}")


if __name__ == "__main__":
    main()
