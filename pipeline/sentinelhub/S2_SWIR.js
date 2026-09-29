//VERSION=3
// SWIR false colour (B12, B8A, B4). Healthy vegetation: bright green. Dead, oiled or burnt
// vegetation and bare soil: brown to black. Water: dark blue/black.
function setup() {
  return { input: ["B12", "B8A", "B04", "dataMask"], output: { bands: 4 } };
}
function evaluatePixel(s) {
  var g = 2.5;
  return [s.B12 * g, s.B8A * g, s.B04 * g, s.dataMask];
}
