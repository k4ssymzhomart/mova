// Care team («Специалисты»): the specialists linked to this patient in the app, read from active
// care_team_links. Name, title and specialties are shown verbatim; only the relationship is translated.
//
// - No call or email buttons: nothing in the schema holds a verified contact for a clinician, so any number or
//   address here would be invented.
// - In-app messaging does not exist, so the page says so instead of offering a box that reaches nobody.
// - Today's RLS lets a patient read their own links but not `clinicians` or clinician `profiles`, so the
//   embedded details often come back empty. A link still means a specialist is assigned: the card says the
//   details are unavailable and never fills in a name. TODO(#20): patient-visible clinician details.
// - A failed query shows an error, never the "no specialist assigned" state.

import type { Metadata } from "next";
import { CircleAlert, MessageSquareOff, UserRound, Users } from "lucide-react";

import EmptyState from "@/components/app/EmptyState";
import PageHeader from "@/components/app/PageHeader";
import { bodyText, card, cardTitle, tileLabel } from "@/components/app/recipes";
import { createClient } from "@/lib/supabase/server";
import { getTranslation } from "@/locales/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("careTeam.metaTitle")} · Mova` };
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** public.care_relationship (0002_schemas_and_enums.sql), in display order. */
const RELATIONSHIPS = ["primary", "secondary", "consulting"] as const;
type Relationship = (typeof RELATIONSHIPS)[number];

type OneOrMany<T> = T | T[] | null;
function one<T>(v: OneOrMany<T>): T | null {
  return (Array.isArray(v) ? (v[0] ?? null) : v) ?? null;
}

interface LinkRow {
  id: string;
  relationship: string | null;
  clinician: OneOrMany<{
    title: string | null;
    specialties: string[] | null;
    profile: OneOrMany<{ full_name: string | null; display_name: string | null }>;
  }>;
}

interface CareLink {
  id: string;
  relationship: Relationship | null;
  name: string | null;
  title: string | null;
  specialties: string[];
  /** False when the clinician row could not be read (RLS), as opposed to a row with empty fields. */
  detailsReadable: boolean;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toCareLink(row: LinkRow): CareLink {
  const clinician = one(row.clinician);
  const profile = clinician ? one(clinician.profile) : null;
  const relationship = RELATIONSHIPS.find((r) => r === row.relationship) ?? null;
  return {
    id: row.id,
    relationship,
    name: text(profile?.full_name) ?? text(profile?.display_name),
    title: text(clinician?.title),
    specialties: (clinician?.specialties ?? []).map((s) => text(s)).filter((s): s is string => s !== null),
    detailsReadable: clinician !== null,
  };
}

function rank(link: CareLink): number {
  return link.relationship ? RELATIONSHIPS.indexOf(link.relationship) : RELATIONSHIPS.length;
}

export default async function CareTeamPage() {
  const supabase = createClient();
  const { t } = getTranslation();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // the layout redirects; this only guards the race

  // Scope explicitly to this patient rather than trusting RLS to do it (RLS is being reworked in #20).
  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();

  let failed = Boolean(patientError);
  let links: CareLink[] = [];

  if (patient) {
    const { data, error } = await supabase
      .from("care_team_links")
      .select(
        "id, relationship, clinician:clinicians(title, specialties, profile:profiles(full_name, display_name))",
      )
      .eq("patient_id", patient.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) failed = true;
    // Stable sort: primary first, then secondary, then consulting; oldest link first within each.
    else links = ((data ?? []) as LinkRow[]).map(toCareLink).sort((a, b) => rank(a) - rank(b));
  }

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t("nav.careTeam")} title={t("careTeam.title")} lead={t("careTeam.lead")} />

      {failed ? (
        <EmptyState icon={CircleAlert} title={t("careTeam.error.title")} body={t("careTeam.error.body")} />
      ) : links.length === 0 ? (
        <EmptyState icon={Users} title={t("careTeam.empty.title")} body={t("careTeam.empty.body")} />
      ) : (
        <ul aria-label={t("careTeam.listLabel")} className="grid gap-4 lg:grid-cols-2 lg:items-start">
          {links.map((link) => (
            <ClinicianCard key={link.id} link={link} t={t} />
          ))}
        </ul>
      )}

      {/* TODO: in-app messaging has no backend or approved wording yet; this card stays until it does. */}
      <section aria-labelledby="care-team-messaging" className={`${card} p-5 sm:p-6`}>
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-paper-soft text-ink-soft ring-1 ring-line">
            <MessageSquareOff className="size-5" strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="care-team-messaging" className={cardTitle}>
              {t("careTeam.messaging.title")}
            </h2>
            <p className={`mt-2 ${bodyText}`}>{t("careTeam.messaging.body")}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function ClinicianCard({ link, t }: { link: CareLink; t: Translate }) {
  return (
    <li className={`${card} p-5 sm:p-6`}>
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-paper-soft text-ink-soft ring-1 ring-line">
          <UserRound className="size-6" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={`${cardTitle} break-words`}>{link.name ?? t("careTeam.nameUnavailable")}</h2>

          <dl className="mt-3 space-y-3">
            {link.relationship && (
              <div>
                <dt className={tileLabel}>{t("careTeam.relationshipLabel")}</dt>
                <dd className="mt-0.5 text-base text-ink">{t(`careTeam.relationship.${link.relationship}`)}</dd>
              </div>
            )}
            {link.title && (
              <div>
                <dt className={tileLabel}>{t("careTeam.titleLabel")}</dt>
                <dd className="mt-0.5 break-words text-base text-ink">{link.title}</dd>
              </div>
            )}
            {link.specialties.length > 0 && (
              <div>
                <dt className={tileLabel}>{t("careTeam.specialtiesLabel")}</dt>
                <dd className="mt-1.5">
                  <ul className="flex flex-wrap gap-2">
                    {link.specialties.map((specialty, i) => (
                      <li
                        key={`${specialty}-${i}`}
                        className="rounded-pill border border-line bg-paper-soft px-3 py-1 text-sm text-ink"
                      >
                        {specialty}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>

          {!link.detailsReadable && <p className={`mt-3 ${bodyText}`}>{t("careTeam.detailsUnavailable")}</p>}
        </div>
      </div>
    </li>
  );
}
