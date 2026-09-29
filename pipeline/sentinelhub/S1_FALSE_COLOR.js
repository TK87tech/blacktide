//VERSION=3
// R = VV, G = VH, B = VV/VH ratio (all dB, stretched). Slicks: dark; land/vegetation: green-yellow.
function setup() {
  return { input: ["VV", "VH", "dataMask"], output: { bands: 4 } };
}
function db(x) { return 10 * Math.log(Math.max(x, 1e-6)) / Math.LN10; }
function stretch(x, lo, hi) { return Math.min(1, Math.max(0, (x - lo) / (hi - lo))); }
function evaluatePixel(s) {
  var vv = db(s.VV), vh = db(s.VH);
  return [stretch(vv, -25, -5), stretch(vh, -30, -10), stretch(vv - vh, 2, 14), s.dataMask];
}
