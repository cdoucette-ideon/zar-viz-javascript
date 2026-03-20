# Zarr Volume Raymarcher

A browser-based 3D volumetric viewer for [Zarr](https://zarr.dev/) files, built with [Three.js](https://threejs.org/) and [Vite](https://vitejs.dev/). It uses GPU raymarching to render volumetric data directly in the browser with interactive controls for colormapping, thresholding, opacity, and rendering quality.

![screenshot placeholder](public/screenshot.png)

---

## Features

- 📂 Load `.zarr` stores served locally or from a remote URL
- 🎨 Viridis & Plasma colormaps with adjustable min/max windowing
- 🔬 Threshold filtering to isolate data ranges
- 🎛️ Interactive sliders for density scale, opacity, and ray step quality
- 📐 Physical aspect-ratio-correct bounding box using voxel spacing metadata
- 🌈 Colormap legend with live min/mid/max labels

---

## Prerequisites

- [Node.js](https://nodejs.org/) **v18 or later** (LTS recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/cdoucette-ideon/zar-viz-javascript.git
cd zar-viz-javascript
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

Vite will start a local dev server, typically at:

```
http://localhost:5173
```

Open that URL in your browser to use the viewer.

---

## Loading a Zarr File

The viewer can load any Zarr v2/v3 array store that is accessible via HTTP.

### Option A — Use a bundled sample file

Two sample `.zarr` stores are included in the `public/` directory and pre-populated in the dropdown:

| Name | Path |
|------|------|
| `model.zarr` | `public/model.zarr` |
| `ideon_macpass_muon_density_unconstrained_final.zarr` | `public/ideon_macpass_muon_density_unconstrained_final.zarr` |

Select one from the **"Local Zarr file"** dropdown, then click **Load & Render Volume**.

### Option B — Enter a custom URL

Paste any HTTP-accessible Zarr store URL into the **"...or enter a custom URL"** field and click **Load & Render Volume**.

> **Note:** For local files, Vite serves everything in the `public/` directory at the root path. A file at `public/my_data.zarr` is accessible at `http://localhost:5173/my_data.zarr`. Copy your `.zarr` folder into `public/` to use it.

### Option C — Add your own Zarr file

1. Copy your `.zarr` directory into the `public/` folder:
   ```
   public/
   └── your_data.zarr/
       ├── zarr.json
       └── ...
   ```
2. With the dev server running, enter the URL in the custom URL field:
   ```
   http://localhost:5173/your_data.zarr
   ```
3. Click **Load & Render Volume**.

---

## UI Controls

Once a volume is loaded, the following controls become available in the left panel:

| Control | Description |
|---------|-------------|
| **Colormap** | Switch between Viridis and Plasma colormaps |
| **Colormap min / max** | Window the colormap to a specific data value range |
| **Threshold min / max** | Hide voxels outside this data value range |
| **Density scale** | Controls volume solidity / opacity density (1–200) |
| **Opacity** | Global opacity multiplier (0.01–1.0) |
| **Ray steps (quality)** | Number of raymarching steps (20–400); higher = better quality, slower |

**Mouse controls (3D viewport):**

| Action | Result |
|--------|--------|
| Left-click + drag | Orbit / rotate |
| Right-click + drag | Pan |
| Scroll wheel | Zoom |

---

## Project Structure

```
zar-viz-javascript/
├── index.html              # App entry point & UI layout
├── package.json            # Project metadata & npm scripts
├── public/
│   ├── model.zarr/         # Sample Zarr dataset
│   └── ideon_macpass_muon_density_unconstrained_final.zarr/
└── src/
    ├── main.js             # Three.js scene setup, UI wiring, volume loading
    ├── zarrLoader.js       # Zarr store parsing & chunk fetching
    ├── colormap.js         # Viridis & Plasma LUT builders
    └── shaders/
        ├── volume.vert     # Vertex shader (ray entry points)
        └── volume.frag     # Fragment shader (GPU raymarcher)
```

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Vite dev server with hot-module reload |
| `npm run build` | Build optimised static files to `dist/` |
| `npm run preview` | Preview the production build locally |

---

## Optional: Physical Spacing Metadata

If your Zarr store's `zarr.json` root metadata includes a `spacing` attribute (array of `[sz, sy, sx]` in metres), the viewer will automatically:

- Scale the bounding box to maintain correct physical proportions
- Display spacing and origin information in the status panel

Example `zarr.json` attributes:
```json
{
  "attributes": {
    "spacing": [0.5, 0.5, 0.5],
    "origin": [0.0, 0.0, 0.0]
  }
}
```

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| [three](https://www.npmjs.com/package/three) | ^0.161.0 | 3D rendering (WebGL) |
| [numcodecs](https://www.npmjs.com/package/numcodecs) | ^0.2.2 | Zarr chunk decompression |
| [vite](https://www.npmjs.com/package/vite) *(dev)* | ^5.1.0 | Dev server & bundler |

---

## Troubleshooting

**CORS errors when loading a remote Zarr URL**
> The remote server must include appropriate `Access-Control-Allow-Origin` headers. Use a local copy in `public/` if you cannot control the remote server.

**Blank screen after loading**
> Try lowering **Ray steps** or increasing the **Threshold min** value to reduce the amount of rendered voxels.

**`npm install` fails**
> Ensure you are using Node.js v18+. Run `node --version` to check.

**Port 5173 is already in use**
> Vite will automatically try the next available port and print the actual URL in the terminal.