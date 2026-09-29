//VERSION=3
// NDWI = (B3 - B8) / (B3 + B8) (McFeeters). Blue = open water, tan = land.
function setup() {
  return { input: ["B03", "B08", "dataMask"], output: { bands: 4 } };
}
var viz = new ColorRampVisualizer([[-0.6, 0xc9b58a], [0.0, 0xf2efe6], [0.2, 0x86b6ef], [0.6, 0x104281]]);
function evaluatePixel(s) {
  return viz.process((s.B03 - s.B08) / (s.B03 + s.B08)).concat(s.dataMask);
}
