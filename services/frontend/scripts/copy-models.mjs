// Copy the Phase-3 ONNX exports into public/models so onnxruntime-web can fetch them at runtime.
// Models are gitignored binaries (regenerate with `python -m mova.export.onnx_export`). This keeps the
// frontend decoupled from where the checkpoints live, and — crucially — resolves them even from a git
// worktree (where the worktree's own root has no checkpoints/) by falling back to the MAIN checkout's
// root, derived from the shared git common dir.

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, "../public/models");
const files = ["fog.onnx", "har.onnx", "fog_onnx.json", "har_onnx.json"];

/** Candidate `checkpoints/onnx` directories, in priority order. */
function candidates() {
  const out = [];
  if (process.env.MOVA_CHECKPOINTS) out.push(resolve(process.env.MOVA_CHECKPOINTS));
  // This repo's own root — works in the primary checkout.
  out.push(resolve(here, "../../..", "checkpoints/onnx"));
  // Git worktrees share one .git; the main checkout (which holds checkpoints/) is the common dir's parent.
  try {
    const commonGit = execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd: here })
      .toString()
      .trim();
    if (commonGit) out.push(resolve(dirname(commonGit), "checkpoints/onnx"));
  } catch {
    /* not a git checkout — ignore */
  }
  return [...new Set(out)];
}

const tried = candidates();
const src = tried.find((d) => existsSync(d));
mkdirSync(dest, { recursive: true });

if (!src) {
  console.warn(
    `models:sync — no checkpoints/onnx found.\n  looked in:\n    ${tried.join("\n    ")}\n` +
      `  export the models first:  python -m mova.export.onnx_export`,
  );
  process.exit(0);
}

let copied = 0;
for (const f of files) {
  const from = resolve(src, f);
  if (existsSync(from)) {
    copyFileSync(from, resolve(dest, f));
    copied += 1;
    console.log(`copied ${f}`);
  } else {
    console.warn(`missing ${from}`);
  }
}
console.log(`models:sync done (${copied}/${files.length}) from ${src}`);
