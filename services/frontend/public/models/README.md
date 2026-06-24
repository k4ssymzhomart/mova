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

## MediaPipe Pose (optional self-hosting)
`useMediaPipePose` defaults to Google's model + wasm CDN, so no local file is required. To self-host,
download `pose_landmarker_lite.task` here and point `modelAssetPath` at `/models/pose_landmarker_lite.task`.
