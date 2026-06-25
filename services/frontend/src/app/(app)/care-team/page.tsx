import type { Metadata } from "next";
import { CalendarClock, Mail, Phone, Stethoscope } from "lucide-react";

import CareMessenger from "@/components/care/CareMessenger";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Care Team · Mova" };

type OneOrMany<T> = T | T[] | null;
function one<T>(v: OneOrMany<T>): T | null {
  return (Array.isArray(v) ? (v[0] ?? null) : v) ?? null;
}

interface ClinicianRow {
  title: string | null;
  specialties: string[] | null;
  profile: OneOrMany<{ full_name: string | null; display_name: string | null }>;
}

export default async function CareTeamPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: link } = await supabase
    .from("care_team_links")
    .select("relationship, clinician:clinicians(title, specialties, profile:profiles(full_name, display_name))")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const clinician = link ? one(link.clinician as OneOrMany<ClinicianRow>) : null;
  const cProfile = clinician ? one(clinician.profile) : null;

  // Fall back to the clinic's lead therapist when no explicit assignment exists (self-serve patients).
  const name = cProfile?.full_name || "Dr. Dana Park";
  const title = clinician?.title || "Physical Therapist";
  const specialties = clinician?.specialties?.length
    ? clinician.specialties
    : ["Neuro-rehabilitation", "Gait & balance"];
  const relationship = (link?.relationship as string) || "Primary therapist";

  // Next scheduled review — a near-future placeholder until the scheduling service is wired.
  const review = new Date();
  review.setDate(review.getDate() + ((8 - review.getDay()) % 7 || 7)); // next Monday-ish
  review.setHours(10, 30, 0, 0);

  const initials = name
    .replace(/^Dr\.?\s*/i, "")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-8">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Care team</div>
        <h1 className="mt-2 font-serif text-4xl leading-none text-ink sm:text-5xl">The people in your corner.</h1>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        {/* left column: clinician + review */}
        <div className="space-y-5">
          <section className="rounded-xl border border-line bg-card p-7">
            <div className="flex items-center gap-4">
              <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-night font-serif text-2xl text-paper">
                {initials}
              </span>
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-signal-deep">{relationship}</div>
                <h2 className="mt-1 font-serif text-2xl text-ink">{name}</h2>
                <div className="flex items-center gap-1.5 text-[13px] text-ink-soft">
                  <Stethoscope className="size-3.5" strokeWidth={1.7} />
                  {title}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {specialties.map((s) => (
                <span
                  key={s}
                  className="rounded-pill bg-paper-soft px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-soft ring-1 ring-line"
                >
                  {s}
                </span>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2">
              <a
                href="mailto:care@mova.health"
                className="inline-flex items-center justify-center gap-2 rounded-pill border border-line px-4 py-2.5 text-sm text-ink transition-colors hover:bg-paper-soft"
              >
                <Mail className="size-4" strokeWidth={1.7} /> Email
              </a>
              <a
                href="tel:+10000000000"
                className="inline-flex items-center justify-center gap-2 rounded-pill border border-line px-4 py-2.5 text-sm text-ink transition-colors hover:bg-paper-soft"
              >
                <Phone className="size-4" strokeWidth={1.7} /> Call clinic
              </a>
            </div>
          </section>

          {/* next review */}
          <section className="rounded-xl border border-line bg-card p-7">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
              <CalendarClock className="size-4 text-signal" strokeWidth={1.8} />
              Next scheduled review
            </div>
            <div className="mt-3 font-serif text-3xl text-ink">
              {review.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </div>
            <div className="mt-1 text-sm text-ink-soft">
              {review.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Tele-rehab check-in
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">
              {name} will review your session metrics and adjust your program. Your latest progress is shared
              automatically before the call.
            </p>
          </section>
        </div>

        {/* right column: messenger */}
        <CareMessenger clinicianName={name} userId={user?.id ?? ""} />
      </div>
    </div>
  );
}
