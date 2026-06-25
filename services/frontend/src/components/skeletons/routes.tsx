// Per-route skeletons. Each mirrors the real page's structure (card shapes, counts, grid columns) so a
// navigation reads as "loading *this* page". Composed from the shared primitives; pure presentational.

import { Bar, Block, HeaderSkeleton, Page, TileRow } from "./primitives";

/** Today (/app): hero "next session" banner, stat tiles, recent-activity list. */
export function TodaySkeleton() {
  return (
    <Page>
      <HeaderSkeleton wide />
      <Block className="h-40" />
      <TileRow count={4} />
      <div className="space-y-3">
        <Bar className="h-6 w-44 rounded-xl" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Block key={i} className="h-16" />
          ))}
        </div>
      </div>
    </Page>
  );
}

/** Program: header, week strip, prescribed-exercise cards. */
export function ProgramSkeleton() {
  return (
    <Page>
      <HeaderSkeleton />
      <Block className="h-28" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Block key={i} className="h-32" />
        ))}
      </div>
    </Page>
  );
}

/** Exercises: header then two modality sections, each a card grid. */
export function ExercisesSkeleton() {
  return (
    <Page>
      <HeaderSkeleton wide />
      {Array.from({ length: 2 }).map((_, s) => (
        <div key={s} className="space-y-4">
          <Bar className="h-5 w-56 rounded-xl" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Block key={i} className="h-44" />
            ))}
          </div>
        </div>
      ))}
    </Page>
  );
}

/** Progress: header, big metric tiles, trend charts, session history. */
export function ProgressSkeleton() {
  return (
    <Page>
      <HeaderSkeleton wide />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Block key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Block className="h-48" />
        <Block className="h-48" />
      </div>
      <div className="space-y-2">
        <Bar className="h-6 w-44 rounded-xl" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Block key={i} className="h-14" />
        ))}
      </div>
    </Page>
  );
}

/** Achievements: level banner + badge grid. */
export function AchievementsSkeleton() {
  return (
    <Page>
      <HeaderSkeleton />
      <Block className="h-36" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Block key={i} className="h-40" />
        ))}
      </div>
    </Page>
  );
}

/** Session studio: the camera stage + control aside. */
export function SessionSkeleton() {
  return (
    <Page>
      <div className="flex items-end justify-between gap-4">
        <HeaderSkeleton />
        <Bar className="h-5 w-20 rounded-xl" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Block className="aspect-video w-full" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Block key={i} className="h-20" />
            ))}
          </div>
        </div>
        <div className="space-y-5">
          <Block className="h-64" />
          <Block className="h-40" />
        </div>
      </div>
    </Page>
  );
}

/** Clinician caseload: rollup tiles + a two-column roster of patient cards + telemetry feed. */
export function ClinicCaseloadSkeleton() {
  return (
    <main className="mx-auto max-w-shell px-5 py-10 sm:px-8">
      <div className="animate-pulse space-y-8" aria-hidden="true">
        <HeaderSkeleton wide />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Block key={i} className="h-24" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Block key={i} className="h-44" />
          ))}
        </div>
        <Block className="h-56" />
      </div>
    </main>
  );
}

/** Clinician patient detail: back link, header, tiles, charts + alerts/prescription aside. */
export function ClinicPatientSkeleton() {
  return (
    <main className="mx-auto max-w-shell px-5 py-8 sm:px-8">
      <div className="animate-pulse space-y-6" aria-hidden="true">
        <Bar className="h-4 w-28" />
        <HeaderSkeleton />
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Block key={i} className="h-20" />
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Block className="h-40" />
              <Block className="h-40" />
            </div>
            <Block className="h-56" />
          </div>
          <div className="space-y-6">
            <Block className="h-44" />
            <Block className="h-72" />
          </div>
        </div>
      </div>
    </main>
  );
}
