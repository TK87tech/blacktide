/**
 * BlackTide candidate review — paste into https://code.earthengine.google.com and press Run.
 *
 * Shows each land / creek-bank candidate from find_land_candidates.py as a
 * before / after swipe of dry-season Sentinel-2 false colour
 * (healthy vegetation = green, dead / oiled / burnt = brown-grey-black).
 *
 *   Oil      — die-off consistent with a spill: along a pipeline or creek bank,
 *              irregular dark staining, dead mangrove, no obvious other cause
 *   Not oil  — farming / clearing (straight edges, fields), construction,
 *              seasonal flooding, cloud or haze artefacts, river erosion
 *   Unsure   — skip; it won't be used
 *
 * Press "Print labels" often and copy the Console output — paste it back to
 * Claude or append the features to pipeline/labels/labels.geojson.
 */

var ASSET = 'projects/blacktide-510006/assets/blacktide/land_candidates';

var cands = ee.FeatureCollection(ASSET).sort('score', false);
var list = cands.toList(2000);
var total = 0;
var idx = 0;
var current = null;
var decisions = {};

function dry(year) {
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate((year - 1) + '-11-01', year + '-04-01')
    .filterBounds(ee.Geometry.Point(current.geometry.coordinates).buffer(5000))
    .linkCollection(ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED'), ['cs_cdf'])
    .map(function (img) { return img.updateMask(img.select('cs_cdf').gte(0.6)); })
    .select(['B11', 'B8', 'B4'])
    .median();
}

var VIS = {bands: ['B11', 'B8', 'B4'], min: 0, max: 4000};

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
  var r = Math.sqrt(p.area_ha * 1e4 / Math.PI) + 30;
  var circle = ee.Geometry.Point(current.geometry.coordinates).buffer(r);
  return ui.Map.Layer(ee.FeatureCollection([ee.Feature(circle)]).style({color: 'ffff00', fillColor: '00000000', width: 2}), {}, 'Candidate');
}

function updateTally() {
  var ids = Object.keys(decisions);
  var oil = ids.filter(function (k) { return decisions[k].properties['class'] === 1; }).length;
  tally.setValue('Reviewed ' + ids.length + ' · oil ' + oil + ' · not oil ' + (ids.length - oil));
}

function show(i) {
  if (i < 0 || i >= total) return;
  idx = i;
  title.setValue('Loading ' + (i + 1) + ' / ' + total + '…');
  ee.Feature(list.get(i)).evaluate(function (ft) {
    current = ft;
    var p = ft.properties;
    var c = ft.geometry.coordinates;
    left.layers().reset([ui.Map.Layer(dry(p.year - 1), VIS, 'Before (dry season ' + (p.year - 1) + ')'), ring()]);
    right.layers().reset([ui.Map.Layer(dry(p.year), VIS, 'After (dry season ' + p.year + ')'), ring()]);
    left.setCenter(c[0], c[1], 15);
    var d = decisions[p.id];
    title.setValue('Candidate ' + (i + 1) + ' / ' + total + (d ? '  — marked ' + (d.properties['class'] ? 'OIL' : 'NOT OIL') : ''));
    info.setValue(
      'Year: ' + p.year + '\n' +
      'Area: ' + p.area_ha + ' ha\n' +
      'NDVI: ' + p.ndvi_before + ' → ' + p.ndvi_after + ' (' + p.ndvi_drop + ')\n' +
      'Creek bank: ' + (p.creek_bank ? 'yes' : 'no') + '\n' +
      'Left = before · Right = after (drag the divider)'
    );
  });
}

function decide(cls) {
  if (!current) return;
  var p = current.properties;
  decisions[p.id] = {
    type: 'Feature',
    geometry: current.geometry,
    properties: {id: 'rev-' + p.id, 'class': cls, date: p.date, source: 'review', verified: true, candidate: p.id}
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
  style: {width: '300px', position: 'top-left'}
});
left.add(panel);

cands.size().evaluate(function (n) {
  total = n;
  updateTally();
  show(0);
});
