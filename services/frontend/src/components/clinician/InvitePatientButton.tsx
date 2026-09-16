"use client";

// InvitePatientButton — the issuance side of onboarding (NTZ WF-02). Calls create_invitation
// (0029_invitations.sql), which returns the raw token exactly once; this is the only place it's ever
// shown, so the clinician copies it immediately to send to the patient (email/SMS/QR — out of scope
// here, this just produces the link).

import { useState } from "react";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export default function InvitePatientButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("create_invitation", {});
      const row = Array.isArray(data) ? data[0] : data;
      if (rpcError || !row?.token) throw rpcError ?? new Error("no token returned");
      setLink(`${window.location.origin}/onboarding/accept?token=${row.token}`);
    } catch {
      setError("Couldn't create an invitation. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function openPanel() {
    setOpen(true);
    setLink(null);
    setCopied(false);
    setError(null);
    void generate();
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      /* clipboard permission denied — the link is still selectable text */
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        className="inline-flex items-center gap-2 rounded-pill border border-line bg-card px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-paper-soft"
      >
        <UserPlus className="size-4" strokeWidth={1.8} />
        Invite a patient
      </button>
    );
  }

  return (
    <div className="rounded-card border border-line bg-card p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">Invitation link</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-faint hover:text-ink">
          Close
        </button>
      </div>
      {busy && (
        <div className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> Generating…
        </div>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {link && (
        <div className="mt-3 space-y-2">
          <p className="text-[12px] text-ink-soft">
            Valid for 7 days, single use. Send it to your patient — this is the only time it&apos;s shown.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-line bg-paper-soft px-3 py-2 font-mono text-[12px] text-ink"
            />
            <button
              type="button"
              onClick={copy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-night px-3 py-2 text-[12px] font-medium text-paper-soft transition-colors hover:bg-ink"
            >
              {copied ? <Check className="size-3.5" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={1.8} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
