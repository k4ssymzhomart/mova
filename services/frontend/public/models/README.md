# public/models

Runtime model artifacts served to the browser. **The `.onnx`/`.task` binaries are gitignored** — this
README and the sync script are the source of truth for repopulating them.

## ONNX (FoG / HAR — Phase 3)
`onnxruntime-web` (see `src/lib/onnx/useOnnxModel.ts`) fetches these at runtime:

- `fog.onnx` — encoder + FoG head → logits `[B, 2]`
- `har.onnx` — encoder + HAR head → logits `[B, 37]`

Input signature (fixed by the encoder): `window` f32 `[B,200,6]`, `placement_id` i64 `[B]`,
`dataset_id` i64 `[B]`.

Populate from the Phase-3 exports:
```bash
npm run models:sync        # copies checkpoints/onnx/*.onnx -> here
# or regenerate them first:
python -m mova.export.onnx_export --ckpt checkpoints/fog_model.ckpt --task fog --name fog
python -m mova.export.onnx_export --ckpt checkpoints/har_model.ckpt --task har --name har
```
If a model is absent the loader reports `unavailable` and the CV/game loop keeps running.

## MediaPipe Pose (self-hosted, in `public/mediapipe/`)
The pose engine behind the camera "exoskeleton" (`src/lib/cv/useMediaPipePose.ts`) needs two remote
things: the tasks-vision **wasm runtime** and the **pose landmarker model**. Both used to be fetched
from public CDNs on every cold start — `cdn.jsdelivr.net` and `storage.googleapis.com` — so the feature
died whenever either was unreachable and never worked offline. `npm run models:sync` (which `predev`
and `prebuild` already run) now puts both under `public/mediapipe/`, outside this directory:

```
public/mediapipe/wasm/                      # 6 files copied out of node_modules/@mediapipe/tasks-vision
public/mediapipe/pose_landmarker_lite.task  # 5.8 MB, downloaded once from Google's model bucket
```

The whole directory is gitignored at the repo root: it is a build output, like the `.onnx` files above.
Nothing binary is committed.

**Sizes, so the deploy cost is on the record.** The six wasm files total about 34 MB on disk, but a
browser downloads exactly one of them (~11 MB, or ~10 MB on a CPU without SIMD). The threaded
`vision_wasm_module_internal.*` pair is copied for completeness and is never selected in this app,
because `next.config.mjs` sets no COOP/COEP headers and MediaPipe only picks the threaded build in a
cross-origin-isolated page. The model is 5.8 MB. Set `MOVA_SKIP_MEDIAPIPE=1` to skip the whole step.

**The fallback is real, not decorative.** `fetch-models.mjs` never fails the build, so these files can
legitimately be absent. `useMediaPipePose` therefore tries the self-hosted path first and the CDN
second, and only reports an error once both have failed. Passing an explicit `wasmBasePath` or
`modelAssetPath` to the hook overrides the search entirely and tries only what was passed.

The `.task` is the `pose_landmarker_lite` float16 export — the same file the hook always asked the CDN
for, so self-hosting changed where the bytes come from and nothing about the detections.
