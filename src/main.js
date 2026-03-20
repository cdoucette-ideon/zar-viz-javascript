import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadZarrArray, fetchFullVolume } from "./zarrLoader.js";
import { buildViridisLUT, buildPlasmaLUT } from "./colormap.js";

import vertSrc from "./shaders/volume.vert?raw";
import fragSrc from "./shaders/volume.frag?raw";

// ─── DOM refs ────────────────────────────────────────────────────────────────
const storeUrlEl  = document.getElementById("storeUrl");
const arrayPathEl = document.getElementById("arrayPath");
const loadBtn     = document.getElementById("loadBtn");
const statusEl    = document.getElementById("status");
const axisInfoEl  = document.getElementById("axisInfo");
const localPicker = document.getElementById("localPicker");

const thrMinInput = document.getElementById("thrMinInput");
const thrMaxInput = document.getElementById("thrMaxInput");
const thrMaxRow   = document.getElementById("thrMaxRow");
const opacSlider = document.getElementById("opacSlider");
const opacValEl  = document.getElementById("opacVal");
const stepsSlider = document.getElementById("stepsSlider");
const stepsValEl  = document.getElementById("stepsVal");

const thrRow   = document.getElementById("thrRow");
const opacRow  = document.getElementById("opacRow");
const stepsRow = document.getElementById("stepsRow");

const legend    = document.getElementById("legend");
const legendBar = document.getElementById("legendBar");
const legendMin = document.getElementById("legendMin");
const legendMid = document.getElementById("legendMid");
const legendMax = document.getElementById("legendMax");

const cmapMinSlider = document.getElementById("cmapMinSlider");
const cmapMinVal    = document.getElementById("cmapMinVal");
const cmapMaxSlider = document.getElementById("cmapMaxSlider");
const cmapMaxVal    = document.getElementById("cmapMaxVal");
const cmapRow       = document.getElementById("cmapRow");
const cmapMaxRow    = document.getElementById("cmapMaxRow");

const densitySlider = document.getElementById("densitySlider");
const densityValEl  = document.getElementById("densityVal");
const densityRow    = document.getElementById("densityRow");

const colormapPicker = document.getElementById("colormapPicker");


// ─── App state ───────────────────────────────────────────────────────────────
let state = {
  zarrInfo:  null,
  shape:     null,
  globalMin: 0,
  globalMax: 1,
  thrMin:    0,
  thrMax:    1,
  thrNorm:   0,
  opacity:   1,
  steps:     200,
  cmapMin:   0,
  cmapMax:   1,
};


// ─── Three.js setup ──────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.domElement.style.position = "absolute";
renderer.domElement.style.inset = "0";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0d12);

const camera = new THREE.PerspectiveCamera(
  50, window.innerWidth / window.innerHeight, 0.01, 1000
);
camera.position.set(1.5, 1.0, 2.0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.AxesHelper(0.6));

// ─── Colormap texture (256×1 RGBA) ───────────────────────────────────────────
// ─── Colormaps ────────────────────────────────────────────────────────────────
const LUTS = {
  viridis: buildViridisLUT(),
  plasma:  buildPlasmaLUT(),
};
let lutData = LUTS.viridis;  // active LUT — starts as viridis
const colormapTex = new THREE.DataTexture(
  lutData, 256, 1,
  THREE.RGBAFormat,
  THREE.UnsignedByteType
);
colormapTex.minFilter = THREE.LinearFilter;
colormapTex.magFilter = THREE.LinearFilter;
colormapTex.needsUpdate = true;

// ─── Volume mesh (created after data loads) ───────────────────────────────────
let volumeMesh = null;

// ─── Color legend ───────────────────────────────────────────────────────────────

function drawLegend(min, max) {
  const ctx = legendBar.getContext("2d");
  const w   = legendBar.width;
  const h   = legendBar.height;

  // Draw viridis gradient using the same lutData
  for (let i = 0; i < w; i++) {
    const t   = i / (w - 1);
    const idx = Math.round(t * 255) * 4;
    const r   = lutData[idx + 0];
    const g   = lutData[idx + 1];
    const b   = lutData[idx + 2];
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(i, 0, 1, h);
  }

  // Format labels — use exponential for very small/large values
  const fmt = (v) =>
    Math.abs(v) < 0.001 || Math.abs(v) > 9999
      ? v.toExponential(2)
      : v.toFixed(3);

  legendMin.textContent = fmt(min);
  legendMid.textContent = fmt((min + max) / 2);
  legendMax.textContent = fmt(max);

  legend.style.display = "flex";
}

function updateColormap() {
  const { cmapMin, cmapMax } = state;
  const range = cmapMax - cmapMin || 0.001;

  // Rebuild the 256-entry LUT remapped to [cmapMin, cmapMax] window
  const remapped = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    // Where does this normalised value [0,1] fall inside the cmap window?
    const tGlobal = i / 255;
    const tWindow = Math.max(0, Math.min(1, (tGlobal - cmapMin) / range));
    const srcIdx  = Math.round(tWindow * 255) * 4;

    remapped[i * 4 + 0] = lutData[srcIdx + 0];
    remapped[i * 4 + 1] = lutData[srcIdx + 1];
    remapped[i * 4 + 2] = lutData[srcIdx + 2];
    remapped[i * 4 + 3] = 255;
  }

  // Push updated data into the existing GPU texture
  colormapTex.image = { data: remapped, width: 256, height: 1 };
  colormapTex.needsUpdate = true;
}

/** Raw data value → normalised [0,1] */
function norm(v) {
  const range = state.globalMax - state.globalMin || 1;
  return (v - state.globalMin) / range;
}

/** Normalised [0,1] → raw data value */
function denorm(t) {
  return state.globalMin + t * (state.globalMax - state.globalMin || 1);
}

// ─── Render loop ─────────────────────────────────────────────────────────────
(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── UI events ───────────────────────────────────────────────────────────────
localPicker.addEventListener("change", () => {
  if (localPicker.value) {
    storeUrlEl.value = localPicker.value;
    arrayPathEl.value = "";
  }
});

loadBtn.addEventListener("click", async () => {
  const url  = storeUrlEl.value.trim();
  const path = arrayPathEl.value.trim();
  if (!url) { setStatus("Please enter a store URL."); return; }

  loadBtn.disabled = true;
  try {
    await initVolume(url, path);
  } catch (e) {
    setStatus(`❌ ${e.message ?? e}`);
    console.error(e);
  } finally {
    loadBtn.disabled = false;
  }
});

densitySlider.addEventListener("input", () => {
  const v = Number(densitySlider.value);
  densityValEl.textContent = v;
  if (volumeMesh) {
    volumeMesh.material.uniforms.uDensityScale.value = v;
  }
});

cmapMinSlider.addEventListener("change", () => {
  const raw = parseFloat(cmapMinSlider.value);
  if (isNaN(raw)) return;

  // Clamp so min never exceeds max
  const clampedRaw = Math.min(raw, denorm(state.cmapMax) - 0.0001);
  cmapMinSlider.value = clampedRaw;

  // Convert raw → normalised [0,1]
  state.cmapMin = norm(clampedRaw);
  updateColormap();
  drawLegend(denorm(state.cmapMin), denorm(state.cmapMax));
});

cmapMaxSlider.addEventListener("change", () => {
  const raw = parseFloat(cmapMaxSlider.value);
  if (isNaN(raw)) return;

  // Clamp so max never goes below min
  const clampedRaw = Math.max(raw, denorm(state.cmapMin) + 0.0001);
  cmapMaxSlider.value = clampedRaw;

  // Convert raw → normalised [0,1]
  state.cmapMax = norm(clampedRaw);
  updateColormap();
  drawLegend(denorm(state.cmapMin), denorm(state.cmapMax));
});

thrMinInput.addEventListener("change", () => {
  const raw = parseFloat(thrMinInput.value);
  if (isNaN(raw)) return;

  const clamped = Math.min(raw, denorm(state.thrMax) - 0.0001);
  thrMinInput.value = clamped;
  state.thrMin = norm(clamped);

  if (volumeMesh) {
    volumeMesh.material.uniforms.uThresholdMin.value = state.thrMin;
  }
});

thrMaxInput.addEventListener("change", () => {
  const raw = parseFloat(thrMaxInput.value);
  if (isNaN(raw)) return;

  const clamped = Math.max(raw, denorm(state.thrMin) + 0.0001);
  thrMaxInput.value = clamped;
  state.thrMax = norm(clamped);

  if (volumeMesh) {
    volumeMesh.material.uniforms.uThresholdMax.value = state.thrMax;
  }
});

opacSlider.addEventListener("input", () => {
  state.opacity = Number(opacSlider.value);
  opacValEl.textContent = state.opacity.toFixed(2);
  if (volumeMesh) {
    volumeMesh.material.uniforms.uOpacity.value = state.opacity;
  }
});

stepsSlider.addEventListener("input", () => {
  state.steps = Number(stepsSlider.value);
  stepsValEl.textContent = state.steps;
  if (volumeMesh) {
    volumeMesh.material.uniforms.uSteps.value = state.steps;
  }
});

colormapPicker.addEventListener("change", () => {
  lutData = LUTS[colormapPicker.value] ?? LUTS.viridis;
  updateColormap();
  drawLegend(denorm(state.cmapMin), denorm(state.cmapMax));
});

// ─── Core logic ──────────────────────────────────────────────────────────────

async function initVolume(url, path) {
  setStatus("Opening Zarr store …");

  const zarrInfo = await loadZarrArray(url, path);
  const { shape, dtype, detectedPath, chunkShape } = zarrInfo;

  state.zarrInfo = zarrInfo;
  state.shape    = shape;

  if (detectedPath && !path) arrayPathEl.value = detectedPath;

  const [Z, Y, X] = shape;
  axisInfoEl.textContent = `Z=${Z}  Y=${Y}  X=${X}`;

  // Read physical spacing from root zarr.json
  let spacing = [1, 1, 1];
  let physicalInfo = "";
  try {
    const rootMeta = await fetch(`${url}/zarr.json`).then((r) => r.json());
    const attrs = rootMeta?.attributes ?? {};
    if (attrs.spacing) {
      spacing = attrs.spacing;   // [sz, sy, sx]
      physicalInfo =
        `\nSpacing (ZYX): ${spacing.map((s) => s.toFixed(2)).join(" × ")} m` +
        `\nOrigin: ${attrs.origin?.map((o) => o.toFixed(1)).join(", ") ?? "N/A"}`;
    }
  } catch (_) {}

  setStatus(
    `Loading all ${Z * Y * X} voxels into GPU …\n` +
    `Shape: ${Z} × ${Y} × ${X}   Chunks: ${chunkShape.join(" × ")}` +
    physicalInfo
  );

  // Load full volume with progress
  const { data, min, max } = await fetchFullVolume(zarrInfo, (f) => {
    setStatus(`Loading chunks … ${Math.round(f * 100)}%`);
  });

  state.globalMin = min;
  state.globalMax = max;

  setStatus(
    `✅ Volume loaded\n` +
    `Shape: ${Z} × ${Y} × ${X}\ndtype: ${dtype}` +
    physicalInfo +
    `\nData range: [${min.toExponential(3)}, ${max.toExponential(3)}]`
  );

  // ── Normalise float data → [0, 1] for the 3D texture ───────────────────
  const range     = max - min || 1;
  const normData  = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    normData[i] = (data[i] - min) / range;
  }

  // ── Build THREE.Data3DTexture ────────────────────────────────────────────
  // Data3DTexture expects a flat typed array in XYZ order (x fastest).
  // Our array is XYZ (z slowest, x fastest) — which matches WebGL's
  // expectation of [width=X, height=Y, depth=Z].
  const volTex = new THREE.Data3DTexture(normData, X, Y, Z);
  volTex.format      = THREE.RedFormat;
  volTex.type        = THREE.FloatType;
  volTex.minFilter   = THREE.LinearFilter;
  volTex.magFilter   = THREE.LinearFilter;
  volTex.wrapS       = THREE.ClampToEdgeWrapping;
  volTex.wrapT       = THREE.ClampToEdgeWrapping;
  volTex.wrapR       = THREE.ClampToEdgeWrapping;
  volTex.unpackAlignment = 1;
  volTex.needsUpdate = true;

  // ── Build ShaderMaterial ─────────────────────────────────────────────────
  const mat = new THREE.ShaderMaterial({
    vertexShader:   vertSrc,
    fragmentShader: fragSrc,
    uniforms: {
      uVolume:    { value: volTex },
      uColormap:  { value: colormapTex },
      uThresholdMin: { value: 0.0 },
      uThresholdMax: { value: 1.0 },
      uDensityScale: { value: 20.0 },
      uOpacity:   { value: 1.0 },
      uSteps:     { value: 100.0 },
      uVoxelSize: { value: new THREE.Vector3(
        spacing[2], spacing[1], spacing[0]  // sx, sy, sz
      )},
    },
    side:        THREE.BackSide,   // ray entry from inside the box
    transparent: true,
    depthWrite:  false,
  });

  // ── Remove old mesh ──────────────────────────────────────────────────────
  if (volumeMesh) {
    scene.remove(volumeMesh);
    volumeMesh.geometry.dispose();
    volumeMesh.material.dispose();
  }

  // ── Physical aspect ratio box ────────────────────────────────────────────
  // Scale each axis by voxel count × spacing so the box has real proportions
  const sz = spacing[0];
  const sy = spacing[1];
  const sx = spacing[2];

  const sX = X * sx;
  const sY = Y * sy;
  const sZ = Z * sz;
  const maxS = Math.max(sX, sY, sZ);

  const geo = new THREE.BoxGeometry(sX / maxS, sY / maxS, sZ / maxS);
  volumeMesh = new THREE.Mesh(geo, mat);
  scene.add(volumeMesh);

  // ── Reset sliders ────────────────────────────────────────────────────────
  cmapMinSlider.value = min.toFixed(4);
  cmapMaxSlider.value = max.toFixed(4);
  state.cmapMin = 0;   // normalised: min maps to 0
  state.cmapMax = 1;   // normalised: max maps to 1

  cmapRow.style.display    = "block";
  cmapMaxRow.style.display = "block";

  densitySlider.value    = "20";
  densityValEl.textContent = "20";
  densityRow.style.display = "block";
  
  thrMinInput.value = min.toFixed(4);
  thrMaxInput.value = max.toFixed(4);
  state.thrMin = 0;
  state.thrMax = 1;

  thrRow.style.display    = "block";
  thrMaxRow.style.display = "block";
  opacSlider.value = "1";
  opacValEl.textContent = "1.00";
  stepsSlider.value = "200";
  stepsValEl.textContent = "200";

  thrRow.style.display   = "block";
  opacRow.style.display  = "block";
  stepsRow.style.display = "block";

  drawLegend(min, max);
  fitCamera();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setStatus(msg) {
  statusEl.textContent = msg;
}

function fitCamera() {
  camera.position.set(1.5, 1.0, 2.0);
  camera.near = 0.01;
  camera.far  = 100;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}