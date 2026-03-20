import { Blosc } from "numcodecs";

export async function loadZarrArray(storeUrl, arrayPath) {
  const base = storeUrl.replace(/\/$/, "");
  let resolvedPath = arrayPath?.trim() ?? "";

  if (!resolvedPath) {
    const rootMeta = await fetchJson(`${base}/zarr.json`);
    if (rootMeta.node_type === "group") {
      const ms = rootMeta?.attributes?.multiscales;
      if (ms?.[0]?.datasets?.[0]?.path) {
        resolvedPath = ms[0].datasets[0].path;
      } else {
        for (const c of ["density", "0", "1", "data", "volume", "image"]) {
          try {
            const m = await fetchJson(`${base}/${c}/zarr.json`);
            if (m.node_type === "array") { resolvedPath = c; break; }
          } catch (_) {}
        }
      }
    }
    if (!resolvedPath) {
      throw new Error(`Root is a group. Enter the array path manually (e.g. "density").`);
    }
  }

  const meta       = await fetchJson(`${base}/${resolvedPath}/zarr.json`);
  const shape      = meta.shape;
  const dtype      = meta.data_type;
  const chunkShape = meta.chunk_grid.configuration.chunk_shape;
  const separator  = meta.chunk_key_encoding?.configuration?.separator ?? "/";
  const fillValue  = meta.fill_value ?? 0;
  const hasBlosc   = (meta.codecs ?? []).some((c) => c.name === "blosc");

  return {
    base, resolvedPath, detectedPath: resolvedPath,
    shape:      shape.slice(-3),
    fullShape:  shape,
    dtype,
    chunkShape: chunkShape.slice(-3),
    separator,  fillValue, hasBlosc,
  };
}

/**
 * Load the ENTIRE volume into a flat Float32Array [Z * Y * X].
 * Reports progress via onProgress(fraction 0..1).
 */
export async function fetchFullVolume(zarrInfo, onProgress) {
  const { shape, chunkShape, base, resolvedPath, separator, fillValue, hasBlosc } = zarrInfo;
  const [Z, Y, X]    = shape;
  const [CZ, CY, CX] = chunkShape;

  const nCZ = Math.ceil(Z / CZ);
  const nCY = Math.ceil(Y / CY);
  const nCX = Math.ceil(X / CX);
  const total = nCZ * nCY * nCX;

  // XYZ layout — X slowest, Z fastest (matches WebGL texture width=X, height=Y, depth=Z)
  const out = new Float32Array(X * Y * Z).fill(fillValue);
  let completed = 0;

  const tasks = [];
  for (let czIdx = 0; czIdx < nCZ; czIdx++) {
    for (let cyIdx = 0; cyIdx < nCY; cyIdx++) {
      for (let cxIdx = 0; cxIdx < nCX; cxIdx++) {
        tasks.push(
          fetchChunk(base, resolvedPath, czIdx, cyIdx, cxIdx, separator, hasBlosc)
            .then((chunkF32) => {
              const czSize = Math.min(CZ, Z - czIdx * CZ);
              const cySize = Math.min(CY, Y - cyIdx * CY);
              const cxSize = Math.min(CX, X - cxIdx * CX);

              const zOff = czIdx * CZ;
              const yOff = cyIdx * CY;
              const xOff = cxIdx * CX;

              for (let z = 0; z < czSize; z++) {
                for (let y = 0; y < cySize; y++) {
                  for (let x = 0; x < cxSize; x++) {
                    const chunkIdx = z * (cySize * cxSize) + y * cxSize + x;
                    // XYZ layout: x is slowest, y is middle, z is fastest
                    const volIdx   = (xOff + x) * (Y * Z) + (yOff + y) * Z + (zOff + z);
                    out[volIdx]    = chunkF32[chunkIdx];
                  }
                }
              }

              completed++;
              onProgress?.(completed / total);
            })
            .catch((err) => console.warn(`Chunk ${czIdx}/${cyIdx}/${cxIdx} skipped:`, err.message))
        );
      }
    }
  }

  await Promise.all(tasks);

  // Compute global min/max (skip fill value)
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (!isFinite(v) || v === fillValue) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min)) { min = fillValue; max = fillValue; }

  return { data: out, min, max };
}

// ── Keep fetchZSlice for backward compat ─────────────────────────────────────
export async function fetchZSlice(zarrInfo, z) {
  const { shape, chunkShape, base, resolvedPath, separator, fillValue, hasBlosc } = zarrInfo;
  const [Z, Y, X]    = shape;
  const [CZ, CY, CX] = chunkShape;

  const nCY  = Math.ceil(Y / CY);
  const nCX  = Math.ceil(X / CX);
  const czIdx    = Math.floor(z / CZ);
  const zInChunk = z % CZ;

  const out = new Float32Array(Y * X).fill(fillValue);

  await Promise.all(
    Array.from({ length: nCY }, (_, cyIdx) =>
      Array.from({ length: nCX }, (_, cxIdx) =>
        fetchChunk(base, resolvedPath, czIdx, cyIdx, cxIdx, separator, hasBlosc)
          .then((chunkF32) => {
            const czSize = Math.min(CZ, Z - czIdx * CZ);
            const cySize = Math.min(CY, Y - cyIdx * CY);
            const cxSize = Math.min(CX, X - cxIdx * CX);
            const yOff = cyIdx * CY;
            const xOff = cxIdx * CX;
            for (let yy = 0; yy < cySize; yy++) {
              for (let xx = 0; xx < cxSize; xx++) {
                const chunkIdx = zInChunk * (cySize * cxSize) + yy * cxSize + xx;
                out[(yOff + yy) * X + (xOff + xx)] = chunkF32[chunkIdx];
              }
            }
          })
          .catch((err) => console.warn(`Chunk skipped:`, err.message))
      )
    ).flat()
  );

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (!isFinite(v) || v === fillValue) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min)) { min = fillValue; max = fillValue; }

  return { data: out, min, max };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
async function fetchChunk(base, arrayPath, cz, cy, cx, separator, hasBlosc) {
  const key  = ["c", cz, cy, cx].join(separator);
  const url  = `${base}/${arrayPath}/${key}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} at ${url}`);
  const bytes     = new Uint8Array(await resp.arrayBuffer());
  const decoded   = hasBlosc ? await decodeBlosc(bytes) : bytes;
  return new Float32Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 4);
}

async function decodeBlosc(data) {
  const codec = new Blosc();
  return new Uint8Array(await codec.decode(data));
}

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} at ${url}`);
  const text = await resp.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error(`Got HTML instead of JSON from:\n${url}`);
  }
  return JSON.parse(text);
}