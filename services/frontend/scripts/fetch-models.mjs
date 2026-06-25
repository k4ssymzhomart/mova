// fetch-models.mjs — make the Phase-3 ONNX exports available to onnxruntime-web at runtime.
//
// The .onnx binaries are gitignored ML artifacts, so they are NOT in the repo (and therefore not on
// Vercel). This script resolves them, in priority order:
//
//   1. Local `checkpoints/onnx/` — the dev machine that ran `python -m mova.export.onnx_export`.
//      (Also resolves from a git worktree by falling back to the main checkout's common dir.)
//   2. A remote CDN/URL — set MOVA_MODELS_BASE_URL to a base that serves `fog.onnx` + `har.onnx`
//      (e.g. a Supabase Storage public bucket or a GitHub Release). Downloaded at build time.
//   3. Neither — the app falls back to clearly-labelled SIMULATED scoring so the UI never bricks.
//
// It NEVER fails the build: every path exits 0. A missing model degrades to simulation, not a 500.

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, "../public/models");
const BINARIES = ["fog.onnx", "har.onnx"];
// Metadata contracts are git-tracked, but copy them too when syncing from a fresh export.
const META = ["fog_onnx.json", "har_onnx.json", "model_meta.json"];

mkdirSync(dest, { recursive: true });

const have = () => BINARIES.filter((f) => existsSync(resolve(dest, f)));

/** Candidate `checkpoints/onnx` directories, in priority order. */
function localCandidates() {
  const out = [];
  if (process.env.MOVA_CHECKPOINTS) out.push(resolve(process.env.MOVA_CHECKPOINTS));
  out.push(resolve(here, "../../..", "checkpoints/onnx")); // this repo's own root
  try {
    // Git worktrees share one .git; the main checkout (which holds checkpoints/) is the common dir's parent.
    const commonGit = execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd: here })
      .toString()
      .trim();
    if (commonGit) out.push(resolve(dirname(commonGit), "checkpoints/onnx"));
  } catch {
    /* not a git checkout — ignore */
  }
  return [...new Set(out)];
}

function tryLocal() {
  const src = localCandidates().find((d) => existsSync(d));
  if (!src) return;
  for (const f of [...BINARIES, ...META]) {
    const from = resolve(src, f);
    if (existsSync(from)) {
      copyFileSync(from, resolve(dest, f));
      console.log(`models:fetch — copied ${f} from ${src}`);
    }
  }
}

async function tryRemote() {
  const base = process.env.MOVA_MODELS_BASE_URL;
  if (!base) return;
  const baseUrl = base.endsWith("/") ? base : `${base}/`;
  for (const f of BINARIES) {
    const target = resolve(dest, f);
    if (existsSync(target)) continue; // already satisfied locally
    try {
      const url = new URL(f, baseUrl).toString();
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`models:fetch — ${f}: HTTP ${res.status} from ${url}`);
        continue;
      }
      writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      const mb = (statSync(target).size / 1e6).toFixed(1);
      console.log(`models:fetch — downloaded ${f} (${mb} MB) from ${url}`);
    } catch (err) {
      console.warn(`models:fetch — ${f}: ${err?.message ?? err}`);
    }
  }
}

async function main() {
  if (have().length === BINARIES.length) {
    console.log("models:fetch — binaries already present, nothing to do.");
    return;
  }
  tryLocal();
  if (have().length < BINARIES.length) await tryRemote();

  const present = have();
  if (present.length === BINARIES.length) {
    console.log("models:fetch — done. Live ONNX scoring enabled.");
  } else {
    console.warn(
      `models:fetch — ONNX binaries unavailable (${present.length}/${BINARIES.length} present).\n` +
        "  → The app will run with SIMULATED scoring; the UI stays fully functional.\n" +
        "  → To ship the real models, either export locally\n" +
        "      python -m mova.export.onnx_export\n" +
        "    or host them and set a base URL serving fog.onnx + har.onnx:\n" +
        "      MOVA_MODELS_BASE_URL=https://<cdn>/models",
    );
  }
}

// Defensive: never let a model-sync hiccup fail the build.
main().catch((err) => console.warn("models:fetch — unexpected error (ignored):", err?.message ?? err));
