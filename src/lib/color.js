'use strict';
// Colour helpers: CIE xyY (as used by GDTF/MVR) → linear sRGB, Kelvin → RGB.

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// "x,y,Y" string → [r,g,b] in 0..1 (gamma-encoded sRGB), normalised so max=1
function cieToRgb(str) {
  const p = String(str).split(',').map(parseFloat);
  if (p.length < 2 || !p.every(Number.isFinite)) return [1, 1, 1];
  const [x, y] = p;
  const Y = 1; // normalise luminance; we only want the chromaticity
  if (y <= 0) return [0, 0, 0];
  const X = (x * Y) / y;
  const Z = ((1 - x - y) * Y) / y;
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const mx = Math.max(r, g, b, 1e-6);
  r = clamp01(r / mx);
  g = clamp01(g / mx);
  b = clamp01(b / mx);
  const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  return [gam(r), gam(g), gam(b)];
}

// Approximate black-body colour for a correlated colour temperature (Kelvin).
function kelvinToRgb(k) {
  const t = Math.min(40000, Math.max(1000, k)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255)];
}

module.exports = { cieToRgb, kelvinToRgb, clamp01 };
