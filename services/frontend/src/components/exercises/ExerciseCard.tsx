// One exercise in the library. Server-rendered; the media and the detail link are the only client parts.
//  - The media block plays the catalog's clip when one is confirmed. Without one it is a plain labelled frame
//    saying the video is coming: no spinner, no empty <video>, and never another exercise's clip.
//  - Phase, name, sensors, the target where the catalog has one, and the quantifiability class in plain words. A
//    field the catalog leaves empty has no row. The target is what the exercise aims for, never a measured value.
//  - The start slot is StartControl: «Начать» only for Heel Slide with the patient's own prescription.

import { ChevronRight, Clapperboard } from "lucide-react";
import type { ReactNode } from "react";

import { card, cardTitle, secondaryButton, tileLabel } from "@/components/app/recipes";
import type { ExerciseEntry } from "@/lib/exercises/catalog";
import { cn } from "@/lib/utils";
import type { Locale } from "@/locales";

import ExerciseCardMedia from "./ExerciseCardMedia";
import ExerciseDetailLink from "./ExerciseDetailLink";
import {
  type HeelSlidePrescription,
  phaseShortKey,
  quantifiabilityKey,
  sensorRoleKeys,
  startActionFor,
  textIn,
} from "./library";
import SensorChips from "./SensorChips";
import StartControl from "./StartControl";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export default function ExerciseCard({
  entry,
  heelSlide,
  t,
  locale,
}: {
  entry: ExerciseEntry;
  heelSlide: HeelSlidePrescription;
  t: Translate;
  locale: Locale;
}) {
  const name = textIn(entry.name, locale) ?? "";
  const target = textIn(entry.target, locale);
  const quantKey = quantifiabilityKey(entry.quantifiability);
  const sensorLabels = sensorRoleKeys(entry.sensors).map((key) => t(key));
  const titleId = `exercise-${entry.slug}-title`;
  const detailId = `exercise-${entry.slug}-detail`;

  return (
    <article aria-labelledby={titleId} className={cn(card, "flex h-full flex-col overflow-hidden")}>
      {entry.video ? (
        <ExerciseCardMedia video={entry.video} poster={entry.poster} name={name} />
      ) : (
        <div className="grid h-72 w-full place-items-center border-b border-line bg-paper-soft sm:h-80">
          <p className="flex items-center gap-2 text-base font-medium text-ink-soft">
            <Clapperboard className="size-5 text-ink-faint" strokeWidth={1.8} aria-hidden="true" />
            {t("exerciseLibrary.media.comingSoon")}
          </p>
        </div>
      )}

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <p className={tileLabel}>{t(phaseShortKey(entry.phase))}</p>
        <h3 id={titleId} className={cn("mt-1 [overflow-wrap:anywhere]", cardTitle)}>
          {name}
        </h3>

        <dl className="mt-4 space-y-3">
          {sensorLabels.length > 0 && (
            <Row label={t("exerciseLibrary.field.sensors")}>
              <SensorChips labels={sensorLabels} />
            </Row>
          )}
          {target && <Row label={t("exerciseLibrary.field.target")}>{target}</Row>}
          {quantKey && <Row label={t("exerciseLibrary.field.quantifiability")}>{t(quantKey)}</Row>}
        </dl>

        <div className="mt-auto flex flex-col gap-3 pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <ExerciseDetailLink
            slug={entry.slug}
            id={detailId}
            labelledBy={`${detailId} ${titleId}`}
            className={cn(secondaryButton, "w-full sm:w-auto")}
          >
            {t("exerciseLibrary.details")}
            <ChevronRight className="size-5" strokeWidth={2} aria-hidden="true" />
          </ExerciseDetailLink>
          <StartControl
            action={startActionFor(entry.slug, heelSlide)}
            id={`exercise-${entry.slug}-start`}
            titleId={titleId}
            labels={{
              start: t("exerciseLibrary.start"),
              notPrescribed: t("exerciseLibrary.notPrescribed"),
              unknown: t("exerciseLibrary.prescriptionUnknown"),
            }}
          />
        </div>
      </div>
    </article>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className={tileLabel}>{label}</dt>
      <dd className="mt-1 text-base font-medium leading-snug text-ink">{children}</dd>
    </div>
  );
}
