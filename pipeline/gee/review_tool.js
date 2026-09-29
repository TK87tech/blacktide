/**
 * BlackTide candidate review — paste into https://code.earthengine.google.com and press Run.
 *
 * Candidates come from detect_inland.py (SAR + optical change detection), strongest first.
 *
 *   LAND / CREEK BANK — before / after swipe of dry-season Sentinel-2 SWIR false colour
 *     (healthy vegetation = green; dead, oiled or burnt = brown-grey-black).
 *     Oil:     die-off along a creek bank or pipeline, dark staining, dead mangrove, no other cause
 *     Not oil: clearing / farming (straight edges), construction or sand fill (bright white),
 *              haze in one image, river erosion
 *
 *   CREEK — Sentinel-1 radar (VV): left = same month a year earlier, right = the flagged pass.
 *     Oil:     a new dark streak or patch confined to the channel, often drifting from a point
 *     Not oil: the whole floodplain darkening (flooding), tide / mudflat changes, no visible change
 *
 *   Unsure — skip; it won't be used.
 *
 * Press "Print labels" often and paste the Console output back to Claude.
 */

var ASSET = 'projects/blacktide-510006/assets/blacktide/review_candidates';

var cands = ee.FeatureCollection(ASSET).sort('confidence', false);
var list = cands.toList(2000);
var total = 0;
var idx = 0;
var current = null;
var decisions = {};

function drySwir(year, pt) {
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate((year - 1) + '-11-01', year + '-04-01')
    .filterBounds(pt.buffer(5000))
    .linkCollection(ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED'), ['cs_cdf'])
    .map(function (img) { return img.updateMask(img.select('cs_cdf').gte(0.8)); })
    .select(['B11', 'B8', 'B4'])
    .median();
}

function radar(start, end, pt, orbit) {
  var col = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(pt).filterDate(start, end)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'));
  if (orbit) col = col.filter(ee.Filter.eq('relativeOrbitNumber_start', orbit));
  return col.select('VV');
}

var SWIR = {bands: ['B11', 'B8', 'B4'], min: 0, max: 4000};
var VV = {min: -25, max: -5};

var left = ui.Map();
var right = ui.Map();
ui.Map.Linker([left, right]);
left.setOptions('SATELLITE');
right.setOptions('SATELLITE');
ui.root.widgets().reset([ui.SplitPanel({firstPanel: left, secondPanel: right, wipe: true})]);

var title = ui.Label('', {fontWeight: 'bold'});
var info = ui.Label('', {whiteSpace: 'pre'});
var tally = ui.Label('');

function ring() {
  var p = current.properties;
  var r = Math.sqrt(p.area_ha * 1e4 / Math.PI) + 40;
  var circle = ee.Geometry.Point(current.geometry.coordinates).buffer(r);
  return ui.Map.Layer(ee.FeatureCollection([ee.Feature(circle)]).style({color: 'ffff00', fillColor: '00000000', width: 2}), {}, 'Candidate');
}

function updateTally() {
  var ids = Object.keys(decisions);
  var oil = ids.filter(function (k) { return decisions[k].properties['class'] === 1; }).length;
  tally.setValue('Reviewed ' + ids.length + ' · oil ' + oil + ' · not oil ' + (ids.length - oil));
}

function showLand(p, pt) {
  var y = Number(p.date.slice(0, 4));
  left.layers().reset([ui.Map.Layer(drySwir(y - 1, pt), SWIR, 'Before: dry season ' + (y - 1)), ring()]);
  right.layers().reset([ui.Map.Layer(drySwir(y, pt), SWIR, 'After: dry season ' + y), ring()]);
  info.setValue(
    'LAND / CREEK BANK · ' + p.date.slice(0, 4) + '\n' +
    'Area: ' + p.area_ha + ' ha · confidence ' + p.confidence + '\n' +
    'NDVI ' + p.ndvi_before + ' → ' + p.ndvi_after + ' · radar VH ' + p.vh_change_db + ' dB\n' +
    'Evidence: ' + p.evidence + (p.creek_bank ? ' · creek bank' : '') + (p.burned ? ' · burned' : '') + '\n' +
    'Left = before · Right = after (drag the divider)'
  );
}

function showCreek(p, pt) {
  var d = ee.Date(p.date);
  var flagged = radar(p.date, d.advance(1, 'day'), pt, null);
  flagged.first().get('relativeOrbitNumber_start').evaluate(function (orbit) {
    var before = radar(d.advance(-1, 'year').advance(-30, 'day'), d.advance(-1, 'year').advance(30, 'day'), pt, orbit).median();
    left.layers().reset([ui.Map.Layer(before, VV, 'Radar: same month a year earlier'), ring()]);
    right.layers().reset([ui.Map.Layer(flagged.mosaic(), VV, 'Radar: flagged pass ' + p.date), ring()]);
  });
  info.setValue(
    'CREEK (radar) · ' + p.date + '\n' +
    'Area: ' + p.area_ha + ' ha · confidence ' + p.confidence + '\n' +
    'Darker than a year earlier by ' + p.vv_anomaly_db + ' dB\n' +
    'Left = a year earlier · Right = flagged pass'
  );
}

function show(i) {
  if (i < 0 || i >= total) return;
  idx = i;
  title.setValue('Loading ' + (i + 1) + ' / ' + total + '…');
  ee.Feature(list.get(i)).evaluate(function (ft) {
    current = ft;
    var p = ft.properties;
    var pt = ee.Geometry.Point(ft.geometry.coordinates);
    if (p.kind === 'creek') showCreek(p, pt); else showLand(p, pt);
    left.setCenter(ft.geometry.coordinates[0], ft.geometry.coordinates[1], 15);
    var d = decisions[p.id];
    title.setValue('Candidate ' + (i + 1) + ' / ' + total + (d ? '  — marked ' + (d.properties['class'] ? 'OIL' : 'NOT OIL') : ''));
  });
}

function decide(cls) {
  if (!current) return;
  var p = current.properties;
  decisions[p.id] = {
    type: 'Feature',
    geometry: current.geometry,
    properties: {id: 'rev-' + p.id, 'class': cls, date: p.date, source: 'review', verified: true, candidate: p.id, kind: p.kind}
  };
  updateTally();
  show(idx + 1);
}

var panel = ui.Panel({
  widgets: [
    ui.Label('BlackTide candidate review', {fontWeight: 'bold', fontSize: '16px'}),
    title,
    info,
    ui.Panel([
      ui.Button('Oil', function () { decide(1); }),
      ui.Button('Not oil', function () { decide(0); }),
      ui.Button('Unsure', function () { show(idx + 1); })
    ], ui.Panel.Layout.flow('horizontal')),
    ui.Panel([
      ui.Button('◀ Back', function () { show(idx - 1); }),
      ui.Button('Next ▶', function () { show(idx + 1); })
    ], ui.Panel.Layout.flow('horizontal')),
    tally,
    ui.Button('Print labels', function () {
      var feats = Object.keys(decisions).map(function (k) { return decisions[k]; });
      print(JSON.stringify({type: 'FeatureCollection', features: feats}));
    })
  ],
  style: {width: '320px', position: 'top-left'}
});
left.add(panel);

cands.size().evaluate(function (n) {
  total = n;
  updateTally();
  show(0);
});
