/** Viridis colormap — 256 RGBA entries as Uint8ClampedArray */
export function buildViridisLUT() {
  const stops = [
    [0.267, 0.005, 0.329],
    [0.283, 0.141, 0.458],
    [0.254, 0.265, 0.530],
    [0.207, 0.372, 0.553],
    [0.164, 0.471, 0.558],
    [0.128, 0.567, 0.551],
    [0.135, 0.659, 0.518],
    [0.267, 0.749, 0.441],
    [0.478, 0.821, 0.318],
    [0.741, 0.873, 0.150],
    [0.993, 0.906, 0.144],
  ];
  return buildLUT(stops);
}

/** Plasma colormap — 256 RGBA entries as Uint8ClampedArray */
export function buildPlasmaLUT() {
  const stops = [
    [0.050, 0.030, 0.528],
    [0.212, 0.019, 0.580],
    [0.349, 0.015, 0.607],
    [0.472, 0.040, 0.607],
    [0.584, 0.084, 0.582],
    [0.685, 0.130, 0.538],
    [0.776, 0.181, 0.480],
    [0.858, 0.243, 0.411],
    [0.929, 0.318, 0.337],
    [0.974, 0.430, 0.244],
    [0.994, 0.580, 0.141],
    [0.988, 0.742, 0.050],
    [0.940, 0.975, 0.131],
  ];
  return buildLUT(stops);
}

/** Shared builder — interpolates control stops into 256 RGBA entries */
function buildLUT(stops) {
  const lut = new Uint8ClampedArray(256 * 4);
  const n   = stops.length - 1;

  for (let i = 0; i < 256; i++) {
    const t  = i / 255;
    const si = Math.min(Math.floor(t * n), n - 1);
    const f  = t * n - si;

    const r = stops[si][0] + f * (stops[si + 1][0] - stops[si][0]);
    const g = stops[si][1] + f * (stops[si + 1][1] - stops[si][1]);
    const b = stops[si][2] + f * (stops[si + 1][2] - stops[si][2]);

    lut[i * 4 + 0] = Math.round(r * 255);
    lut[i * 4 + 1] = Math.round(g * 255);
    lut[i * 4 + 2] = Math.round(b * 255);
    lut[i * 4 + 3] = 255;
  }

  return lut;
}