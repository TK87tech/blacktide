"""NOSDRA Nigerian Oil Spill Monitor incidents (https://nosdra.oilspillmonitor.ng).

Official spill reports compiled from Joint Investigation Visits. Downloaded as CSV from
https://oilspillmonitor.ng/api/spill-data.php?dataset=nosdra&format=csv
"""

import pandas as pd

from .config import ROOT

CSV = ROOT / "pipeline" / "data" / "nosdra_spills.csv"
URL = "https://oilspillmonitor.ng/api/spill-data.php?dataset=nosdra&format=csv"
DELTA = [4.8, 3.9, 8.6, 6.6]

CAUSES = {
    "sab": "Sabotage / theft",
    "eqf": "Equipment failure",
    "cor": "Corrosion",
    "ome": "Operational / maintenance error",
    "ytd": "Yet to be determined",
}
HABITATS = {"la": "Land", "sw": "Swamp", "ss": "Seasonal swamp", "iw": "Inland water", "of": "Offshore", "ns": "Nearshore"}
WATER_HABITATS = {"iw", "of", "ns"}


def download() -> None:
    import requests

    r = requests.get(URL, timeout=300)
    r.raise_for_status()
    CSV.parent.mkdir(parents=True, exist_ok=True)
    CSV.write_bytes(r.content)


def load(since: str = "2015-01-01") -> pd.DataFrame:
    """Latest record per incident, valid coordinates inside the Delta, not marked invalid."""
    d = pd.read_csv(CSV, on_bad_lines="skip", engine="python")
    for c in ("latitude", "longitude", "estimatedspillarea", "id"):
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d["bbl"] = pd.to_numeric(d["estimatedquantity"].astype(str).str.replace(",", ".").str.extract(r"([\d.]+)")[0], errors="coerce")
    d["incidentdate"] = pd.to_datetime(d["incidentdate"], errors="coerce")
    d = d.dropna(subset=["latitude", "longitude", "incidentdate"])
    d = d[d.latitude.between(DELTA[1], DELTA[3]) & d.longitude.between(DELTA[0], DELTA[2])]
    d = d[(d.incidentdate >= since) & (d["status"] != "invalid")]
    d["incidentnumber"] = d["incidentnumber"].fillna("id" + d["id"].astype(str))
    d = d.sort_values("id").drop_duplicates(subset=["incidentnumber"], keep="last")
    d["habitat_codes"] = d["spillareahabitat"].fillna("").astype(str).str.split(",")
    d["surface"] = d["habitat_codes"].map(lambda cs: "water" if cs and cs[0].strip() in WATER_HABITATS else "land")
    return d.reset_index(drop=True)
