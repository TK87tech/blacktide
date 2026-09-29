//VERSION=3
// Sentinel-1 VV backscatter in dB, greyscale. Oil damps the sea surface: slicks are dark streaks.
function setup() {
  return { input: ["VV", "dataMask"], output: { bands: 4 } };
}
function evaluatePixel(s) {
  var db = 10 * Math.log(Math.max(s.VV, 1e-6)) / Math.LN10;
  var v = Math.min(1, Math.max(0, (db + 25) / 20)); // -25 dB → black, -5 dB → white
  return [v, v, v, s.dataMask];
}
