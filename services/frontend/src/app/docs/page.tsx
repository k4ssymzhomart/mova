import type { Metadata } from "next";

import ReadingLayout from "@/components/reading/ReadingLayout";
import {
  Badge,
  Callout,
  CodeBlock,
  DataTable,
  KeyVal,
  P,
  Section,
} from "@/components/reading/ui";
import { inferenceSchema } from "@/lib/evidence";

export const metadata: Metadata = {
  title: "Docs — Mova",
  description:
    "Developer reference for the Mova platform: the typed inference contract, HTTP/WebSocket API, request signing, and local run / deploy guides.",
};

const TOC = [
  { id: "endpoints", label: "API endpoints" },
  { id: "contract", label: "Inference contract" },
  { id: "signing", label: "Request signing" },
  { id: "run", label: "Run locally" },
  { id: "deploy", label: "Deploy" },
  { id: "openapi", label: "OpenAPI reference" },
];

const defs = inferenceSchema["$defs"] as Record<string, any>;
const contractVersion = defs.InferenceRequest.properties.contract_version.const as string;
const tasks = defs.task.enum as string[];
const bodySites = defs.bodySite.enum as string[];
const reqRequired = defs.InferenceRequest.required as string[];
const resRequired = defs.InferenceResponse.required as string[];

const ENDPOINTS = [
  { method: "GET", path: "/", desc: "Service metadata + docs pointer" },
  { method: "GET", path: "/health", desc: "Liveness + DB ping + model mode" },
  { method: "POST", path: "/api/v1/predict/fog", desc: "Score one IMU window for freezing of gait" },
  { method: "WS", path: "/api/v1/predict/fog/stream", desc: "Stream windows in, predictions out" },
];

export default function DocsPage() {
  return (
    <ReadingLayout
      eyebrow="Developer docs"
      meta={`contract v${contractVersion} · stub`}
      title={
        <>
          Build against
          <br />
          a typed boundary.
        </>
      }
      lede="One inference contract, three bindings (JSON Schema, Pydantic, TypeScript), one signing scheme. This is the developer surface for the Mova API and the local stack — a living stub that tracks contracts/inference/v1 and the FastAPI gateway."
      toc={TOC}
      intro={
        <Callout tone="signal" title="Privacy invariant">
          Payloads carry <em>derived</em> IMU windows, pose keypoints and metrics
          only. Raw video never crosses this boundary — it never leaves the client.
        </Callout>
      }
    >
      {/* ---- Endpoints ---- */}
      <Section id="endpoints" title="API endpoints" kicker="FastAPI gateway · v0.1.0">
        <P>
          The Python gateway exposes a small, mock-backed surface today
          (<code className="rounded bg-paper-soft px-1 py-0.5 font-mono text-[0.85em]">MODEL_MODE=mock</code>);
          the FoG route is wire-compatible with the typed contract below.
        </P>
        <DataTable
          cols={[
            { key: "method", label: "Method", mono: true },
            { key: "path", label: "Path", mono: true },
            { key: "desc", label: "Purpose" },
          ]}
          rows={ENDPOINTS.map((e) => ({
            method: <Badge tone={e.method === "WS" ? "signal" : "neutral"}>{e.method}</Badge>,
            path: e.path,
            desc: e.desc,
          }))}
          caption="Source: services/api/app (main.py, routers/predict.py)"
        />
      </Section>

      {/* ---- Contract ---- */}
      <Section id="contract" title="Inference contract (v1)" kicker={`pinned to v${contractVersion}`}>
        <P>
          The typed boundary between the Supabase app backend and the Python ML
          service. The JSON Schema at{" "}
          <code className="rounded bg-paper-soft px-1 py-0.5 font-mono text-[0.85em]">
            contracts/inference/v1/inference.schema.json
          </code>{" "}
          is the source of truth; Pydantic and TypeScript bindings are generated
          from it.
        </P>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              Supported tasks
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {tasks.map((t) => (
                <span
                  key={t}
                  className="rounded-pill border border-signal/25 bg-signal/[0.06] px-2.5 py-1 font-mono text-[11px] text-signal-deep"
                >
                  {t}
                </span>
              ))}
            </div>
            <h3 className="mb-3 mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              Body sites — {bodySites.length}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {bodySites.map((b) => (
                <span
                  key={b}
                  className="rounded-pill border border-line bg-paper-soft px-2.5 py-1 font-mono text-[11px] text-ink-soft"
                >
                  {b}
                </span>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              Message shape
            </h3>
            <KeyVal
              items={[
                { k: "Contract version", v: contractVersion },
                { k: "Request required", v: <code className="font-mono text-[12px]">{reqRequired.join(", ")}</code> },
                { k: "Response required", v: <code className="font-mono text-[12px]">{resRequired.join(", ")}</code> },
                { k: "Window", v: "[T, 6] = acc(xyz) + gyro(xyz)" },
              ]}
            />
          </div>
        </div>
        <CodeBlock label="POST /api/v1/predict/fog — request">{`{
  "window": [[0.01, -0.98, 0.12, 0.00, 0.01, -0.02], …],
  "sampling_rate": 50,
  "session_id": "optional"
}`}</CodeBlock>
        <CodeBlock label="200 — response (FogPrediction)">{`{
  "is_fog": false,
  "confidence": 0.18,
  "timestamp": "2026-06-23T11:30:16Z",
  "freeze_index": 0.42,
  "source": "mock-bachlin-freeze-index"
}`}</CodeBlock>
      </Section>

      {/* ---- Signing ---- */}
      <Section id="signing" title="Request signing" kicker="HMAC-SHA256 · replay-protected">
        <P>
          The caller signs{" "}
          <code className="rounded bg-paper-soft px-1 py-0.5 font-mono text-[0.85em]">
            &quot;&lt;timestamp&gt;.&lt;body&gt;&quot;
          </code>{" "}
          with a shared secret (held in the Supabase Vault, never in the repo). The
          receiver recomputes the MAC, compares in constant time, and rejects
          timestamps outside a 5-minute window.
        </P>
        <CodeBlock label="Request headers">{`X-Mova-Timestamp: <unix seconds>
X-Mova-Signature: v1=<hex hmac-sha256>`}</CodeBlock>
        <CodeBlock label="Self-test">{`python contracts/inference/v1/signing.py
# -> "signing self-test: OK"`}</CodeBlock>
      </Section>

      {/* ---- Run ---- */}
      <Section id="run" title="Run locally" kicker="Two processes">
        <P>
          The local stack is the API gateway + TimescaleDB via Docker Compose, and
          the Next.js frontend via npm. CORS for{" "}
          <code className="rounded bg-paper-soft px-1 py-0.5 font-mono text-[0.85em]">
            localhost:3000
          </code>{" "}
          is preconfigured.
        </P>
        <CodeBlock label="API + database (repo root)">{`docker compose up --build
curl localhost:8000/health
# {"status":"ok","database":true,"model_mode":"mock"}`}</CodeBlock>
        <CodeBlock label="Frontend">{`cd services/frontend
npm install
npm run sync:content   # refresh credibility artifacts (runs automatically on dev/build)
npm run dev            # http://localhost:3000`}</CodeBlock>
      </Section>

      {/* ---- Deploy ---- */}
      <Section id="deploy" title="Deploy" kicker="Stub — see roadmap">
        <P>
          The frontend is Vercel-native (static credibility pages + server
          components). The API ships as a container; the database is managed
          TimescaleDB / Supabase Postgres.
        </P>
        <KeyVal
          items={[
            { k: "Frontend", v: "Vercel — build runs prebuild content sync, then next build" },
            { k: "API", v: <span>Container from <code className="font-mono text-[12px]">services/api/Dockerfile</code></span> },
            { k: "Database", v: "Managed Postgres / TimescaleDB (migrations in supabase/)" },
            { k: "Secrets", v: "Signing key + service-role in Vault / service env" },
          ]}
        />
        <Callout tone="signal" title="Content sync is part of the build">
          <code className="font-mono text-[12px]">prebuild</code> runs{" "}
          <code className="font-mono text-[12px]">scripts/sync-content.mjs</code>, so
          deployed credibility pages always reflect the committed Phase 2 / Phase 3
          artifacts.
        </Callout>
      </Section>

      {/* ---- OpenAPI ---- */}
      <Section id="openapi" title="OpenAPI reference" kicker="Auto-generated">
        <P>
          FastAPI generates the OpenAPI schema and an interactive explorer from the
          route signatures. When the gateway is running, the spec and Swagger UI are
          served directly — this page is the human stub that points to them.
        </P>
        <DataTable
          cols={[
            { key: "what", label: "Surface" },
            { key: "path", label: "Path", mono: true },
          ]}
          rows={[
            { what: "Swagger UI", path: "localhost:8000/docs" },
            { what: "ReDoc", path: "localhost:8000/redoc" },
            { what: "OpenAPI JSON", path: "localhost:8000/openapi.json" },
          ]}
          caption="Served by the FastAPI app (services/api) once docker compose is up."
        />
        <Callout title="Status">
          The hosted, versioned OpenAPI reference is a planned surface. Today the
          spec is generated at runtime by the gateway; the typed contract in{" "}
          <code className="font-mono text-[12px]">contracts/inference/v1</code> is the
          stable, reviewed source of truth.
        </Callout>
      </Section>
    </ReadingLayout>
  );
}
