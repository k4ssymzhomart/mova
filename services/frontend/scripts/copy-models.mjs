// Copy the Phase-3 ONNX exports into public/models so onnxruntime-web can fetch them at runtime.
// Models are gitignored binaries (regenerate with `python -m mova.export.onnx_export`), so this keeps
// the frontend decoupled from where the checkpoints live. Run: `npm run models:sync`.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const src = resolve(repoRoot, "checkpoints/onnx");
const dest = resolve(here, "../public/models");

const files = ["fog.onnx", "har.onnx", "fog_onnx.json", "har_onnx.json"];

mkdirSync(dest, { recursive: true });
let copied = 0;
for (const f of files) {
  const from = resolve(src, f);
  if (existsSync(from)) {
    copyFileSync(from, resolve(dest, f));
    copied += 1;
    console.log(`copied ${f}`);
  } else {
    console.warn(`missing ${from} — run the Phase-3 ONNX export first`);
  }
}
console.log(`models:sync done (${copied}/${files.length})`);
