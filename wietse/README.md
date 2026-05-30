# Drawing Generator

Webapp om kindertekeningen te uploaden, automatisch te segmenteren in losse onderdelen, te bewerken, te animeren en om te zetten naar AI-video. Onderdeel van de [kerkdriel-ai/prototype](https://github.com/kerkdriel-ai/prototype) monorepo.

## Wat het doet

1. **Upload** — Tekening uploaden (foto of scan).
2. **Segmentatie** — AI detecteert objecten en maakt per onderdeel een masker en label (zon, boom, persoon, …).
3. **Bewerken** — Maskers samenvoegen, opnieuw segmenteren, animatietype per onderdeel instellen.
4. **Animeren** — GSAP/Konva-scène: onderdelen bewegen los van elkaar.
5. **Animatiescript** — Gemini genereert een shot-voor-shot script; dat script kan naar video worden gerenderd.
6. **Street View** — Tekening plaatsen op een Google Street View-locatie.
7. **AI-video** — Image-to-video via Replicate (cloud) of een lokale Python-server.

Tekeningen worden lokaal opgeslagen in IndexedDB (Dexie); er is geen backend-database.

## Workflow

```
/upload → segmentatie → /edit/[id] → /animate/[id]
                              ↓
                    /script/[id] → AI-video
                              ↓
                    /streetview/[id]
```

| Route | Beschrijving |
|-------|--------------|
| `/` | Galerij met opgeslagen tekeningen |
| `/upload` | Nieuwe tekening uploaden en segmenteren |
| `/edit/[id]` | Onderdelen bekijken, maskers bewerken, opnieuw segmenteren |
| `/animate/[id]` | Interactieve animatie en GIF-export |
| `/script/[id]` | Animatiescript genereren en uitvoeren als video |
| `/streetview/[id]` | Tekening op Street View plaatsen |

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4** + shadcn/ui
- **Konva / react-konva** — canvas en maskers
- **GSAP** — animaties
- **Dexie** — lokale opslag
- **Replicate** — segmentatie (Grounded SAM, SAM 2, Gemini), animatiescripts, cloud-video
- **Google Maps JS API** — Street View
- **FastAPI + PyTorch** — optionele lokale video-server (Stable Video Diffusion / CogVideoX)

## Installatie

De app staat in de monorepo onder `drawing-generator/`:

```bash
git clone git@github.com:kerkdriel-ai/prototype.git
cd prototype/drawing-generator
npm install
cp .env.local.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Vereisten

- Node.js 20+
- Optioneel voor lokale video: Python 3.10+, CUDA-GPU (~9 GB VRAM voor SVD)

## Omgevingsvariabelen

Kopieer `.env.local.example` naar `.env.local` en vul in:

| Variabele | Verplicht | Beschrijving |
|-----------|-----------|--------------|
| `REPLICATE_API_TOKEN` | Aanbevolen | Replicate API-token. Zonder token valt segmentatie terug op lokale kleurclustering (beperkte kwaliteit). |
| `SEGMENT_QUALITY` | Nee | `standard` (default) of `premium` (Gemini + multi-pass Grounded SAM). |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Voor Street View | Google Maps API-key met Street View Static/JS ingeschakeld. |
| `LOCAL_VIDEO_API_URL` | Nee | URL van lokale video-server (default `http://127.0.0.1:8765`). |
| `DEFAULT_VIDEO_PROVIDER` | Nee | `replicate` (default) of `local`. |
| `SEGMENT_RATE_LIMIT_STANDARD` | Nee | Max segmentatie-requests per IP per uur, standard tier (default `100`). |
| `SEGMENT_RATE_LIMIT_PREMIUM` | Nee | Idem premium tier (default `80`). |
| `SEGMENT_RATE_LIMIT_VIDEO` | Nee | Max video-requests per IP per uur (default `40`). |
| `SEGMENT_RATE_LIMIT_SCRIPT` | Nee | Max script-requests per IP per uur (default `50`). |
| `REPLICATE_CALL_DELAY_MS` | Nee | Pauze tussen Replicate-calls bij premium (default `12000`). Verhoog bij laag tegoed. |

Optionele model-overrides:

| Variabele | Default |
|-----------|---------|
| `REPLICATE_GROUNDED_SAM_MODEL` | `schananas/grounded_sam:…` |
| `REPLICATE_SEGMENT_MODEL` | `meta/sam-2:…` |
| `REPLICATE_GEMINI_MODEL` | `google/gemini-2.5-flash:…` |
| `REPLICATE_VIDEO_MODEL` | Wan 2.6 Flash |
| `REPLICATE_VIDEO_DURATION` | `5` (seconden) |
| `REPLICATE_VIDEO_RESOLUTION` | `720p` |

## Segmentatie

Twee kwaliteitsniveaus:

- **Standard** — Enkele Grounded SAM-pass; sneller en goedkoper.
- **Premium** — Gemini vision + meerdere gerichte passes voor drukke tekeningen; betere recall op kleine objecten (bloemen, vogels, …).

Zonder `REPLICATE_API_TOKEN` draait een lokale **kleurclustering-fallback** — bruikbaar voor prototyping, niet voor productie.

## Lokale video-server

Genereer video's op eigen hardware i.p.v. Replicate:

```bash
cd scripts/local-video-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Start via npm (vanuit `drawing-generator/`):

```bash
npm run local-video
```

Of direct:

```bash
python server.py
```

Server draait op `http://127.0.0.1:8765`. Stel `LOCAL_VIDEO_API_URL` en `DEFAULT_VIDEO_PROVIDER=local` in `.env.local`.

| Env (server) | Default | Beschrijving |
|--------------|---------|--------------|
| `LOCAL_VIDEO_MODEL` | `svd` | `svd` (Stable Video Diffusion XT) of `cogvideox` |
| `LOCAL_VIDEO_HOST` | `127.0.0.1` | Bind-adres |
| `LOCAL_VIDEO_PORT` | `8765` | Poort |

## API-routes

| Endpoint | Methode | Functie |
|----------|---------|---------|
| `/api/segment` | POST | Segmentatie (server-side, rate-limited) |
| `/api/animation-script` | POST | Animatiescript genereren via Gemini |
| `/api/animate-video` | POST | Image-to-video (Replicate of lokaal) |

Rate limits gelden per IP per uur (in-memory; reset bij server-restart).

## Scripts

```bash
npm run dev          # Development server
npm run build        # Productie-build
npm run start        # Productie-server
npm run lint         # ESLint
npm run local-video  # Lokale video-server
```

Testscripts voor segmentatie (vereisen `REPLICATE_API_TOKEN`):

```bash
npx tsx scripts/test-segment.ts
npx tsx scripts/test-segment-full.ts
```

## Projectstructuur

```
drawing-generator/
├── app/                  # Next.js routes en API
│   ├── upload/
│   ├── edit/[id]/
│   ├── animate/[id]/
│   ├── script/[id]/
│   ├── streetview/[id]/
│   └── api/
├── components/           # UI + canvas, upload, video
├── lib/                  # Segmentatie, video, animatie, DB
├── hooks/
├── types/
├── scripts/
│   └── local-video-server/
└── public/
```

## Deployen

Deploy als standalone Next.js-app (bijv. Vercel). Zet alle env-variabelen in het hosting-dashboard. `.env.local` commit nooit.

Voor productie: overweeg persistente rate limiting (Redis) i.p.v. in-memory store in `lib/rate-limit.ts`.
