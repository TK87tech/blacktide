//VERSION=3
// NDWI = (B3 - B8) / (B3 + B8) (McFeeters). Blue = open water, tan = land.
// Multi-temporal: for each pixel, the most recent observation in the time window that isn't
// cloud or cloud shadow (Sentinel-2 L2A scene classification), so clouds aren't read as bare ground.
function setup() {
  return { input: [{ bands: ["B03", "B08", "SCL", "dataMask"] }], output: { bands: 4 }, mosaicking: "ORBIT" };
}
var CLOUD = [3, 8, 9, 10]; // cloud shadow, cloud medium / high probability, thin cirrus
var viz = new ColorRampVisualizer([[-0.6, 0xc9b58a], [0.0, 0xf2efe6], [0.2, 0x86b6ef], [0.6, 0x104281]]);
function evaluatePixel(samples) {
  for (var i = 0; i < samples.length; i++) {
    var s = samples[i];
    if (s.dataMask === 1 && CLOUD.indexOf(s.SCL) < 0) return viz.process((s.B03 - s.B08) / (s.B03 + s.B08)).concat(1);
  }
  return [0, 0, 0, 0];
}
