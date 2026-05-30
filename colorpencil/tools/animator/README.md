# Lokale animatie-sidecar

Een lokale service die uitgeknipte line-art figuren animeert op de desktop, zonder cloud. De web-app (magische modus) detecteert deze service automatisch en toont dan per figuur bewegingen (zwaaien, springen, sprongetjes, dansen, zombie). Staat de service niet aan, dan zijn er in de app geen bewegingen.

Twee backends:
- `stub`: een procedurele plaatsvervanger die het figuur echt laat bewegen (wuiven, stuiteren, draaien) per beweging. Werkt met de lichte dependencies hieronder en geeft meteen iets aardigs te zien.
- `animated_drawings`: Meta's AnimatedDrawings rigt automatisch een getekend figuur en past echte mocap-beweging toe. Dit is de levensechte route.

## Stub draaien (licht)

```bash
tools/animator/run.sh
```

Maakt een virtualenv, installeert fastapi/uvicorn/pillow en start op `http://127.0.0.1:8765`. `GET /health` meldt dan `"backends": ["stub"]`.

## AnimatedDrawings inschakelen (levensecht)

```bash
tools/animator/setup-animated-drawings.sh [doelmap]   # default: ~/AnimatedDrawings
```

Vereist `conda` (Miniconda). Het script cloont AnimatedDrawings (MIT, https://github.com/facebookresearch/AnimatedDrawings), maakt een conda-omgeving met **Python 3.8.13** (vereist door AnimatedDrawings), installeert het pakket editable, draait `torchserve/setup_macos.sh` (torch 1.13, mmdet/mmpose, mmcv-full, en de twee modellen), en installeert de extra deps die AnimatedDrawings niet zelf meebrengt: `tomli platformdirs scikit-image opencv-python fastapi uvicorn[standard]`.

Daarna twee terminals (het script print de commando's):

1. TorchServe (detector + pose). Vereist **Java 11+** (macOS heeft vaak nog Java 8): `brew install openjdk`, dan
   ```bash
   cd <doelmap>/torchserve
   export JAVA_HOME="$(brew --prefix openjdk)/libexec/openjdk.jdk/Contents/Home"
   conda activate animated_drawings
   torchserve --start --ts-config config.local.properties --disable-token-auth --foreground
   ```
   `--disable-token-auth` is nodig: recente TorchServe-versies zetten token-authorisatie aan, wat AnimatedDrawings' tokenloze requests blokkeert.
2. De sidecar, in dezelfde conda-omgeving, met de repo-locatie:
   ```bash
   cd tools/animator
   conda activate animated_drawings
   ANIMATED_DRAWINGS_DIR=<doelmap> uvicorn main:app --host 127.0.0.1 --port 8765
   ```

`GET /health` meldt nu `"backends": ["stub", "animated_drawings"]` en de app toont echte levensechte beweging.

> Gevalideerd op macOS (Apple Silicon via Rosetta, Homebrew JDK 25): een wave-render duurt ~36s. De motion-clip wordt tot 120 frames ingekort (`MAX_MOTION_FRAMES` in `animated_drawings_backend.py`) voor een korte lus en snelle render, en de render draait in een subproces omdat de OpenGL-context niet op een serverthread kan.

### Bewegingen koppelen

`motions.json` koppelt elke knop aan een motion- en retarget-config uit de AnimatedDrawings repo. De huidige mapping is geverifieerd tegen de repo:

| Knop | motion_cfg | retarget_cfg | skelet |
|------|------------|--------------|--------|
| wave | wave_hello.yaml | fair1_ppf.yaml | fair1 |
| jump | jumping.yaml | fair1_ppf.yaml | fair1 |
| jumpingjacks | jumping_jacks.yaml | cmu1_pfp.yaml | cmu1 |
| dance | dab.yaml | fair1_ppf.yaml | fair1 |
| zombie | zombie.yaml | fair1_ppf.yaml | fair1 |

De `retarget_cfg` moet bij het skelet van de gekozen BVH passen (een bekende AnimatedDrawings-valkuil): fair1-BVH's met `fair1_ppf`, cmu1-BVH's met `cmu1_pfp`.

### Lopen toevoegen

AnimatedDrawings levert geen ingebouwde wandel-BVH, dus "lopen" zit niet standaard in de app. Toevoegen:

1. Download een gratis "Walking" BVH van Mixamo (https://www.mixamo.com, Adobe-account) en zet hem bij de andere BVH's in de AnimatedDrawings repo, met een motion-config ernaar.
2. Voeg in `motions.json` toe: `"walk": { "motion_cfg": "examples/config/motion/walk.yaml", "retarget_cfg": "examples/config/retarget/mixamo_fff.yaml" }` (retarget passend bij het Mixamo-skelet).
3. Voeg in `src/lib/animation.ts` aan `LIFELIKE_MOTIONS` toe: `{ id: 'walk', label: 'Lopen', icon: '🚶' }`.

## Contract

`GET /health` → `{ "status": "ok", "device": "cuda|mps|cpu", "backends": ["stub", "animated_drawings"] }`

`POST /animate`
```json
{
  "keyframes": ["<base64 png van het figuur>"],
  "motion": "wave|jump|jumpingjacks|dance|zombie",
  "backend": "animated_drawings|stub",
  "fps": 12,
  "frame_count": 24,
  "loop": true
}
```
→
```json
{ "frames": ["<base64 png>", "..."], "fps": 12, "loop": true }
```

De app stuurt het uitgeknipte figuur (transparante PNG, zwarte lijnen) als `keyframes[0]`. De frames worden in de app op de plek van het figuur afgespeeld.

De app praat vanaf een HTTPS-pagina met `http://127.0.0.1`; browsers staan dit toe omdat loopback als veilig geldt. In dev (`http://localhost:5173`) werkt het zonder meer.

## Cache

Gerenderde animaties worden op schijf gecachet in `~/.cache/colorpencil-animator/`, met een sleutel van (figuur + beweging + backend + frame_count). Dezelfde figuur opnieuw of een eerder gemaakte beweging terugvragen komt direct uit de cache (~0.1s) i.p.v. opnieuw renderen (~35s), zodat heen en weer schakelen tussen animaties snel is. Leeg de map om de cache te wissen.
