/**
 * BlackTide labelling tool — paste into https://code.earthengine.google.com and press Run.
 *
 * 1. Pick a month and press "Load month".
 * 2. Choose "Oil" or "Clean", then click the map to drop labelled points.
 *    - Oil on water: dark, smooth patches on the radar layer that are not
 *      explained by calm wind (check neighbouring dates / shapes).
 *    - Oil on land: brown/grey dead-vegetation scars on the false-colour layer,
 *      often along pipeline corridors.
 *    - Clean: open water, healthy mangrove, farmland, AND look-alikes
 *      (calm water, mudflats, rain cells, shadows) — these matter most.
 * 3. Press "Print GeoJSON", copy the output from the Console into
 *    pipeline/labels/labels.geojson. Re-paste an earlier file into
 *    EXISTING below to keep adding to it.
 */

var EXISTING = null; // paste a previous labels.geojson object here to continue

var DELTA = ee.Geometry.Rectangle([4.8, 3.9, 8.6, 6.6]);
var state = {
  month: '2024-01',
  cls: 1,
  features: EXISTING ? EXISTING.features : []
};

function s1(month) {
  var start = ee.Date(month + '-01');
  return ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(DELTA)
    .filterDate(start, start.advance(1, 'month'))
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .select('VV')
    .reduce(ee.Reducer.percentile([10]))
    .focalMedian(30, 'circle', 'meters');
}

function s2(month) {
  var start = ee.Date(month + '-01');
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(DELTA)
    .filterDate(start, start.advance(1, 'month'))
    .linkCollection(ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED'), ['cs_cdf'])
    .map(function (img) { return img.updateMask(img.select('cs_cdf').gte(0.6)); })
    .median();
}

function labelsLayer(cls, color) {
  var pts = state.features
    .filter(function (f) { return f.properties['class'] === cls; })
    .map(function (f) { return ee.Feature(ee.Geometry.Point(f.geometry.coordinates)); });
  return ui.Map.Layer(ee.FeatureCollection(pts), {color: color}, cls === 1 ? 'Oil labels' : 'Clean labels');
}

function redraw() {
  var layers = Map.layers();
  while (layers.length() > 3) layers.remove(layers.get(3));
  layers.add(labelsLayer(1, 'ff3333'));
  layers.add(labelsLayer(0, '33ddff'));
  var oil = state.features.filter(function (f) { return f.properties['class'] === 1; }).length;
  count.setValue(state.features.length + ' labels · ' + oil + ' oil · ' + (state.features.length - oil) + ' clean');
}

function loadMonth() {
  state.month = monthBox.getValue();
  var img = s2(state.month);
  Map.layers().reset([
    ui.Map.Layer(img, {bands: ['B4', 'B3', 'B2'], min: 0, max: 2500}, 'Sentinel-2 true colour', false),
    ui.Map.Layer(img, {bands: ['B11', 'B8', 'B4'], min: 0, max: 4000}, 'Sentinel-2 false colour (land spills)', false),
    ui.Map.Layer(s1(state.month), {min: -25, max: -5}, 'Sentinel-1 VV (dark = possible slick)')
  ]);
  redraw();
}

Map.onClick(function (c) {
  state.features.push({
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [Number(c.lon.toFixed(5)), Number(c.lat.toFixed(5))]},
    properties: {
      id: 'L' + Date.now(),
      'class': state.cls,
      date: state.month + '-15',
      source: 'visual'
    }
  });
  redraw();
});

var monthBox = ui.Textbox({value: state.month, placeholder: 'YYYY-MM', style: {width: '90px'}});
var classSelect = ui.Select({
  items: [{label: 'Oil (1)', value: 1}, {label: 'Clean / look-alike (0)', value: 0}],
  value: 1,
  onChange: function (v) { state.cls = v; }
});
var count = ui.Label('');

var panel = ui.Panel({
  widgets: [
    ui.Label('BlackTide labelling', {fontWeight: 'bold', fontSize: '16px'}),
    ui.Panel([monthBox, ui.Button('Load month', loadMonth)], ui.Panel.Layout.flow('horizontal')),
    ui.Label('Click the map to add a point as:'),
    classSelect,
    count,
    ui.Button('Undo last', function () { state.features.pop(); redraw(); }),
    ui.Button('Print GeoJSON', function () {
      print(JSON.stringify({type: 'FeatureCollection', features: state.features}));
    })
  ],
  style: {width: '260px', position: 'top-left'}
});
Map.add(panel);
Map.setOptions('HYBRID');
Map.setCenter(7.27, 4.62, 12); // Bodo, Gokana
Map.style().set('cursor', 'crosshair');
loadMonth();
