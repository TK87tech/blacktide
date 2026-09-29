//VERSION=3
// SWIR false colour (B12, B8A, B4) with a gamma stretch. Healthy vegetation: bright green.
// Dead, oiled or burnt vegetation and bare soil: brown to black. Water: dark blue/black.
function setup() {
  return { input: ["B12", "B8A", "B04", "dataMask"], output: { bands: 4 } };
}
function s(x) { return Math.pow(Math.min(1, Math.max(0, x * 2.6)), 0.7); }
function evaluatePixel(p) {
  return [s(p.B12), s(p.B8A), s(p.B04), p.dataMask];
}
