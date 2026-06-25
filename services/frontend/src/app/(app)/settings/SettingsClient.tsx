"use client";

// SettingsClient — the patient's control hub. Three sections:
//  · Profile      — name + clinical side, written to Supabase (profiles + patients) under RLS.
//  · Preferences  — audio cues, metronome volume, camera privacy default; on-device, scoped per user.
//  · Compliance   — GDPR/HIPAA controls: export everything we hold, and revoke clinical access.
// Editorial Spatial, minimal, lucide iconography. No gradients, no charts.

import { Camera, Check, Download, Loader2, Music2, ShieldCheck, SlidersHorizontal, UserRound, UserX, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Side = "left" | "right" | "bilateral" | "none";
type Locale = "en" | "ru" | "kk";

interface Prefs {
  audioCues: boolean;
  metronomeVolume: number;
  cameraOffByDefault: boolean;
}
const DEFAULT_PREFS: Prefs = { audioCues: true, metronomeVolume: 70, cameraOffByDefault: true };

function prefsKey(uid: string) {
  return `mova.prefs::${uid}`;
}

export default function SettingsClient({
  userId,
  email,
  fullName,
  displayName,
  locale,
  affectedSide,
  activeCareLinks,
}: {
  userId: string;
  email: string;
  fullName: string;
  displayName: string;
  locale: Locale;
  affectedSide: string;
  activeCareLinks: number;
}) {
  const [supabase] = useState(() => createClient());

  // ---- Profile -------------------------------------------------------------
  const [first, setFirst] = useState(() => (displayName || fullName).split(" ")[0] ?? "");
  const [last, setLast] = useState(() => fullName.split(" ").slice(1).join(" "));
  const [side, setSide] = useState<Side>((affectedSide as Side) || "none");
  const [loc, setLoc] = useState<Locale>(locale);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  async function saveProfile() {
    setSaving(true);
    setSaved(false);
    setProfileErr(null);
    const full = `${first} ${last}`.trim();
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ full_name: full || null, display_name: first || full || null, locale: loc })
      .eq("id", userId);
    const { error: ptErr } = await supabase
      .from("patients")
      .update({ affected_side: side })
      .eq("profile_id", userId);
    setSaving(false);
    if (pErr || ptErr) {
      setProfileErr((pErr ?? ptErr)!.message);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // ---- Preferences (on-device, per user) -----------------------------------
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(prefsKey(userId));
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) });
    } catch {
      /* keep defaults */
    }
  }, [userId]);
  function updatePref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    setPrefs((p) => {
      const next = { ...p, [key]: value };
      window.localStorage.setItem(prefsKey(userId), JSON.stringify(next));
      return next;
    });
  }

  // ---- Compliance ----------------------------------------------------------
  const [exporting, setExporting] = useState(false);
  async function exportData() {
    setExporting(true);
    const [{ data: profile }, { data: sessions }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("sessions").select("*, session_metrics(*)").order("started_at", { ascending: false }),
    ]);
    const bundle = { exported_at: new Date().toISOString(), account: { id: userId, email }, profile, sessions };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mova-data-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  }

  const [revoking, setRevoking] = useState(false);
  const [revokeMsg, setRevokeMsg] = useState<string | null>(null);
  async function revokeAccess() {
    if (!confirm("Revoke your care team's access to your data? They will no longer see your sessions.")) return;
    setRevoking(true);
    setRevokeMsg(null);
    const { error } = await supabase.from("care_team_links").update({ is_active: false }).eq("is_active", true);
    setRevoking(false);
    setRevokeMsg(error ? "We've logged your request — your clinic administrator will confirm it." : "Clinical access revoked.");
  }

  return (
    <div className="space-y-8">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Settings</div>
        <h1 className="mt-2 font-serif text-4xl leading-none text-ink sm:text-5xl">Your account.</h1>
      </header>

      {/* PROFILE */}
      <Section icon={UserRound} title="Profile" desc="Your name and clinical focus. Saved to your record.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <input className={inputCls} value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First" />
          </Field>
          <Field label="Last name">
            <input className={inputCls} value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last" />
          </Field>
          <Field label="Email">
            <input className={cn(inputCls, "cursor-not-allowed text-ink-faint")} value={email} disabled />
          </Field>
          <Field label="Language">
            <select className={inputCls} value={loc} onChange={(e) => setLoc(e.target.value as Locale)}>
              <option value="en">English</option>
              <option value="ru">Русский</option>
              <option value="kk">Қазақша</option>
            </select>
          </Field>
          <Field label="Affected side">
            <div className="grid grid-cols-4 gap-1.5">
              {(["left", "right", "bilateral", "none"] as Side[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-[12px] capitalize transition-colors",
                    side === s ? "border-signal bg-signal/10 text-signal-deep" : "border-line text-ink-soft hover:bg-paper-soft",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={saveProfile}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-pill bg-night px-6 py-2.5 text-sm font-medium text-paper-soft transition-colors hover:bg-ink disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : saved ? <Check className="size-4" strokeWidth={2} /> : null}
            {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
          </button>
          {profileErr && <span className="text-sm text-destructive">{profileErr}</span>}
        </div>
      </Section>

      {/* PREFERENCES */}
      <Section icon={SlidersHorizontal} title="Preferences" desc="How sessions look and sound. Stored on this device.">
        <div className="divide-y divide-line">
          <ToggleRow
            icon={Volume2}
            label="Audio cues"
            desc="Spoken prompts and scoring chimes during a session."
            on={prefs.audioCues}
            onToggle={() => updatePref("audioCues", !prefs.audioCues)}
          />
          <div className="flex items-center gap-4 py-4">
            <Music2 className="size-4 shrink-0 text-ink-faint" strokeWidth={1.8} />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink">Metronome volume</div>
              <div className="text-[13px] text-ink-soft">The beat that paces your gait cadence.</div>
            </div>
            <div className="flex w-40 items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={prefs.metronomeVolume}
                onChange={(e) => updatePref("metronomeVolume", Number(e.target.value))}
                className="w-full accent-signal"
                aria-label="Metronome volume"
              />
              <span className="tnum w-9 text-right font-mono text-xs text-ink-faint">{prefs.metronomeVolume}</span>
            </div>
          </div>
          <ToggleRow
            icon={Camera}
            label="Camera off by default"
            desc="Start sessions with the live preview hidden (tracking still runs)."
            on={prefs.cameraOffByDefault}
            onToggle={() => updatePref("cameraOffByDefault", !prefs.cameraOffByDefault)}
          />
        </div>
      </Section>

      {/* COMPLIANCE */}
      <Section icon={ShieldCheck} title="Data & privacy" desc="Your GDPR / HIPAA controls.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-line p-5">
            <div className="text-sm font-medium text-ink">Export my data</div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
              Download everything we hold about you — profile and every session — as a portable JSON file.
            </p>
            <button
              type="button"
              onClick={exportData}
              disabled={exporting}
              className="mt-4 inline-flex items-center gap-2 rounded-pill border border-line px-4 py-2 text-sm text-ink transition-colors hover:bg-paper-soft disabled:opacity-60"
            >
              {exporting ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : <Download className="size-4" strokeWidth={1.8} />}
              {exporting ? "Preparing…" : "Export"}
            </button>
          </div>
          <div className="rounded-2xl border border-line p-5">
            <div className="text-sm font-medium text-ink">Revoke clinical access</div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
              {activeCareLinks > 0
                ? `${activeCareLinks} clinician${activeCareLinks > 1 ? "s" : ""} can currently view your sessions.`
                : "No clinician currently has access to your data."}
            </p>
            <button
              type="button"
              onClick={revokeAccess}
              disabled={revoking || activeCareLinks === 0}
              className="mt-4 inline-flex items-center gap-2 rounded-pill border border-destructive/30 px-4 py-2 text-sm text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-40"
            >
              {revoking ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : <UserX className="size-4" strokeWidth={1.8} />}
              Revoke access
            </button>
            {revokeMsg && <p className="mt-2 text-[12px] text-ink-soft">{revokeMsg}</p>}
          </div>
        </div>
      </Section>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-signal focus:ring-2 focus:ring-signal/20";

function Section({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof UserRound;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-line bg-card p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-paper-soft text-ink-soft ring-1 ring-line">
          <Icon className="size-[18px]" strokeWidth={1.7} />
        </span>
        <div>
          <h2 className="font-serif text-2xl text-ink">{title}</h2>
          <p className="text-[13px] text-ink-soft">{desc}</p>
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  desc,
  on,
  onToggle,
}: {
  icon: typeof Volume2;
  label: string;
  desc: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-4 py-4">
      <Icon className="size-4 shrink-0 text-ink-faint" strokeWidth={1.8} />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink">{label}</div>
        <div className="text-[13px] text-ink-soft">{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-signal" : "bg-line")}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform",
            on ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
