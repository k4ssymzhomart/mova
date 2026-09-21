// Exercise library (/exercises). The static catalog (lib/exercises/catalog.ts), grouped by НТЗ §9.1 phase, with each
// exercise's detail opening on this route as ?exercise=<slug>.
//
// - Reference, not a plan: the phase windows are guides, and what a patient does is what the clinic prescribed. Only
//   Heel Slide runs with sensors in this build, so it is the only exercise that can offer «Начать», and only when
//   the signed-in patient has an active Heel Slide prescription. Everything else reads «Не назначено».
// - The one database access is that prescription read (load.ts). It is read only: unlike Today, this page does not
//   provision a patients row. A failed read says it could not check, never «Не назначено».
// - Nothing here is a score and nothing is measured: targets are what an exercise aims for.
// - Videos are the clinician's own recordings (public/exercises), on the exercises they are confirmed to show, with the
//   one-minute overview at the top. The rest say the video is coming.
// - Not linked from the navigation (components/layout/nav.ts); the address is reachable directly.

import type { Metadata } from "next";
import { Suspense } from "react";

import PageHeader from "@/components/app/PageHeader";
import { sectionTitle } from "@/components/app/recipes";
import ExerciseCard from "@/components/exercises/ExerciseCard";
import ExerciseDetailDialog from "@/components/exercises/ExerciseDetailDialog";
import LibraryOverviewVideo from "@/components/exercises/LibraryOverviewVideo";
import { groupByPhase, phaseHeadingKey, phaseSegment } from "@/components/exercises/library";
import { EXERCISE_CATALOG, PHASE_ORDER } from "@/lib/exercises/catalog";
import { getTranslation } from "@/locales/server";

import { loadHeelSlidePrescription } from "./load";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("exerciseLibrary.metaTitle")} · Mova` };
}

export default async function ExerciseLibraryPage() {
  const { t, locale } = getTranslation();
  const heelSlide = await loadHeelSlidePrescription();
  const groups = groupByPhase(EXERCISE_CATALOG, PHASE_ORDER);

  return (
    <>
      <div className="space-y-10">
        <PageHeader
          eyebrow={t("exerciseLibrary.eyebrow")}
          title={t("exerciseLibrary.title")}
          lead={t("exerciseLibrary.lead")}
        />

        <LibraryOverviewVideo t={t} />

        {groups.map((group) => {
          const headingId = `exercise-phase-${phaseSegment(group.phase)}`;
          return (
            <section key={headingId} aria-labelledby={headingId} className="space-y-4">
              <h2 id={headingId} className={sectionTitle}>
                {t(phaseHeadingKey(group.phase))}
              </h2>
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.entries.map((entry) => (
                  <li key={entry.slug}>
                    <ExerciseCard entry={entry} heelSlide={heelSlide} t={t} locale={locale} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Outside the spaced column, so no sibling margin reaches the dialog. It reads ?exercise= on the client; the
          boundary keeps useSearchParams from opting the rest of the page out of server rendering. */}
      <Suspense fallback={null}>
        <ExerciseDetailDialog heelSlide={heelSlide} />
      </Suspense>
    </>
  );
}
