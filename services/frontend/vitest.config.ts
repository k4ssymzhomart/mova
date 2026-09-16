import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Vitest runs only the BLE transport, telemetry and scoring suites, the files written against vitest. Every other
// *.test.ts is a node:test file run by `npm run test:unit`; the globs are disjoint so neither runner loads the other's.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/lib/ble/**/*.test.ts", "src/lib/telemetry/**/*.test.ts", "src/lib/scoring/**/*.test.ts"],
  },
});
