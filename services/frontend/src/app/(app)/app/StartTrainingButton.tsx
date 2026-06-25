"use client";

import { Loader2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Opens a unique training session via the start_training_session RPC, then routes
 * to its detail page. The RPC auto-provisions the patient on first use.
 */
export default function StartTrainingButton() {
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function start() {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc("start_training_session", {
      p_exercise_slug: null,
      p_device_info: { client: "web", started_via: "app" },
    });
    if (error) {
      setBusy(false);
      setErr(error.message);
      return;
    }
    const session = Array.isArray(data) ? data[0] : data;
    router.push(`/app/session/${session.id}`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-pill bg-signal px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-signal-bright disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
        ) : (
          <Play className="size-4" strokeWidth={1.8} />
        )}
        {busy ? "Creating session…" : "Start training session"}
      </button>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
