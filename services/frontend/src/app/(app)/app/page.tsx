import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";

import StartTrainingButton from "./StartTrainingButton";

export const metadata: Metadata = { title: "Training · Mova" };

type Agg = { quality_score: number | null; reps: number | null } | null;
type SessionRow = {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  session_metrics: Agg | Agg[];
};

/** PostgREST may return a to-one embed as an object or a single-element array. */
function aggOf(s: SessionRow): Agg {
  const v = s.session_metrics;
  return (Array.isArray(v) ? (v[0] ?? null) : v) as Agg;
}

export default async function AppHome() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Idempotent safety net (the OAuth callback also provisions on first login).
  await supabase.rpc("provision_self_serve_patient");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, display_name, role")
    .eq("id", user!.id)
    .maybeSingle();

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, status, started_at, ended_at, session_metrics(quality_score, reps)")
    .order("started_at", { ascending: false })
    .limit(25);

  const rows = (sessions ?? []) as unknown as SessionRow[];
  const name =
    profile?.display_name || profile?.full_name || user!.email?.split("@")[0];
  const completed = rows.filter((s) => s.status === "completed").length;

  return (
    <div className="space-y-10">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">
          Welcome back
        </div>
        <h1 className="mt-3 font-serif text-[clamp(2rem,5vw,3.2rem)] leading-tight text-ink">
          {name}
        </h1>
        <p className="mt-3 max-w-xl text-ink-soft">
          Each workout opens its own training session — a unique record that
          captures your movement metrics, freeze-risk and progress over time.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Sessions" value={`${rows.length}`} />
        <Stat label="Completed" value={`${completed}`} />
        <Stat label="In progress" value={`${rows.length - completed}`} />
      </div>

      <div className="rounded-card border border-line bg-card p-6 sm:p-8">
        <h2 className="font-serif text-2xl text-ink">Start a training session</h2>
        <p className="mt-2 max-w-lg text-sm text-ink-soft">
          Begin a new session. We generate a fresh session id, attach it to your
          profile, and you can record and finalise it with your metrics.
        </p>
        <div className="mt-5">
          <StartTrainingButton />
        </div>
      </div>

      <div>
        <h2 className="mb-4 font-serif text-2xl text-ink">Your sessions</h2>
        {rows.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-5 py-8 text-center text-sm text-ink-faint">
            No sessions yet — start your first one above.
          </p>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-paper-soft/60 text-left">
                    <Th>Session</Th>
                    <Th>Started</Th>
                    <Th>Status</Th>
                    <Th right>Quality</Th>
                    <Th right>Reps</Th>
                    <Th right></Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((s) => {
                    const agg = aggOf(s);
                    return (
                    <tr key={s.id} className="hover:bg-paper-soft/40">
                      <Td mono>{s.id.slice(0, 8)}</Td>
                      <Td>{new Date(s.started_at).toLocaleString()}</Td>
                      <Td>
                        <StatusPill status={s.status} />
                      </Td>
                      <Td right mono>
                        {agg?.quality_score != null
                          ? agg.quality_score.toFixed(2)
                          : "—"}
                      </Td>
                      <Td right mono>
                        {agg?.reps ?? "—"}
                      </Td>
                      <Td right>
                        <a
                          href={`/app/session/${s.id}`}
                          className="text-signal-deep hover:underline"
                        >
                          Open
                        </a>
                      </Td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-card p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </div>
      <div className="tnum mt-2 font-serif text-3xl text-ink">{value}</div>
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  mono,
}: {
  children: React.ReactNode;
  right?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-4 py-3 text-ink ${right ? "text-right" : "text-left"} ${
        mono ? "tnum font-mono" : ""
      }`}
    >
      {children}
    </td>
  );
}

function StatusPill({ status }: { status: string }) {
  const done = status === "completed";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${
        done
          ? "border-signal/30 bg-signal/10 text-signal-deep"
          : "border-amber-500/30 bg-amber-50 text-amber-700"
      }`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
