//VERSION=3
// Natural colour (B4, B3, B2) with a gamma stretch, so dark mangrove and water keep detail.
// Sheen on water sometimes shows as silvery or rainbow patches; clouds block the view.
function setup() {
  return { input: ["B04", "B03", "B02", "dataMask"], output: { bands: 4 } };
}
function s(x) { return Math.pow(Math.min(1, Math.max(0, x * 3.2)), 0.6); }
function evaluatePixel(p) {
  return [s(p.B04), s(p.B03), s(p.B02), p.dataMask];
}
