# BlackTide

**Satellite + AI oil spill intelligence for the Niger Delta.**

*Marée noire* (black tide) is the French term for an oil spill. BlackTide watches the whole Niger Delta from orbit every month. It combines Sentinel-1 radar, which sees through cloud, with Sentinel-2 optical imagery, and Random Forest and neural network models flag likely contamination on land and water. Every detection is published on an open map and dashboard.

It runs entirely on free tools and free tiers: no servers and no paid APIs.

> The site ships with a **synthetic sample dataset** so it works out of the box. Run the Earth Engine pipeline (below) to replace it with real detections.

## What's in the app

| Page | What it does |
|---|---|
| **Map** | Every detection on a dark or Sentinel-2 satellite basemap. Filter by surface, status and confidence. Play a time-lapse from 2017, or switch to hotspot view. |
| **Dashboard** | Headline figures, spills per year (land vs water), seasonality, detections by state, and recurring hotspots. |
| **Events** | Searchable, sortable table with CSV export. Each event has its own page with a before/after satellite view, radar and spectral signature, exposure figures and nearby repeat detections. |
| **Compare** | Swipe between yearly cloud-free Sentinel-2 mosaics (2016–2025) anywhere in the Delta. |
| **Model** | Accuracy, kappa, precision, recall, F1, confusion matrices and precision–recall curves (RF vs MLP), plus Random Forest feature importance. |
| **Method** | How the pipeline works and its known limitations. |

## How it works

```
Google Earth Engine (free, non-commercial)
  Sentinel-1 GRD ─ speckle filter ─ VV, VH, VV/VH, GLCM texture ─┐
  Sentinel-2 SR ── Cloud Score+ ── NDVI, ΔNDVI, NDWI, MNDWI, OSI ─┴─> Random Forest (fused + SAR-only fallback)
                                                                        │ probability > 0.7
                                                                        v
                                     vectorise → area, water/land, people within 5 km, mangrove
                                                                        │
GitHub Actions (monthly) ──> web/data/events.json ──> Next.js static site ──> GitHub Pages
```

- **Why two models?** The Delta is cloudy most of the year. Wherever Sentinel-2 saw the ground, the fused SAR + optical model is used. Under persistent cloud, a SAR-only model fills the gap.
- **Validation loop:** events start as *unverified*. Once analysts confirm or reject them (NOSDRA reports, imagery, field visits), those decisions become new training labels.

## Repository layout

```
web/                 Next.js app (static export)
  data/              events.json, model_metrics.json, meta.json  ← written by the pipeline
pipeline/
  blacktide/         Earth Engine preprocessing, features, model
  gee/label_tool.js  point-and-click labelling app for the EE Code Editor
  scripts/
    check_setup.py            0. verify Earth Engine access
    generate_sample_data.py   synthetic demo data
    sample_training.py        1. labels → training table (+ EE asset)
    train.py                  2. RF + MLP metrics → web/data/model_metrics.json
    detect.py                 3. monthly detection → web/data/events.json
  labels/            your labelled points (see labels/README.md)
.github/workflows/   deploy.yml (Pages), pipeline.yml (monthly detection)
```

## Run the web app locally

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

## Run the pipeline

You need Python 3.10+ and an Earth Engine account with a Cloud project registered for **non-commercial** use.

```bash
pip install -r pipeline/requirements.txt
earthengine authenticate
export GEE_PROJECT=your-cloud-project-id      # PowerShell: $env:GEE_PROJECT="..."

python pipeline/scripts/check_setup.py         # 0. verifies access, creates the asset folder

# 1. Label oil / not-oil points: paste pipeline/gee/label_tool.js into
#    code.earthengine.google.com, click the map, save the output as
#    pipeline/labels/labels.geojson (see labels/README.md)
python pipeline/scripts/sample_training.py     # builds the training table + EE asset
python pipeline/scripts/train.py               # RF + MLP metrics for the Model page
python pipeline/scripts/detect.py --aoi pilot --start 2024-01-01 --end 2025-01-01
```

Start with `--aoi pilot` (Bodo / Ogoniland), where spills are well documented. Scale to `--aoi delta` once the metrics look trustworthy.

### Automate it (still free)

1. In Google Cloud, create a service account in your EE project, give it the *Earth Engine Resource Writer* and *Service Usage Consumer* roles, and create a JSON key.
2. In the repo, go to **Settings → Secrets and variables → Actions** and add `GEE_SERVICE_ACCOUNT_KEY` (the JSON) and `GEE_PROJECT`.
3. The **Detection pipeline** workflow then runs on the 3rd of every month, commits new events and redeploys the site. You can also run it by hand from the Actions tab.

## Roadmap

- [ ] Analyst validation workflow (Supabase free tier: auth + PostGIS)
- [ ] Offline field ground-truth app (PWA) with geotagged photos
- [ ] Automatic cross-check against NOSDRA Oil Spill Monitor reports
- [ ] Marine slick drift forecasts with OpenDrift + Open-Meteo winds
- [ ] Telegram / email alerts for watched areas
- [ ] Vegetation recovery tracking after spills
- [ ] SHAP explanations per detection
- [ ] VIIRS gas-flare layer

## Research team

ThankGod Chinemerem Ugwuada · Ikenna Okonkwo Anthony · Tochukwu Ambrose Ngwu

## Credits

Contains modified Copernicus Sentinel data, processed in Google Earth Engine. Sentinel-2 cloudless mosaics © EOX IT Services GmbH (CC BY-NC-SA 4.0). Map data © OpenStreetMap contributors via OpenFreeMap. Population: WorldPop. Surface water: JRC Global Surface Water.
