"""Shared configuration for the BlackTide Earth Engine pipeline."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB_DATA = ROOT / "web" / "data"
OUTPUT = ROOT / "pipeline" / "output"
LABELS = ROOT / "pipeline" / "labels" / "labels.geojson"

# [west, south, east, north]
AOIS = {
    # Pilot: Bodo / Gokana, Ogoniland — well-documented spills, good for first validation.
    "pilot": [7.10, 4.50, 7.40, 4.80],
    # Full Niger Delta (Rivers, Bayelsa, Delta, Akwa Ibom + near-shore waters).
    "delta": [4.80, 3.90, 8.60, 6.60],
}

GEE_PROJECT = os.environ.get("GEE_PROJECT")
# Where the pipeline keeps its Earth Engine assets (training samples etc.).
ASSET_ROOT = os.environ.get("BLACKTIDE_ASSET_ROOT") or (
    f"projects/{GEE_PROJECT}/assets/blacktide" if GEE_PROJECT else None
)

SCALE = 20  # metres; Sentinel-1 GRD IW native is ~10 m, 20 m keeps regional runs tractable
SAR_FEATURES = ["VV", "VH", "VV_VH", "GLCM_ent", "GLCM_contrast", "GLCM_corr"]
OPTICAL_FEATURES = ["NDVI", "NDVI_delta", "NDWI", "MNDWI", "OSI"]
ALL_FEATURES = SAR_FEATURES + OPTICAL_FEATURES

RF_TREES = 300
DETECTION_THRESHOLD = 0.7   # probability of oil needed to flag a pixel
MIN_PIXELS = 10             # drop specks smaller than this (≈0.4 ha at 20 m)
