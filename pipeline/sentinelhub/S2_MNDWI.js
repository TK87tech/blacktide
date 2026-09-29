//VERSION=3
// MNDWI = (B3 - B11) / (B3 + B11) (Xu). Water vs land, less confused by soil and built-up areas.
function setup() {
  return { input: ["B03", "B11", "dataMask"], output: { bands: 4 } };
}
var viz = new ColorRampVisualizer([[-0.6, 0xc9b58a], [0.0, 0xf2efe6], [0.2, 0x86b6ef], [0.6, 0x104281]]);
function evaluatePixel(s) {
  return viz.process((s.B03 - s.B11) / (s.B03 + s.B11)).concat(s.dataMask);
}
