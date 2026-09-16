import type { Metadata } from "next";
import { Mail, Stethoscope, UserRoundX } from "lucide-react";

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

  const { data: link } = await supabase
    .from("care_team_links")
    .select("relationship, clinician:clinicians(title, specialties, profile:profiles(full_name, display_name))")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const clinician = link ? one(link.clinician as OneOrMany<ClinicianRow>) : null;
  const cProfile = clinician ? one(clinician.profile) : null;
  const name = cProfile?.full_name || cProfile?.display_name || null;

  const header = (
    <header>
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Care team</div>
      <h1 className="mt-2 text-4xl leading-none text-ink sm:text-5xl">The people in your corner.</h1>
    </header>
  );

  // No real clinician assignment yet — an honest empty state, not a fabricated stand-in.
  if (!clinician || !name) {
    return (
      <div className="space-y-8">
        {header}
        <section className="rounded-xl border border-line bg-card p-10 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-lg bg-paper-soft text-ink-faint">
            <UserRoundX className="size-6" strokeWidth={1.6} />
          </span>
          <h2 className="mt-4 text-xl text-ink">No clinician assigned yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-soft">
            Your care team will appear here once your clinic assigns a clinician to your program.
          </p>
        </section>
      </div>
    );
  }

  const title = clinician.title || "Physical Therapist";
  const specialties = clinician.specialties?.length ? clinician.specialties : [];
  const relationship = (link?.relationship as string) || "Care team";

  const initials = name
    .replace(/^Dr\.?\s*/i, "")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-8">
      {header}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        {/* left column: clinician */}
        <div className="space-y-5">
          <section className="rounded-xl border border-line bg-card p-7">
            <div className="flex items-center gap-4">
              <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-night text-2xl text-paper">
                {initials}
              </span>
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-signal-deep">{relationship}</div>
                <h2 className="mt-1 text-2xl text-ink">{name}</h2>
                <div className="flex items-center gap-1.5 text-[13px] text-ink-soft">
                  <Stethoscope className="size-3.5" strokeWidth={1.7} />
                  {title}
                </div>
              </div>
            </div>

            {specialties.length > 0 && (
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
            )}

            <div className="mt-6">
              <a
                href="mailto:care@mova.health"
                className="inline-flex items-center justify-center gap-2 rounded-pill border border-line px-4 py-2.5 text-sm text-ink transition-colors hover:bg-paper-soft"
              >
                <Mail className="size-4" strokeWidth={1.7} /> Email support
              </a>
            </div>
          </section>
        </div>

        {/* right column: messenger */}
        <CareMessenger />
      </div>
    </div>
  );
}
