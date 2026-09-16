// Decisions the exercise library (/exercises) makes from the static catalog. Pure and free of React, next and the
// catalog's runtime values, so the node tests pin them; the page and its client parts only wire them up.
//
// - Groups follow the phase order the catalog hands in. An empty phase gets no heading.
// - Wording is chosen by locale key. Nothing here writes copy, and nothing turns a missing field into a value.
// - Only Heel Slide runs on the sensors path (docs/heel-slide-path.md), so it is the only exercise that can offer
//   «Начать», and only with the patient's own active prescription. A failed read is kept apart from "not
//   prescribed": telling a patient an exercise is not prescribed when the read failed would be untrue.

import type { ExerciseEntry, ExercisePhase, Localized, Quantifiability } from "@/lib/exercises/catalog";
import type { SensorRole } from "@/lib/sensors/types";

/** exercises.slug of the one exercise that starts from the app (the same value as _flow/load HEEL_SLIDE_SLUG). */
export const STARTABLE_SLUG = "heel-slide";

/** The route the library lives on. The detail opens on it too, as ?exercise=<slug>. */
export const LIBRARY_PATH = "/exercises";
export const EXERCISE_PARAM = "exercise";

export interface PhaseGroup<T> {
  phase: ExercisePhase | null;
  entries: T[];
}

/**
 * Entries grouped by phase, groups in `order`, entries in catalog order within a group. A phase with no entries
 * has no group. A phase missing from `order` is not dropped: its group follows the ordered ones, first seen first.
 */
export function groupByPhase<T extends { phase: ExercisePhase | null }>(
  entries: readonly T[],
  order: readonly (ExercisePhase | null)[],
): PhaseGroup<T>[] {
  const byPhase = new Map<ExercisePhase | null, T[]>();
  for (const entry of entries) {
    const list = byPhase.get(entry.phase);
    if (list) list.push(entry);
    else byPhase.set(entry.phase, [entry]);
  }
  const groups: PhaseGroup<T>[] = [];
  for (const phase of order) {
    const list = byPhase.get(phase);
    if (list) {
      groups.push({ phase, entries: list });
      byPhase.delete(phase);
    }
  }
  for (const [phase, list] of byPhase) groups.push({ phase, entries: list });
  return groups;
}

const PHASE_SEGMENT: Record<ExercisePhase, string> = { A: "a", "A-B": "ab", "B-C": "bc", C: "c", "A-C": "ac" };

/** A phase as a key and id segment: "A-B" → "ab"; no phase → "none". */
export function phaseSegment(phase: ExercisePhase | null): string {
  return phase ? (PHASE_SEGMENT[phase] ?? "none") : "none";
}

/** Group heading in plain words, from the НТЗ §9.1 phase table: «Этап A: выписка – ~3 недели». */
export function phaseHeadingKey(phase: ExercisePhase | null): string {
  return `exerciseLibrary.phase.${phaseSegment(phase)}`;
}

/** The short phase label a card and the detail carry: «Этапы A–B». */
export function phaseShortKey(phase: ExercisePhase | null): string {
  return `exerciseLibrary.phaseShort.${phaseSegment(phase)}`;
}

const QUANTIFIABILITY_SEGMENT: Record<Quantifiability, string> = {
  FULL: "full",
  PARTIAL: "partial",
  "FULL/PARTIAL": "fullOrPartial",
  COMPLETION_ONLY: "completionOnly",
};

/** The quantifiability class in plain words («Техника оценивается»), or null when no source states it. */
export function quantifiabilityKey(value: Quantifiability | null): string | null {
  if (value == null) return null;
  const segment = QUANTIFIABILITY_SEGMENT[value];
  return segment ? `exerciseLibrary.quantifiability.${segment}` : null;
}

/** Locale keys for the sensor roles, reusing the shell's sensors.role.* labels. */
export function sensorRoleKeys(roles: readonly SensorRole[]): string[] {
  return roles.map((role) => `sensors.role.${role}`);
}

/** /exercises?exercise=<slug> */
export function exerciseHref(slug: string): string {
  return `${LIBRARY_PATH}?${EXERCISE_PARAM}=${encodeURIComponent(slug)}`;
}

/**
 * The slug the ?exercise= parameter names, or null. A repeated parameter takes the first value; an unknown or
 * blank one is null, so a stale link simply shows the library.
 */
export function selectedSlug(
  raw: string | readonly string[] | null | undefined,
  isKnown: (slug: string) => boolean,
): string | null {
  const value = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (typeof value !== "string") return null;
  const slug = value.trim();
  return slug && isKnown(slug) ? slug : null;
}

/** The signed-in patient's Heel Slide prescription, as the server read it. */
export type HeelSlidePrescription = { status: "ok"; prescriptionId: string } | { status: "none" } | { status: "error" };

/**
 * What an exercise offers in place of a start control:
 *  - start: Heel Slide with an active prescription, linking into the exercise flow;
 *  - notPrescribed: every other exercise, and Heel Slide without a prescription — plain text, never a disabled button;
 *  - unknown: Heel Slide when the prescription read failed.
 */
export type StartAction = { kind: "start"; href: string } | { kind: "notPrescribed" } | { kind: "unknown" };

export function startActionFor(slug: string, heelSlide: HeelSlidePrescription): StartAction {
  if (slug !== STARTABLE_SLUG) return { kind: "notPrescribed" };
  if (heelSlide.status === "error") return { kind: "unknown" };
  if (heelSlide.status === "ok" && heelSlide.prescriptionId) {
    return { kind: "start", href: `/app/session/new/${encodeURIComponent(heelSlide.prescriptionId)}` };
  }
  return { kind: "notPrescribed" };
}

type PrescriptionLike = { id: string; exercise: { slug: string | null } | { slug: string | null }[] | null };

/**
 * The prescription the library starts Heel Slide with: the first active Heel Slide row in the order they were read
 * (created_at ascending, as Today lists them). Rows arrive already filtered to the patient, program and status.
 */
export function heelSlidePrescriptionId(rows: readonly PrescriptionLike[]): string | null {
  for (const row of rows) {
    const exercise = Array.isArray(row.exercise) ? (row.exercise[0] ?? null) : row.exercise;
    if (exercise?.slug === STARTABLE_SLUG && row.id) return row.id;
  }
  return null;
}

/**
 * A localized field's text in the locale, falling back to Russian like the dictionaries do (src/locales/index.ts),
 * or null when both are absent or blank. A section with no text is omitted.
 */
export function textIn(value: Localized | null | undefined, locale: keyof Localized): string | null {
  const text = value?.[locale]?.trim() || value?.ru?.trim();
  return text ? text : null;
}

/** The non-blank texts of a list of localized lines (cues, common errors), in order. */
export function linesIn(values: readonly Localized[] | null | undefined, locale: keyof Localized): string[] {
  return (values ?? []).map((value) => textIn(value, locale)).filter((text): text is string => text != null);
}
