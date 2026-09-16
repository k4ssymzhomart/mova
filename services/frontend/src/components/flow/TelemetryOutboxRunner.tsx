"use client";

// TelemetryOutboxRunner — keeps the telemetry outbox moving for as long as the patient app is open. Frames a
// recording could not deliver (offline when the exercise finished, a reload mid-session) wait in IndexedDB; the
// outbox sends them on app load, when the connection comes back, when a recording stops with rows left, and every
// 30 s while any remain (lib/telemetry/useTelemetryOutbox). Mounted once in the (app) layout. Renders nothing.

import { useTelemetryOutbox } from "@/lib/telemetry/useTelemetryOutbox";

export default function TelemetryOutboxRunner() {
  useTelemetryOutbox();
  return null;
}
