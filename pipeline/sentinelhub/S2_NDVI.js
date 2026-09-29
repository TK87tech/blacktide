//VERSION=3
// NDVI = (B8 - B4) / (B8 + B4). Brown = bare / dead, green = healthy vegetation, blue = water.
function setup() {
  return { input: ["B08", "B04", "dataMask"], output: { bands: 4 } };
}
var ramp = [[-0.2, 0x2b5b9e], [0.0, 0x8c6d46], [0.2, 0xd8c27a], [0.4, 0x9bc45a], [0.6, 0x3f9b3a], [0.8, 0x145a1e]];
var viz = new ColorRampVisualizer(ramp);
function evaluatePixel(s) {
  var ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
  return viz.process(ndvi).concat(s.dataMask);
}
