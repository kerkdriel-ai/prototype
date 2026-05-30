# colorpencil

Een full-screen kleurplaat-app met een realistische kleurpotlood-engine, plus een magische modus die getekende figuren uit een tekening knipt en tot leven wekt (lopen, zwaaien, springen, dansen) met lokale AI-animatie.

SvelteKit 5 (runes), Bun, Canvas 2D. De magische modus gebruikt Segment Anything (in de browser) om figuren uit te knippen, en een lokale animatie-service voor de beweging.

## App draaien

Runtime is Bun (niet npm/node).

```bash
bun run dev      # dev-server (Vite) op http://localhost:5173
bun run build    # productie-build (adapter-static)
bun run check    # type-check (svelte-check)
```

## Levensechte animatie: de sidecar

De magische modus animeert figuren via een lokale animatie-service (geen cloud) in `tools/animator/`. Er zijn twee backends:

- `stub`: een lichte procedurele plaatsvervanger. Geen extra installatie nodig.
- `animated_drawings`: Meta's AnimatedDrawings rigt een getekend figuur automatisch en past echte mocap toe. Dit is de levensechte route.

### Stub (licht, meteen iets te zien)

```bash
tools/animator/run.sh        # start op http://127.0.0.1:8765
```

### AnimatedDrawings (levensecht)

Vereist `conda` (Miniconda), Python 3.8.13 (door het setup-script gemaakt) en **Java 11+** voor TorchServe.

```bash
tools/animator/setup-animated-drawings.sh        # cloont + installeert AnimatedDrawings + deps
```

Daarna twee terminals starten (het script print de exacte commando's): TorchServe (de figuur-detector + pose-estimator) en de sidecar zelf, beide in de conda-omgeving. `GET http://127.0.0.1:8765/health` meldt dan `"animated_drawings"` bij de backends en de app toont echte beweging.

Volledige instructies, vereisten, de bewegings-mapping (`motions.json`) en het cache-gedrag staan in [`tools/animator/README.md`](tools/animator/README.md).
