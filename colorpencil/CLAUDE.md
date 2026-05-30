# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

```bash
bun run dev        # Start dev server (Vite)
bun run build      # Production build
bun run check      # Type check with svelte-check
```

Runtime is Bun (not npm/node).

## Architecture

SvelteKit 5 app (Svelte runes) with two core source files:

- **`src/lib/pencil.ts`** — Drawing engine. Handles stroke rendering with Catmull-Rom interpolation, pressure-based width/opacity, seeded grain texture, and paper background noise. Also provides `fillPencilSwatch` for textured color previews.
- **`src/routes/+page.svelte`** — Full-screen canvas UI. Manages pointer events (with coalesced events for smoothness), a pressure-reactive custom cursor, auto-hiding toolbar with color swatches, and canvas lifecycle.

All drawing uses the Canvas 2D API directly with Pointer Events for pressure input. No external UI library or CSS framework.

## Workflow

Commit het resultaat na elke prompt, tenzij aannemelijk is dat het nog geen eindresultaat is en er nog een vervolgprompt nodig gaat zijn voor hetzelfde onderwerp.
