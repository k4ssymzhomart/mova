# MOVA inference contract (v1)

The typed boundary between the **Supabase app backend** and the **Python ML inference
service** (Part 1.5 / Part 6 of [`MOVA_MASTER_DOCUMENT.md`](../../docs/MOVA_MASTER_DOCUMENT.md)).
One source of truth, three bindings, one signing scheme.

| File | Role |
|---|---|
| [`v1/inference.schema.json`](v1/inference.schema.json) | **Source of truth** — JSON Schema (Draft 2020-12) for `InferenceRequest` / `InferenceResponse`. |
| [`v1/models.py`](v1/models.py) | Pydantic v2 models for the Python service. Backward-compatible with `services/api/app/schemas.py`. |
| [`v1/types.ts`](v1/types.ts) | TypeScript types for Supabase Edge Functions + the frontend. |
| [`v1/signing.py`](v1/signing.py) | HMAC-SHA256 request signing (replay-protected). Pure stdlib; has a self-test. |

> **Privacy invariant:** payloads carry *derived* IMU windows, pose keypoints, and metrics
> only. **Raw video never crosses this boundary** — it never leaves the client.

## Call flow

```
client ──derived windows──▶ Supabase Edge Function
                                │  1. authenticates the user (JWT), checks RLS access to the patient
                                │  2. inserts public.inference_jobs (status='queued', request=<InferenceRequest>)
                                │  3. POSTs the signed InferenceRequest to the Python service
                                ▼
                        Python inference service  (FastAPI; service_role)
                                │  4. verifies signature + timestamp, runs the model (or mock)
                                │  5. returns an InferenceResponse
                                ▼
                        Edge Function / worker
                                   6. updates inference_jobs (status='succeeded', result=<InferenceResponse>)
                                   7. fans out: fog → public.fog_events, summary → public.session_metrics
```

The DB surface is `public.inference_jobs` (migration `0016_inference_contract.sql`): a typed
request in, a typed result out, RLS-scoped to the patient. The Python service connects with
the Supabase **service_role** (bypasses RLS) and is the only writer of model outputs.

## Signing

Shared secret lives in the **Supabase Vault** and the service env — never in the repo. The
caller signs `"<timestamp>.<body>"` with HMAC-SHA256 and sends:

```
X-Mova-Timestamp: <unix seconds>
X-Mova-Signature: v1=<hex>
```

The receiver recomputes the MAC, compares in constant time (`hmac.compare_digest`), and
rejects timestamps outside a 5-minute window (replay protection). Run the self-test:

```bash
python contracts/inference/v1/signing.py   # -> "signing self-test: OK"
```

## Versioning

`contract_version` is pinned to `"1.0"`. Breaking changes ship as `contracts/inference/v2/`
so old clients keep working. The FoG specialization (`task="fog"`) is wire-compatible with the
existing `POST /api/v1/predict/fog` (`FogWindow` → `FogPrediction`).
