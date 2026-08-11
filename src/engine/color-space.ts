// D65 white point
const Xn = 0.95047;
const Yn = 1.0;
const Zn = 1.08883;

export function srgbToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  // sRGB to XYZ (D65)
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;

  return [x, y, z];
}

function xyzToLabF(t: number): number {
  const delta = 6 / 29;
  if (t > delta * delta * delta) return Math.cbrt(t);
  return t / (3 * delta * delta) + 4 / 29;
}

export function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const fx = xyzToLabF(x / Xn);
  const fy = xyzToLabF(y / Yn);
  const fz = xyzToLabF(z / Zn);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);

  return [L, a, b];
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

function labToXyzF(t: number): number {
  const delta = 6 / 29;
  if (t > delta) return t * t * t;
  return 3 * delta * delta * (t - 4 / 29);
}

export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const x = Xn * labToXyzF(fx);
  const y = Yn * labToXyzF(fy);
  const z = Zn * labToXyzF(fz);

  // XYZ to linear sRGB
  const rl = x * 3.2404542 - y * 1.5371385 - z * 0.4985314;
  const gl = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  const bl = x * 0.0556434 - y * 0.2040259 + z * 1.0572252;

  const rOut = Math.max(0, Math.min(1, linearToSrgb(rl)));
  const gOut = Math.max(0, Math.min(1, linearToSrgb(gl)));
  const bOut = Math.max(0, Math.min(1, linearToSrgb(bl)));

  return [rOut, gOut, bOut];
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [
    ((num >> 16) & 0xff) / 255,
    ((num >> 8) & 0xff) / 255,
    (num & 0xff) / 255,
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const ri = Math.round(r * 255);
  const gi = Math.round(g * 255);
  const bi = Math.round(b * 255);
  return '#' + [ri, gi, bi].map(v => v.toString(16).padStart(2, '0')).join('');
}
