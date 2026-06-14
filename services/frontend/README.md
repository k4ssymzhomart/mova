# Mova Frontend — Clinician Console

Next.js (App Router, TypeScript) dashboard. Dark-mode-first, Vercel-native aesthetic, bento-grid layout,
with placeholders where the 3D pose viewer and live gait telemetry will mount.

## Run (dev)
```bash
cd services/frontend
npm install
npm run dev          # http://localhost:3000
```
The dashboard talks to the API gateway at `http://localhost:8000` (start it with
`docker compose up --build` from the repo root). CORS for `localhost:3000` is already configured on the API.

## Structure
- `app/layout.tsx`, `app/page.tsx` — shell + bento grid
- `app/globals.css` — design tokens (dark palette), grid, and micro-animations
- `components/` — `StreamStatus` (live state, animated), `MetricCard`, `PosePlaceholder`, `TelemetryStrip`

## Next
Wire `StreamStatus` to the real `ws /api/v1/predict/fog/stream`, render `MetricCard`s from session
metrics, and replace `PosePlaceholder` with a three.js skeleton driven by estimated pose (Roadmap E4).
