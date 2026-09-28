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
    # Coastal test area off Akwa Ibom (Qua Iboe) — well covered by Cerulean, for checking the water model.
    "coast_east": [7.80, 4.00, 8.60, 4.60],
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
ALL_FEATURES = SAR_FEATURES + OPTICAL_FEATURES  # land model: monthly SAR + optical

# Water model: one Sentinel-1 pass at a time, with the wind at that moment.
# (No texture: GLCM carried ~18% of the model's decisions but most of the compute.)
SCENE_FEATURES = ["VV", "VH", "VV_VH", "VV_local", "wind", "angle"]
WATER_SCALE = 40        # metres; detection resolution for the water model
DARK_SPOT_DB = -18.0    # stage 1: only pixels darker than this go to the model (98% of oil labels are < -19 dB)
WATER_TREES = 100
# Slicks can't be told apart from calm water below ~2 m/s, and are washed out above ~12 m/s.
MIN_WIND, MAX_WIND = 2.0, 12.0

RF_TREES = 300
DETECTION_THRESHOLD = 0.7   # probability of oil needed to flag a pixel
MIN_PIXELS = 10             # drop specks smaller than this (≈0.4 ha at 20 m)
