# Satellite imagery layers (Copernicus Data Space Ecosystem)

The map's **Imagery** toggle streams Sentinel-1 / Sentinel-2 tiles with band math applied
on the fly, from a free Copernicus Data Space Ecosystem (CDSE) "configuration". Each `.js`
file here is the evalscript for one layer.

## One-time setup (free)

1. Create an account at <https://dataspace.copernicus.eu> and open the
   **Sentinel Hub dashboard** → **Configuration Utility** (<https://shapps.dataspace.copernicus.eu/dashboard/>).
2. **New configuration** → name it `BlackTide`, start from *Simple WMS template* (or empty).
3. Add one layer per file below. Use the **Layer ID exactly as shown**, paste the file
   contents as the layer's *Data processing* (custom script), and pick the data source:

   | Layer ID | Data source | Notes |
   |---|---|---|
   | `S1_VV` | Sentinel-1 GRD | Processing: backscatter coefficient *sigma0*, orthorectification on, speckle filter *Lee 5x5* if offered |
   | `S1_SLICK` | Sentinel-1 GRD | same as above |
   | `S1_FALSE_COLOR` | Sentinel-1 GRD | same as above; acquisition mode IW, polarization DV |
   | `S2_TRUE_COLOR` | Sentinel-2 L2A | max cloud coverage 30% |
   | `S2_SWIR` | Sentinel-2 L2A | |
   | `S2_NDVI` | Sentinel-2 L2A | |
   | `S2_NDWI` | Sentinel-2 L2A | |
   | `S2_MNDWI` | Sentinel-2 L2A | |
   | `S2_OSI` | Sentinel-2 L2A | |

4. In the configuration's settings, restrict it to your site if the option is offered
   (`https://tk87tech.github.io`) so others can't spend your quota.
5. Copy the configuration's **Instance ID** and give it to Claude (or set it as the
   `NEXT_PUBLIC_CDSE_INSTANCE` repository variable) — the map layers switch on once it's set.

CDSE's free tier has a monthly processing quota that resets each month; viewing tiles uses it.
It never costs money.
