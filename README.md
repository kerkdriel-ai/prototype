# MapLibre 3D Placement

This small demo shows a MapLibre map with a three.js custom layer. You can upload a `.glb` or `.gltf` file (with animations) and place it onto the map at a geographic location while in edit mode.

Quick start:

1. Open a simple HTTP server from the project root (required because modern browsers block module/GLTF loads via `file://`):

```bash
python3 -m http.server 5173
# or with npm installed: npx http-server -p 5173
```

2. Open http://localhost:5173 in your browser.

Usage:
- Allow sharing your location when prompted to center the map at your device location.
- Toggle `Edit mode` to allow placing models.
- Choose a `.glb` or `.gltf` file via the file input. After loading, click the map (while in edit mode) to place the model at that position, or use `Place at center`.

Notes:
- This prototype uses CDN-hosted MapLibre and three.js modules. For production, pin versions and bundle.
- Models are scaled to the map's Mercator coordinates. You may want to adjust scale or rotation for your assets.

Map layers:
- The demo adds an OpenStreetMap raster tile base layer for streets/visual context.
- Building footprints are fetched from the Overpass API for the current viewport and rendered as `fill-extrusion` (3D buildings). Buildings are fetched automatically when the map loads and after panning/zooming when zoom >= 15.

Caveats:
- Overpass is a shared public API; heavy use may be rate-limited. For production, bake tiles or run a dedicated service.
- Building heights are inferred from `height` or `building:levels` when present; otherwise a default height is used.

HTTPS local server:
- To avoid CORS or mixed-content issues, serve the project over HTTPS locally using a trusted `mkcert` certificate.
- Create a local cert with mkcert (if installed):

```bash
mkcert -install
mkcert localhost
```

- This creates `localhost.pem` and `localhost-key.pem` in your folder. Then run the Node HTTPS server:

```bash
node server.js --cert localhost.pem --key localhost-key.pem --port 5173
```

- Or use the npm script if you want:

```bash
npm start
```

- Open https://localhost:5173 in your browser. The cert will be trusted by your machine if mkcert was installed successfully.

- If you do not want mkcert, you can still use OpenSSL to generate a self-signed cert, but the browser will warn.

