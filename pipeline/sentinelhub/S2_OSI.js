//VERSION=3
// Oil Spill Index OSI = (B3 + B4) / B2 (Rajendran et al.). Higher over oil-coated surfaces.
// Dark = low, yellow-red = high. Compare against true colour: haze and turbid water also raise it.
// Multi-temporal: for each pixel, the most recent observation in the time window that isn't
// cloud or cloud shadow (Sentinel-2 L2A scene classification), so clouds aren't read as bare ground.
function setup() {
  return { input: [{ bands: ["B02", "B03", "B04", "SCL", "dataMask"] }], output: { bands: 4 }, mosaicking: "ORBIT" };
}
var CLOUD = [3, 8, 9, 10]; // cloud shadow, cloud medium / high probability, thin cirrus
var viz = new ColorRampVisualizer([[0.8, 0x1a1a19], [1.2, 0x2b5b9e], [1.5, 0xfab219], [1.9, 0xd03b3b], [2.5, 0xffffff]]);
function evaluatePixel(samples) {
  for (var i = 0; i < samples.length; i++) {
    var s = samples[i];
    if (s.dataMask === 1 && CLOUD.indexOf(s.SCL) < 0) return viz.process((s.B03 + s.B04) / Math.max(s.B02, 0.001)).concat(1);
  }
  return [0, 0, 0, 0];
}
