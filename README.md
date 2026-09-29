# BlackTide

**Satellite + AI oil spill intelligence for the Niger Delta.**

*Marée noire* (black tide) is the French term for an oil spill. BlackTide watches the whole Niger Delta from orbit:

- **Sea & coast:** oil slicks detected on every Sentinel-1 radar pass by [SkyTruth Cerulean](https://cerulean.skytruth.org), imported and enriched with nearby-population and mangrove context.
- **Land, swamp & creeks:** every spill reported to NOSDRA (Nigerian Oil Spill Monitor) since 2015, with a **satellite check** of whether each land spill left visible vegetation damage (Sentinel-2 NDVI + Sentinel-1 radar, site vs surroundings, dry season before vs after).
- **In development:** BlackTide's own inland detector (SAR + optical change detection, trained on the satellite-visible reported spills).

Every detection is published on an open map and dashboard.

It runs entirely on free tools and free tiers: no servers and no paid APIs.

> The site shows **real data**: ~2,900 marine slicks (SkyTruth Cerulean) and ~9,000 official spill reports (NOSDRA).

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
  gee/label_tool.js     point-and-click labelling app for the EE Code Editor
  gee/review_tool.js    yes/no review of land & creek-bank candidates
  scripts/
    check_setup.py            0. verify Earth Engine access
    bootstrap_labels.py       1. automatic labels: Cerulean slicks, clean water, look-alikes, land cover
    detect_inland.py          2. SAR + optical change detection: land / creek-bank die-off and creek slicks
    export_review.py             upload inland candidates to the review tool
    find_land_candidates.py      (older optical-only candidate finder)
    add_labels.py                merge reviewed labels into labels.geojson
    sample_training.py        3. labels → water (per-pass) + land (monthly) training tables
    train.py                  4. RF + MLP per domain → model metrics
    import_cerulean.py           marine events from SkyTruth Cerulean → web/data/events.json
    import_nosdra.py             official NOSDRA spill reports → web/data/events.json
    score_nosdra_impact.py       satellite impact score for reported land spills
    test_known_sites.py          sensitivity test: do reported spills show up from space?
    detect.py                 5. land model monthly (+ --water research model) → web/data/events.json
    generate_sample_data.py      synthetic demo data
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

python pipeline/scripts/check_setup.py              # 0. verifies access, creates the asset folder
python pipeline/scripts/bootstrap_labels.py         # 1. ~3,000 labels with no clicking
python pipeline/scripts/find_land_candidates.py     # 2. land / creek candidates → review in
                                                    #    pipeline/gee/review_tool.js, then:
python pipeline/scripts/add_labels.py reviewed.json
python pipeline/scripts/sample_training.py          # 3. training tables + EE assets
python pipeline/scripts/train.py                    # 4. metrics (add --publish for the website)
python pipeline/scripts/import_cerulean.py          # marine events (no Earth Engine needed with --no-enrich)
python pipeline/scripts/detect.py --aoi pilot --start 2024-01-01 --end 2024-04-01 --dry-run
```

`detect.py` runs each month as an Earth Engine **batch task**, prints the EECU-hours it used, and **refuses to submit** if the estimated cost is over `--max-eecu` (default 20). BlackTide's own water model (`--water`) is kept as a research comparison: tested against Cerulean off Akwa Ibom it caught about half the slicks but most of its alerts were false, so the map uses Cerulean for the sea. `--dry-run` writes a preview to `pipeline/output/` instead of the website.

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

## Licence

© 2026 ThankGod Chinemerem Ugwuada, Ikenna Okonkwo Anthony, Tochukwu Ambrose Ngwu. **All rights reserved.** The code is public for viewing only — it may not be copied, modified or reused without written permission. See [LICENSE](LICENSE).

## Credits

Marine slick detections and training labels: [SkyTruth Cerulean](https://cerulean.skytruth.org). Official spill reports: National Oil Spill Detection and Response Agency (NOSDRA), [Nigerian Oil Spill Monitor](https://nosdra.oilspillmonitor.ng/). State and LGA boundaries: [geoBoundaries](https://www.geoboundaries.org) (CC BY 4.0).
Contains modified Copernicus Sentinel data, processed in Google Earth Engine. Sentinel-2 cloudless mosaics © EOX IT Services GmbH (CC BY-NC-SA 4.0). Map data © OpenStreetMap contributors via OpenFreeMap. Population: WorldPop. Surface water: JRC Global Surface Water.
