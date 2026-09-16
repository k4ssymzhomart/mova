import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Vitest runs only the BLE transport and telemetry suites (the #25 neighbours). Every other *.test.ts is a
// node:test file run by `npm run test:unit`; the two globs are disjoint so neither runner loads the other's files.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/lib/ble/**/*.test.ts", "src/lib/telemetry/**/*.test.ts"],
  },
});
