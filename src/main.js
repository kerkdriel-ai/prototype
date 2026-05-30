import * as THREE from 'https://unpkg.com/three@0.154.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.154.0/examples/jsm/loaders/GLTFLoader.js';

const status = document.getElementById('status');
const fileInput = document.getElementById('fileInput');
const editToggle = document.getElementById('editToggle');
const locateBtn = document.getElementById('locateBtn');
const placeCenterBtn = document.getElementById('placeCenter');

let map;
let threeLayer;
let loader = new GLTFLoader();
let currentGltf = null;
let currentModelName = 'Model';
let userMarker = null;
let styleBuildingLayerIds = [];
let styleStreetLayerIds = [];
let selectedPlacedObjectId = null;
const layerListEl = document.getElementById('layerList');
const refreshLayersBtn = document.getElementById('refreshLayers');
const layerFilterInput = document.getElementById('layerFilter');
const objectsListEl = document.getElementById('objectsList');
const selectedObjectLabel = document.getElementById('selectedObjectLabel');
const posXInput = document.getElementById('posX');
const posYInput = document.getElementById('posY');
const posZInput = document.getElementById('posZ');
const rotXInput = document.getElementById('rotX');
const rotYInput = document.getElementById('rotY');
const rotZInput = document.getElementById('rotZ');
const scaleInput = document.getElementById('scale');
const posXVal = document.getElementById('posXVal');
const posYVal = document.getElementById('posYVal');
const posZVal = document.getElementById('posZVal');
const rotXVal = document.getElementById('rotXVal');
const rotYVal = document.getElementById('rotYVal');
const rotZVal = document.getElementById('rotZVal');
const scaleVal = document.getElementById('scaleVal');
const deleteObjectBtn = document.getElementById('deleteObject');
const resetObjectBtn = document.getElementById('resetObject');

function updateStatus(msg) { status.textContent = msg; }

function initMap(center = [4.9041, 52.3676], zoom = 16) {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/style.json',
    center,
    zoom,
    pitch: 60,
    bearing: 0
  });

  map.addControl(new maplibregl.NavigationControl());

  // three.js custom layer
  threeLayer = {
    id: 'threejs-layer',
    type: 'custom',
    renderingMode: '3d',
    onAdd: function (map, gl) {
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();

      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(0.5, -1, 0.5).normalize();
      this.scene.add(dir);

      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;

      this.mixers = [];
      this.placed = [];
      this.clock = new THREE.Clock();
    },
    render: function (gl, matrix) {
      const delta = this.clock.getDelta();
      for (const m of this.mixers) m.update(delta);

      const proj = new THREE.Matrix4().fromArray(matrix);
      this.camera.projectionMatrix.copy(proj);

      this.renderer.state.reset();
      this.renderer.render(this.scene, this.camera);
      map.triggerRepaint();
    }
  };

  map.on('load', () => {
    // add a simple OSM raster base layer (insert below existing layers)
    try {
      map.addSource('osm-tiles', {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256
      });
      // insert as the bottom layer
      const firstLayerId = map.getStyle().layers && map.getStyle().layers[0] && map.getStyle().layers[0].id;
      map.addLayer({ id: 'osm-tiles-layer', type: 'raster', source: 'osm-tiles', paint: {} }, firstLayerId);
    } catch (e) {
      console.warn('Could not add OSM raster layer', e);
    }
    // Instead of fetching raw OSM from Overpass, use the style's vector tile layers
    map.addLayer(threeLayer);
    collectStyleLayerIds();
    buildLayerList();
    // apply default visibility: only keep osm raster and detected building layers visible
    applyDefaultLayerVisibility();
    // wire UI controls
    refreshLayersBtn?.addEventListener('click', () => { collectStyleLayerIds(); buildLayerList(); });
    layerFilterInput?.addEventListener('input', () => buildLayerList());
    // re-run when style data changes (some styles load vector sources asynchronously)
    map.on('styledata', () => { collectStyleLayerIds(); buildLayerList(); applyDefaultLayerVisibility(); });
  });

  map.on('moveend', () => {
    // only fetch buildings when zoomed in enough
    // keep style layer ids up to date if style changes or new layers appear
    collectStyleLayerIds();
  });

  // click to place when in edit mode
  map.on('click', (e) => {
    if (!editToggle.checked) return;
    if (!currentGltf) {
      updateStatus('No model loaded to place');
      return;
    }
    addModelAt(e.lngLat, currentGltf);
  });
}

function addModelAt(lngLat, gltf) {
  if (!threeLayer || !threeLayer.scene) return;

  const merc = maplibregl.MercatorCoordinate.fromLngLat(lngLat, 0);

  const model = gltf.scene.clone(true);

  // convert meters to mercator units
  const scale = merc.meterInMercatorCoordinateUnits();
  model.scale.set(scale, scale, scale);
  model.position.set(merc.x, merc.y, merc.z);

  threeLayer.scene.add(model);
  const itemId = 'placed-' + Date.now() + '-' + (threeLayer.placed.length + 1);
  threeLayer.placed.push({
    id: itemId, model, lngLat, name: currentModelName,
    originalPosition: { x: merc.x, y: merc.y, z: merc.z },
    originalMercatorScale: scale,
  });

  if (gltf.animations && gltf.animations.length) {
    const mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      mixer.clipAction(clip).play();
    }
    threeLayer.mixers.push(mixer);
  }

  updateStatus('Placed model at ' + lngLat.toString());
  updateObjectList();
  selectPlacedObject(itemId);
}

// Fetch buildings from Overpass and display as fill-extrusion
async function fetchAndDisplayBuildings() {
  if (!map) return;
  const bounds = map.getBounds();
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const north = bounds.getNorth();
  const east = bounds.getEast();

  const query = `[out:json][timeout:25];(way["building"](${south},${west},${north},${east}););out geom;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
    if (!res.ok) throw new Error('Overpass error ' + res.status);
    const data = await res.json();
    const features = [];
    for (const el of data.elements) {
      if (el.type !== 'way' || !el.geometry) continue;
      const coords = el.geometry.map(p => [p.lon, p.lat]);
      // ensure polygon closed
      if (coords.length && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
        coords.push(coords[0]);
      }
      const props = Object.assign({}, el.tags || {});
      // derive height
      let height = 0;
      if (props.height) {
        const parsed = parseFloat(props.height.replace(/m$/i, ''));
        if (!isNaN(parsed)) height = parsed;
      } else if (props['building:levels']) {
        const lv = parseFloat(props['building:levels']);
        if (!isNaN(lv)) height = lv * 3; // assume 3m per level
      } else {
        height = 10; // default
      }
      props.height = height;
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: props });
    }
    const geo = { type: 'FeatureCollection', features };
    const src = map.getSource('osm-buildings');
    if (src) src.setData(geo);
    updateStatus('Loaded ' + features.length + ' building footprints');
  } catch (err) {
    console.warn('Failed to fetch buildings', err);
  }
}

// Collect vector tile layer ids from the current style for buildings and streets
function collectStyleLayerIds() {
  if (!map || !map.getStyle || !map.getStyle().layers) return;
  styleBuildingLayerIds = [];
  styleStreetLayerIds = [];
  const layers = map.getStyle().layers || [];
  for (const l of layers) {
    const id = l.id || '';
    const type = l.type || '';
    const idlow = id.toLowerCase();
    // Heuristics for building layers (cover fill-extrusion, fill, and source-layer metadata)
    const sourceLayer = (l['source-layer'] || '').toLowerCase();
    if (type === 'fill-extrusion' || type === 'fill' || idlow.includes('building') || idlow.includes('buildings') || sourceLayer.includes('building')) {
      styleBuildingLayerIds.push(id);
    }
    // Heuristics for street/road layers (line/symbol layers that reference road/street/highway)
    if ((type === 'line' || type === 'symbol') && (idlow.includes('road') || idlow.includes('street') || idlow.includes('highway') || idlow.includes('trunk') || idlow.includes('motorway') || idlow.includes('path') || idlow.includes('cycle') || sourceLayer.includes('road') || sourceLayer.includes('street') || sourceLayer.includes('highway'))) {
      styleStreetLayerIds.push(id);
    }
  }
  
  // Log available layers for debugging when detection fails
  if (styleBuildingLayerIds.length === 0 || styleStreetLayerIds.length === 0) {
    console.debug('Available style layers:', layers.map(x => ({ id: x.id, type: x.type, 'source-layer': x['source-layer'] }))); 
  }
  updateStatus('Detected ' + styleBuildingLayerIds.length + ' building layers and ' + styleStreetLayerIds.length + ' street layers');
  // apply current toggle states
  const bChecked = document.getElementById('buildingsToggle')?.checked ?? true;
  const sChecked = document.getElementById('streetsToggle')?.checked ?? true;
  for (const id of styleBuildingLayerIds) setLayerVisibility(id, bChecked);
  for (const id of styleStreetLayerIds) setLayerVisibility(id, sChecked);
}

// Hide all non-essential style layers, keep only osm raster, threejs-layer and building layers visible
function applyDefaultLayerVisibility() {
  if (!map || !map.getStyle) return;
  const layers = map.getStyle().layers || [];
  for (const l of layers) {
    const id = l.id;
    if (!id) continue;
    // keep osm raster layer, custom threejs layer, and building layers
    const keep = id === 'osm-tiles-layer' || id === 'threejs-layer' || styleBuildingLayerIds.includes(id);
    try {
      map.setLayoutProperty(id, 'visibility', keep ? 'visible' : 'none');
    } catch (err) {
      // some layers may not support layout property or be managed differently
    }
  }
  // explicitly keep `countries-fill` off (some styles re-enable it)
  try { if (map.getLayer && map.getLayer('countries-fill')) map.setLayoutProperty('countries-fill', 'visibility', 'none'); } catch (e) {}
}

// Build the in-page layer list UI so the user can toggle exact layers
function buildLayerList() {
  if (!map || !map.getStyle) return;
  const layers = map.getStyle().layers || [];
  const filter = (layerFilterInput?.value || '').toLowerCase().trim();
  if (!layerListEl) return;
  layerListEl.innerHTML = '';
  for (const l of layers) {
    const id = l.id || '';
    if (filter && !id.toLowerCase().includes(filter) && !((l['source-layer'] || '').toLowerCase().includes(filter))) continue;
    const row = document.createElement('div'); row.className = 'layer-item';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = map.getLayoutProperty(id, 'visibility') !== 'none';
    // prevent re-enabling of countries-fill
    if (id === 'countries-fill') {
      cb.checked = false;
      cb.addEventListener('change', (e) => {
        // immediately revert if user tries to enable
        e.target.checked = false;
        try { map.setLayoutProperty('countries-fill', 'visibility', 'none'); } catch (err) {}
      });
    } else {
      cb.addEventListener('change', (e) => {
        try { map.setLayoutProperty(id, 'visibility', e.target.checked ? 'visible' : 'none'); }
        catch (err) { console.warn('Failed to set visibility for', id, err); }
      });
    }
    const label = document.createElement('div');
    label.innerHTML = `<div class="layer-id">${id}</div><div class="layer-meta">type: ${l.type || 'n/a'}${l['source-layer'] ? ' • source-layer: '+l['source-layer'] : ''}</div>`;
    row.appendChild(cb);
    row.appendChild(label);
    layerListEl.appendChild(row);
  }
  if (layers.length === 0) {
    layerListEl.textContent = 'No layers in style yet.';
  }
}

function getPlacedObjectById(id) {
  return threeLayer?.placed?.find((item) => item.id === id) || null;
}

function selectPlacedObject(id) {
  selectedPlacedObjectId = id;
  const item = getPlacedObjectById(id);
  if (!item) {
    selectedObjectLabel.textContent = 'Select an object to edit';
    updateObjectList();
    return;
  }
  selectedObjectLabel.textContent = `Selected: ${item.name}`;
  updateObjectInputs(item);
  updateObjectList();
}

function updateObjectInputs(item) {
  if (!item) return;
  const model = item.model;
  const orig = item.originalPosition;
  const s = item.originalMercatorScale;

  const ox = ((model.position.x - orig.x) / s).toFixed(1);
  const oy = ((model.position.y - orig.y) / s).toFixed(1);
  const oz = Math.max(0, (model.position.z - orig.z) / s).toFixed(1);
  posXInput.value = ox; posXVal.textContent = ox + ' m';
  posYInput.value = oy; posYVal.textContent = oy + ' m';
  posZInput.value = oz; posZVal.textContent = oz + ' m';

  const rx = THREE.MathUtils.radToDeg(model.rotation.x).toFixed(1);
  const ry = THREE.MathUtils.radToDeg(model.rotation.y).toFixed(1);
  const rz = THREE.MathUtils.radToDeg(model.rotation.z).toFixed(1);
  rotXInput.value = rx; rotXVal.textContent = rx + '°';
  rotYInput.value = ry; rotYVal.textContent = ry + '°';
  rotZInput.value = rz; rotZVal.textContent = rz + '°';

  const multiplier = (model.scale.x / s).toFixed(1);
  scaleInput.value = multiplier; scaleVal.textContent = multiplier + 'x';
}

function updateSelectedObjectTransform() {
  const item = getPlacedObjectById(selectedPlacedObjectId);
  if (!item) return;
  const model = item.model;
  const orig = item.originalPosition;
  const s = item.originalMercatorScale;

  const ox = parseFloat(posXInput.value);
  if (!Number.isNaN(ox)) { model.position.x = orig.x + ox * s; posXVal.textContent = ox + ' m'; }
  const oy = parseFloat(posYInput.value);
  if (!Number.isNaN(oy)) { model.position.y = orig.y + oy * s; posYVal.textContent = oy + ' m'; }
  const oz = parseFloat(posZInput.value);
  if (!Number.isNaN(oz)) { model.position.z = orig.z + oz * s; posZVal.textContent = oz + ' m'; }

  const rx = parseFloat(rotXInput.value);
  if (!Number.isNaN(rx)) { model.rotation.x = THREE.MathUtils.degToRad(rx); rotXVal.textContent = rx + '°'; }
  const ry = parseFloat(rotYInput.value);
  if (!Number.isNaN(ry)) { model.rotation.y = THREE.MathUtils.degToRad(ry); rotYVal.textContent = ry + '°'; }
  const rz = parseFloat(rotZInput.value);
  if (!Number.isNaN(rz)) { model.rotation.z = THREE.MathUtils.degToRad(rz); rotZVal.textContent = rz + '°'; }

  const multiplier = parseFloat(scaleInput.value);
  if (!Number.isNaN(multiplier) && multiplier > 0) {
    model.scale.set(multiplier * s, multiplier * s, multiplier * s);
    scaleVal.textContent = multiplier.toFixed(1) + 'x';
  }

  map?.triggerRepaint();
}

function updateObjectList() {
  if (!objectsListEl || !threeLayer) return;
  objectsListEl.innerHTML = '';
  threeLayer.placed.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'object-item' + (item.id === selectedPlacedObjectId ? ' active' : '');
    const title = document.createElement('span');
    title.textContent = item.name || item.id;
    const label = document.createElement('span');
    label.textContent = item.id;
    row.appendChild(title);
    row.appendChild(label);
    row.addEventListener('click', () => selectPlacedObject(item.id));
    objectsListEl.appendChild(row);
  });
  if (threeLayer.placed.length === 0) {
    objectsListEl.textContent = 'No objects placed yet.';
  }
}

posXInput?.addEventListener('input', updateSelectedObjectTransform);
posYInput?.addEventListener('input', updateSelectedObjectTransform);
posZInput?.addEventListener('input', updateSelectedObjectTransform);
rotXInput?.addEventListener('input', updateSelectedObjectTransform);
rotYInput?.addEventListener('input', updateSelectedObjectTransform);
rotZInput?.addEventListener('input', updateSelectedObjectTransform);
scaleInput?.addEventListener('input', updateSelectedObjectTransform);

deleteObjectBtn?.addEventListener('click', () => {
  if (!selectedPlacedObjectId || !threeLayer) return;
  const index = threeLayer.placed.findIndex((item) => item.id === selectedPlacedObjectId);
  if (index === -1) return;
  const removed = threeLayer.placed.splice(index, 1)[0];
  threeLayer.scene.remove(removed.model);
  selectedPlacedObjectId = null;
  selectedObjectLabel.textContent = 'Select an object to edit';
  updateObjectList();
});

resetObjectBtn?.addEventListener('click', () => {
  const item = getPlacedObjectById(selectedPlacedObjectId);
  if (!item) return;
  const model = item.model;
  const orig = item.originalPosition;
  const s = item.originalMercatorScale;

  model.position.set(orig.x, orig.y, orig.z);
  model.rotation.set(0, 0, 0);
  model.scale.set(s, s, s);

  posXInput.value = 0; posXVal.textContent = '0 m';
  posYInput.value = 0; posYVal.textContent = '0 m';
  posZInput.value = 0; posZVal.textContent = '0 m';
  rotXInput.value = 0; rotXVal.textContent = '0°';
  rotYInput.value = 0; rotYVal.textContent = '0°';
  rotZInput.value = 0; rotZVal.textContent = '0°';
  scaleInput.value = 1; scaleVal.textContent = '1.0x';

  map?.triggerRepaint();
});

// Fetch streets (highways) from Overpass and display as line layer
async function fetchAndDisplayStreets() {
  if (!map) return;
  const bounds = map.getBounds();
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const north = bounds.getNorth();
  const east = bounds.getEast();

  const query = `[out:json][timeout:25];(way["highway"](${south},${west},${north},${east}););out geom;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
    if (!res.ok) throw new Error('Overpass error ' + res.status);
    const data = await res.json();
    const features = [];
    for (const el of data.elements) {
      if (el.type !== 'way' || !el.geometry) continue;
      const coords = el.geometry.map(p => [p.lon, p.lat]);
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: Object.assign({}, el.tags || {}) });
    }
    const geo = { type: 'FeatureCollection', features };
    const src = map.getSource('osm-streets');
    if (src) src.setData(geo);
    updateStatus('Loaded ' + features.length + ' streets');
  } catch (err) {
    console.warn('Failed to fetch streets', err);
  }
}

// Toggle handlers for buildings/streets
const buildingsToggle = document.getElementById('buildingsToggle');
const streetsToggle = document.getElementById('streetsToggle');
function setLayerVisibility(layerId, visible) {
  if (!map || !map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}
buildingsToggle && buildingsToggle.addEventListener('change', (e) => {
  setLayerVisibility('osm-buildings-extrusion', e.target.checked);
});
streetsToggle && streetsToggle.addEventListener('change', (e) => {
  setLayerVisibility('osm-streets-layer', e.target.checked);
});


// UI handlers
fileInput.addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  currentModelName = f.name || 'Model';
  updateStatus('Loading ' + currentModelName + ' ...');
  const url = URL.createObjectURL(f);
  loader.load(url, (gltf) => {
    currentGltf = gltf;
    updateStatus('Loaded: ' + currentModelName + ' — click map to place (edit mode) or "Place at center"');
    URL.revokeObjectURL(url);
  }, (xhr) => {
    // progress
  }, (err) => {
    console.error(err);
    updateStatus('Failed to load model');
  });
});

placeCenterBtn.addEventListener('click', () => {
  if (!currentGltf) { updateStatus('No model loaded'); return; }
  addModelAt(map.getCenter(), currentGltf);
});

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) { updateStatus('Geolocation not available'); return; }
  navigator.geolocation.getCurrentPosition((pos) => {
    const lng = pos.coords.longitude;
    const lat = pos.coords.latitude;
    map.flyTo({ center: [lng, lat], zoom: 18 });
    // add or move a user location marker
    if (!userMarker) {
      const el = document.createElement('div'); el.className = 'user-marker';
      userMarker = new maplibregl.Marker(el).setLngLat([lng, lat]).addTo(map);
    } else {
      userMarker.setLngLat([lng, lat]);
    }
  }, (err) => {
    updateStatus('Location denied or unavailable');
  });
});

// Kick off
(function () {
  updateStatus('Requesting location...');
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((p) => {
      initMap([p.coords.longitude, p.coords.latitude]);
      // place initial user marker
      const lng = p.coords.longitude, lat = p.coords.latitude;
      // wait for map to exist
      setTimeout(() => {
        if (map) {
          if (!userMarker) {
            const el = document.createElement('div'); el.className = 'user-marker';
            userMarker = new maplibregl.Marker(el).setLngLat([lng, lat]).addTo(map);
          } else {
            userMarker.setLngLat([lng, lat]);
          }
        }
      }, 500);
      updateStatus('Map initialized at your location');
    }, (err) => {
      initMap();
      updateStatus('Using default location (Amsterdam). Click "Share my location" to update.');
    });
  } else {
    initMap();
    updateStatus('Geolocation not supported — using default');
  }
})();
