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
//
// It also self-hosts the MediaPipe Pose assets into public/mediapipe/. Those were fetched from two
// public CDNs at runtime (cdn.jsdelivr.net for the wasm, storage.googleapis.com for the .task), which
// means the camera "exoskeleton" died whenever either was unreachable and never worked offline at all
// — and a clinic's captive wifi is exactly where a patient without sensors would use it. The six wasm
// files are already on disk inside node_modules, so that half is a copy, not a download. The model is a
// download, and the same discipline applies to it: if it fails, the warning says so and the hook falls
// back to the CDN by itself (src/lib/cv/useMediaPipePose.ts tries the local path first, then the CDN).
// Set MOVA_SKIP_MEDIAPIPE=1 to skip the whole step.

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

// ── MediaPipe Pose: wasm runtime + pose landmarker model, served from our own origin ──────────────

const mpDest = resolve(here, "../public/mediapipe");
const mpWasmDest = resolve(mpDest, "wasm");
const mpWasmSrc = resolve(here, "../node_modules/@mediapipe/tasks-vision/wasm");
// The six files FilesetResolver picks between at runtime (SIMD / no-SIMD / threaded), pinned by name so
// a package update that adds a seventh shows up here as a missing file rather than silently not copied.
const MP_WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];
const MP_MODEL_FILE = "pose_landmarker_lite.task";
// The "lite" float16 export, which is the one useMediaPipePose has always asked the CDN for. Keeping
// the same file means self-hosting changes where the bytes come from and nothing about the detections.
const MP_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

function copyMediaPipeWasm() {
  if (!existsSync(mpWasmSrc)) {
    console.warn("models:fetch — @mediapipe/tasks-vision wasm not in node_modules; the app uses the CDN.");
    return false;
  }
  mkdirSync(mpWasmDest, { recursive: true });
  let copied = 0;
  for (const f of MP_WASM_FILES) {
    const from = resolve(mpWasmSrc, f);
    if (!existsSync(from)) {
      console.warn(`models:fetch — mediapipe wasm: ${f} missing from node_modules`);
      continue;
    }
    copyFileSync(from, resolve(mpWasmDest, f));
    copied += 1;
  }
  if (copied === MP_WASM_FILES.length) {
    console.log(`models:fetch — copied ${copied} MediaPipe wasm files to public/mediapipe/wasm.`);
    return true;
  }
  console.warn(`models:fetch — MediaPipe wasm incomplete (${copied}/${MP_WASM_FILES.length}); the app uses the CDN.`);
  return false;
}

async function fetchMediaPipeModel() {
  const target = resolve(mpDest, MP_MODEL_FILE);
  if (existsSync(target)) {
    console.log("models:fetch — MediaPipe pose model already present.");
    return true;
  }
  mkdirSync(mpDest, { recursive: true });
  try {
    const res = await fetch(MP_MODEL_URL);
    if (!res.ok) {
      console.warn(`models:fetch — ${MP_MODEL_FILE}: HTTP ${res.status}; the app uses the CDN.`);
      return false;
    }
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    const mb = (statSync(target).size / 1e6).toFixed(1);
    console.log(`models:fetch — downloaded ${MP_MODEL_FILE} (${mb} MB).`);
    return true;
  } catch (err) {
    console.warn(`models:fetch — ${MP_MODEL_FILE}: ${err?.message ?? err}; the app uses the CDN.`);
    return false;
  }
}

async function syncMediaPipe() {
  if (process.env.MOVA_SKIP_MEDIAPIPE === "1") {
    console.log("models:fetch — MOVA_SKIP_MEDIAPIPE=1, leaving MediaPipe on the public CDNs.");
    return;
  }
  const wasm = copyMediaPipeWasm();
  const model = await fetchMediaPipeModel();
  if (wasm && model) {
    console.log("models:fetch — MediaPipe Pose is self-hosted; no runtime CDN needed.");
  }
}

async function main() {
  await syncMediaPipe();

  if (have().length === BINARIES.length) {
    console.log("models:fetch — ONNX binaries already present, nothing to do.");
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
