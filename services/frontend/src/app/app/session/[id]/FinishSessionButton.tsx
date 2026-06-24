"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Closes the session and saves aggregate metrics via finish_training_session.
 * Metrics here are simulated placeholders; the live pipeline supplies real ones.
 */
export default function FinishSessionButton({
  sessionId,
}: {
  sessionId: string;
}) {
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function finish() {
    setBusy(true);
    setErr(null);

    // Simulated session summary — deterministic-ish demo values.
    const metrics = {
      reps: 8 + Math.floor(Math.random() * 8),
      rom_max: Number((70 + Math.random() * 25).toFixed(1)),
      rom_mean: Number((55 + Math.random() * 15).toFixed(1)),
      smoothness: Number((0.7 + Math.random() * 0.25).toFixed(2)),
      symmetry: Number((0.8 + Math.random() * 0.18).toFixed(2)),
      quality_score: Number((0.75 + Math.random() * 0.2).toFixed(2)),
      adherence: 1.0,
      fog_risk: Number((0.05 + Math.random() * 0.2).toFixed(2)),
    };

    const { error } = await supabase.rpc("finish_training_session", {
      p_session: sessionId,
      p_summary: { source: "simulated" },
      p_metrics: metrics,
    });

    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={finish}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-pill bg-signal px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-signal-bright disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
        ) : (
          <Check className="size-4" strokeWidth={1.8} />
        )}
        {busy ? "Saving…" : "Finish & save metrics"}
      </button>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
