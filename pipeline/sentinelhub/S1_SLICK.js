//VERSION=3
// VV greyscale with very dark pixels (< -22 dB, typical of oil on open sea) tinted magenta.
// Calm water and rain cells also go dark — check the shape (long, thin, from a source).
function setup() {
  return { input: ["VV", "dataMask"], output: { bands: 4 } };
}
function evaluatePixel(s) {
  var db = 10 * Math.log(Math.max(s.VV, 1e-6)) / Math.LN10;
  var v = Math.min(1, Math.max(0, (db + 25) / 20));
  if (db < -22) return [0.85, 0.2, 0.75, s.dataMask];
  return [v, v, v, s.dataMask];
}
