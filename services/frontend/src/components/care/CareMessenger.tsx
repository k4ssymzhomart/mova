// CareMessenger — honest placeholder. Secure in-app messaging has no real backend yet (no thread
// storage, no clinician-side inbox), so this must not simulate a working inbox. Previously this
// component faked a message thread in localStorage with a seeded reply — that's fabricated data on a
// patient-facing screen and has been removed. Replace this panel once a real messages table + RLS +
// clinician inbox view exist.

import { Mail, MessageCircleDashed } from "lucide-react";

export default function CareMessenger() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-line bg-card p-10 text-center">
      <span className="grid size-14 place-items-center rounded-lg bg-paper-soft text-ink-faint">
        <MessageCircleDashed className="size-6" strokeWidth={1.6} />
      </span>
      <h2 className="text-xl text-ink">Secure messaging is coming soon</h2>
      <p className="max-w-sm text-[13px] leading-relaxed text-ink-soft">
        In-app messaging with your care team isn&apos;t available yet. For non-urgent questions, use the
        contact details on this page.
      </p>
      <a
        href="mailto:care@mova.health"
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-pill border border-line px-4 py-2.5 text-sm text-ink transition-colors hover:bg-paper-soft"
      >
        <Mail className="size-4" strokeWidth={1.7} /> Email support
      </a>
    </div>
  );
}
