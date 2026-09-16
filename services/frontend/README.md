# Mova frontend

The Next.js app: patient app, clinician portal and exercise library. How to set it up, run it and present it is in
the root [`README.md`](../../README.md#running-it). In short:

```bash
npm ci
npm run demo
```

- `npm run demo`: development server with simulated sensors, for presenting (http://127.0.0.1:3000/signin).
- `npm run dev`: development server with real Bluetooth sensors.
- `npm run build` + `npm start`: production server; it never shows test sign-in or simulated sensors.

First copy `.env.local.example` to `.env.local` and fill it in; the test passwords come privately. On Windows
PowerShell type `npm.cmd` instead of `npm`.
