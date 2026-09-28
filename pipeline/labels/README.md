# Training labels

The models learn from `labels.geojson`: a GeoJSON FeatureCollection of points
(or small polygons) you have confirmed as **oil** or **not oil** on a given date.

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [7.2731, 4.6172] },
      "properties": { "id": "bodo-2019-03-a", "class": 1, "date": "2019-03-14", "source": "NOSDRA JIV" }
    }
  ]
}
```

| property | meaning |
|---|---|
| `class` | `1` = oil-contaminated, `0` = clean (water, healthy mangrove, soil, look-alikes) |
| `date` | date the condition was observed (the matching month is sampled) |
| `id` | optional, unique |
| `source` | optional: NOSDRA report, field visit, visual interpretation… |

## Where labels can come from (all free)

1. **NOSDRA Oil Spill Monitor** (oilspillmonitor.ng) — reported incidents with
   coordinates and dates. Use as candidate *oil* points, then confirm visually.
2. **Visual interpretation** in the Earth Engine Code Editor — dark slicks on
   Sentinel-1 VV, burnt/dead vegetation patches on Sentinel-2 false colour.
3. **Field ground truth** collected during site visits.
4. **Negatives matter as much as positives**: include look-alikes — low-wind
   calm water, algae, wet mudflats, shadows — labelled `class: 0`.

Aim for a few hundred points per class across different months, states and
both surfaces (land and water) before trusting the metrics.
