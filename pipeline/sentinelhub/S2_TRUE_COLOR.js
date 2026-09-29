//VERSION=3
// Natural colour (B4, B3, B2), brightened. Sheen on water sometimes shows as silvery/rainbow patches.
function setup() {
  return { input: ["B04", "B03", "B02", "dataMask"], output: { bands: 4 } };
}
function evaluatePixel(s) {
  var g = 2.5;
  return [s.B04 * g, s.B03 * g, s.B02 * g, s.dataMask];
}
