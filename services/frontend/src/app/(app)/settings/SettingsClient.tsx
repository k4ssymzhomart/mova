"use client";

// SettingsClient: the patient's account page, in three sections.
//  · Profile        First and last name (saved to profiles.full_name / display_name), a read-only email, and
//                   the interface language. The select starts from the ACTIVE locale, which lives in the
//                   per-browser mova.locale cookie. Saving still writes profiles.locale, but nothing reads it
//                   back, so the copy says the language is remembered on this device. Name columns are written
//                   only when the name fields were edited, so a language-only save cannot rewrite the name.
//  · Operated knee  Read-only. Shows the side from getPatientContext. Until the clinical schema (#20) adds a
//                   clinic-written operated-knee field the side is always unknown: patients.affected_side was
//                   entered by patients in the earlier stroke app and is not the operated knee. The copy never
//                   says the clinic has recorded a value.
//  · Your data      Export everything we hold for this patient, and a plain statement of who can see it.
//                   clinic_caseload() and clinic_patient_overview() (0022) are SECURITY DEFINER and return every
//                   patient in the caller's clinic with no role or care_team_links check, alongside
//                   can_access_patient (0011); self-serve patients all share the "Mova Personal" clinic (0017).
//                   A patient cannot change any of that from the app, so there is no link count and no revoke.

import {
  Check,
  CircleAlert,
  ClipboardCheck,
  Download,
  Loader2,
  Lock,
  type LucideIcon,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";

import PageHeader from "@/components/app/PageHeader";
import {
  bodyText,
  card,
  cardTitle,
  focusRing,
  primaryButton,
  secondaryButton,
  sectionTitle,
} from "@/components/app/recipes";
import type { SideContext } from "@/lib/patient/context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { LOCALES, type Locale } from "@/locales";
import { useLocale, useTranslation } from "@/locales/client";

type SaveState = "idle" | "saving" | "saved" | "error";
type NameParts = { first: string; last: string };

/**
 * Splits the stored name into the two fields so that `${first} ${last}` is the stored full_name again.
 * display_name is the first name (0020); when full_name begins with it, it is kept whole, so a compound given
 * name stays in the first field. Otherwise the first word of full_name is the first name.
 */
function seedName(fullName: string, displayName: string): NameParts {
  const full = fullName.trim().replace(/\s+/g, " ");
  const given = displayName.trim().replace(/\s+/g, " ");
  if (!full) return { first: given, last: "" };
  if (given && (full === given || full.startsWith(`${given} `))) {
    return { first: given, last: full.slice(given.length).trim() };
  }
  const [first = "", ...rest] = full.split(" ");
  return { first, last: rest.join(" ") };
}

export default function SettingsClient({
  userId,
  patientId,
  email,
  profileLoaded,
  fullName,
  displayName,
  side,
}: {
  userId: string;
  patientId: string | null;
  email: string;
  profileLoaded: boolean;
  fullName: string;
  displayName: string;
  side: SideContext;
}) {
  const { t, locale } = useTranslation();
  const { setLocale } = useLocale();
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const firstId = useId();
  const lastId = useId();
  const emailId = useId();
  const emailHintId = useId();
  const langId = useId();

  // ---- Profile -------------------------------------------------------------
  // `stored` is what the account holds now; the fields are compared with it to tell whether the name changed.
  const [stored, setStored] = useState<NameParts>(() => seedName(fullName, displayName));
  const [first, setFirst] = useState(stored.first);
  const [last, setLast] = useState(stored.last);
  const [lang, setLang] = useState<Locale>(locale);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // The sidebar language switch changes the locale too; keep the select in step with it.
  useEffect(() => {
    setLang(locale);
  }, [locale]);

  // "Saved" stays on screen until the next edit, so it cannot vanish before it is read.
  function edited() {
    if (saveState === "saved" || saveState === "error") setSaveState("idle");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileLoaded) return;
    setSaveState("saving");
    const given = first.trim();
    const family = last.trim();
    const firstChanged = given !== stored.first;
    const lastChanged = family !== stored.last;

    const update: { locale: Locale; full_name?: string | null; display_name?: string | null } = { locale: lang };
    if (firstChanged || lastChanged) {
      const full = `${given} ${family}`.trim();
      update.full_name = full || null;
      // display_name is the first name used in greetings; leave it alone when only the last name changed.
      if (firstChanged) update.display_name = given || full || null;
    }

    try {
      const { data, error } = await supabase.from("profiles").update(update).eq("id", userId).select("id");
      if (error || !data || data.length === 0) {
        setSaveState("error");
        return;
      }
    } catch {
      setSaveState("error");
      return;
    }
    setStored({ first: given, last: family });
    setSaveState("saved");
    // setLocale refreshes Server Components itself; otherwise refresh so the shell shows the new name.
    if (lang !== locale) setLocale(lang);
    else router.refresh();
  }

  // ---- Data export ---------------------------------------------------------
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  async function exportData() {
    setExporting(true);
    setExportFailed(false);
    try {
      const profileRes = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      // Without a patient record there are no sessions to include.
      const sessionsRes = patientId
        ? await supabase
            .from("sessions")
            .select("*, session_metrics(*)")
            .eq("patient_id", patientId)
            .order("started_at", { ascending: false })
        : { data: [], error: null };
      if (profileRes.error || sessionsRes.error) {
        setExportFailed(true);
        return;
      }
      const bundle = {
        exported_at: new Date().toISOString(),
        account: { id: userId, email },
        profile: profileRes.data,
        sessions: sessionsRes.data,
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mova-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  }

  const inputCls = cn(
    "block min-h-12 w-full rounded-lg border border-ink-faint bg-card px-4 text-base text-ink transition-colors",
    focusRing,
  );

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t("settings.eyebrow")} title={t("settings.title")} lead={t("settings.lead")} />

      {/* PROFILE */}
      <Section icon={UserRound} title={t("settings.profile.title")} lead={t("settings.profile.lead")}>
        {!profileLoaded && (
          <Message tone="error" role="alert" className="mb-5">
            {t("settings.profile.loadError")}
          </Message>
        )}
        <form onSubmit={saveProfile} noValidate>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id={firstId} label={t("settings.profile.firstName")}>
              <input
                id={firstId}
                className={inputCls}
                value={first}
                autoComplete="given-name"
                onChange={(e) => {
                  setFirst(e.target.value);
                  edited();
                }}
              />
            </Field>
            <Field id={lastId} label={t("settings.profile.lastName")}>
              <input
                id={lastId}
                className={inputCls}
                value={last}
                autoComplete="family-name"
                onChange={(e) => {
                  setLast(e.target.value);
                  edited();
                }}
              />
            </Field>
            <Field id={emailId} label={t("settings.profile.email")} hint={t("settings.profile.emailHint")} hintId={emailHintId}>
              <input
                id={emailId}
                type="email"
                readOnly
                value={email}
                aria-describedby={emailHintId}
                className={cn(inputCls, "bg-paper-soft")}
              />
            </Field>
            <Field id={langId} label={t("settings.profile.language")}>
              <select
                id={langId}
                className={inputCls}
                value={lang}
                onChange={(e) => {
                  setLang(e.target.value as Locale);
                  edited();
                }}
              >
                {LOCALES.map((code) => (
                  <option key={code} value={code} lang={code}>
                    {t(`language.${code}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button type="submit" disabled={!profileLoaded || saveState === "saving"} className={primaryButton}>
              {saveState === "saving" && <Loader2 className="size-5 animate-spin" strokeWidth={2} aria-hidden="true" />}
              {saveState === "saving" ? t("settings.profile.saving") : t("settings.profile.save")}
            </button>
            <div role="status" aria-live="polite">
              {saveState === "saved" && <Message tone="done">{t("settings.profile.saved")}</Message>}
            </div>
            {saveState === "error" && (
              <Message tone="error" role="alert">
                {t("settings.profile.saveError")}
              </Message>
            )}
          </div>
        </form>
      </Section>

      {/* OPERATED KNEE (read-only) */}
      <Section
        icon={ClipboardCheck}
        title={t("side.label")}
        lead={side.status === "known" ? undefined : t("settings.side.lead")}
      >
        {side.status === "known" ? (
          <p className="inline-flex items-center rounded-pill border-2 border-ink px-4 py-2 text-lg font-semibold text-ink">
            {t(side.side === "left" ? "side.left" : "side.right")}
          </p>
        ) : (
          <p className="inline-flex items-center gap-2 rounded-pill border border-dashed border-ink/40 px-4 py-2 text-base text-ink">
            <TriangleAlert className="size-5 shrink-0 text-amber-700" strokeWidth={2} aria-hidden="true" />
            {t("side.unknown")}
          </p>
        )}
        <p className={cn("mt-5 flex items-start gap-2", bodyText)}>
          <Lock className="mt-1 size-4 shrink-0 text-ink-soft" strokeWidth={2} aria-hidden="true" />
          <span>{t("settings.side.readOnly")}</span>
        </p>
        {side.status === "known" && <p className={cn("mt-1 pl-6", bodyText)}>{t("settings.side.wrongHint")}</p>}
      </Section>

      {/* DATA & PRIVACY */}
      <Section icon={ShieldCheck} title={t("settings.privacy.title")} lead={t("settings.privacy.lead")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col rounded-card border border-line p-5">
            <h3 className={cardTitle}>{t("settings.privacy.export.title")}</h3>
            <p className={cn("mt-2", bodyText)}>{t("settings.privacy.export.body")}</p>
            <div className="mt-auto pt-5">
              <button type="button" onClick={exportData} disabled={exporting} className={secondaryButton}>
                {exporting ? (
                  <Loader2 className="size-5 animate-spin" strokeWidth={2} aria-hidden="true" />
                ) : (
                  <Download className="size-5" strokeWidth={1.9} aria-hidden="true" />
                )}
                {exporting ? t("settings.privacy.export.preparing") : t("settings.privacy.export.button")}
              </button>
              {exportFailed && (
                <Message tone="error" role="alert" className="mt-3">
                  {t("settings.privacy.export.error")}
                </Message>
              )}
            </div>
          </div>

          <div className="flex flex-col rounded-card border border-line p-5">
            <h3 className={cardTitle}>{t("settings.privacy.access.title")}</h3>
            <p className={cn("mt-2", bodyText)}>{t("settings.privacy.access.body")}</p>
            <p className={cn("mt-3 flex items-start gap-2", bodyText)}>
              <Lock className="mt-1 size-4 shrink-0 text-ink-soft" strokeWidth={2} aria-hidden="true" />
              <span>{t("settings.privacy.access.contact")}</span>
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  lead,
  children,
}: {
  icon: LucideIcon;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cn(card, "p-5 sm:p-8")}>
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-paper-soft text-ink-soft ring-1 ring-line">
          <Icon className="size-5" strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className={sectionTitle}>
            {title}
          </h2>
          {lead && <p className={cn("mt-1", bodyText)}>{lead}</p>}
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  hintId,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  hintId?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-base font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && (
        <p id={hintId} className="mt-2 text-sm text-ink-soft">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A status line: icon plus words, so colour is never the only signal. Text stays ink for contrast. */
function Message({
  tone,
  role,
  className,
  children,
}: {
  tone: "done" | "error";
  role?: "alert";
  className?: string;
  children: ReactNode;
}) {
  const Icon = tone === "done" ? Check : CircleAlert;
  return (
    <p role={role} className={cn("flex items-start gap-2 text-base font-medium text-ink", className)}>
      <Icon
        className={cn("mt-0.5 size-5 shrink-0", tone === "done" ? "text-signal-deep" : "text-red-700")}
        strokeWidth={2}
        aria-hidden="true"
      />
      <span>{children}</span>
    </p>
  );
}
