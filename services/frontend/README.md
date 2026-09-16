# Mova frontend

The Next.js app: patient app, clinician portal and exercise library. How to set it up, run it and present it is in
the root [`README.md`](../../README.md#running-it). In short:

```bash
npm ci
cp .env.local.example .env.local   # then fill it in; the test passwords come privately
npm run demo                       # presenting: development server with simulated sensors
npm run dev                        # development server with real Bluetooth sensors
```

`npm run build` + `npm start` is a production server: it never shows test sign-in or simulated sensors.
