//VERSION=3
// Oil Spill Index OSI = (B3 + B4) / B2 (Rajendran et al.). Higher over oil-coated surfaces.
// Dark = low, yellow-red = high. Compare against true colour: haze and turbid water also raise it.
function setup() {
  return { input: ["B02", "B03", "B04", "dataMask"], output: { bands: 4 } };
}
var viz = new ColorRampVisualizer([[0.8, 0x1a1a19], [1.2, 0x2b5b9e], [1.5, 0xfab219], [1.9, 0xd03b3b], [2.5, 0xffffff]]);
function evaluatePixel(s) {
  var osi = (s.B03 + s.B04) / Math.max(s.B02, 0.001);
  return viz.process(osi).concat(s.dataMask);
}
