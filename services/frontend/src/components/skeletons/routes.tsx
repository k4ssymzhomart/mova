// Per-route skeletons. Each mirrors the real page's structure (card shapes, counts, grid columns) so a
// navigation reads as "loading *this* page". Composed from the shared primitives; pure presentational.

import { Bar, Block, HeaderSkeleton, Page } from "./primitives";

/** Today (/app): greeting header, precautions card, the exercises heading with its lead, then one large card per prescribed exercise. */
export function TodaySkeleton() {
  return (
    <Page>
      <HeaderSkeleton />
      <Block className="h-36 sm:h-32" />
      <div className="space-y-4">
        <div className="space-y-3">
          <Bar className="h-7 w-56 rounded-xl" />
          <Bar className="h-4 w-full max-w-md" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Block key={i} className="h-40 sm:h-28" />
          ))}
        </div>
      </div>
    </Page>
  );
}

/** Plan (/program): header with lead, precautions card, program card, then the prescribed-exercise card grid. */
export function PlanSkeleton() {
  return (
    <Page>
      <div className="space-y-3">
        <HeaderSkeleton />
        <Bar className="h-4 w-full max-w-xl" />
      </div>
      <Block className="h-28" />
      <Block className="h-32" />
      <div className="space-y-4">
        <Bar className="h-7 w-64 rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Block key={i} className="h-48" />
          ))}
        </div>
      </div>
    </Page>
  );
}

/** Plan detail (/program/[prescriptionId]): back button, header, about card, prescription card, safety card, instructions card. */
export function PlanDetailSkeleton() {
  return (
    <Page>
      <Bar className="h-12 w-44" />
      <div className="space-y-3">
        <HeaderSkeleton />
        <Bar className="h-4 w-48" />
      </div>
      <Block className="h-32" />
      <Block className="h-72" />
      <Block className="h-28" />
      <Block className="h-48" />
    </Page>
  );
}

/** Progress: header with lead, two count tiles, the scores-not-available card, session history rows. */
export function ProgressSkeleton() {
  return (
    <Page>
      <div className="space-y-3">
        <HeaderSkeleton wide />
        <Bar className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Block key={i} className="h-28" />
        ))}
      </div>
      <Block className="h-36" />
      <div className="space-y-4">
        <Bar className="h-7 w-52 rounded-xl" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Block key={i} className="h-28" />
          ))}
        </div>
      </div>
    </Page>
  );
}

/** Progress session: back link, header, the five-row details card, the scores-not-available card. */
export function ProgressSessionSkeleton() {
  return (
    <Page>
      <div className="space-y-4">
        <Bar className="h-6 w-44" />
        <HeaderSkeleton />
      </div>
      <Block className="h-80" />
      <Block className="h-36" />
    </Page>
  );
}

/** Care team: header with lead, assigned-specialist cards (two-up on wide screens), the messaging notice. */
export function CareTeamSkeleton() {
  return (
    <Page>
      <div className="space-y-3">
        <HeaderSkeleton />
        <Bar className="h-5 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Block className="h-44" />
        <Block className="h-44" />
      </div>
      <Block className="h-28" />
    </Page>
  );
}

/** Settings: header with lead, profile form card, read-only operated-knee card, then the data section's two panels. */
export function SettingsSkeleton() {
  return (
    <Page>
      <div className="space-y-3">
        <HeaderSkeleton />
        <Bar className="h-4 w-full max-w-lg" />
      </div>
      <Block className="h-[40rem] sm:h-[27rem]" />
      <Block className="h-72" />
      <div className="space-y-4">
        <Bar className="h-7 w-48 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Block className="h-60" />
          <Block className="h-60" />
        </div>
      </div>
    </Page>
  );
}

/** Exercise flow step (content only; the flow frame stays mounted around it): header, the step's card, its action. */
export function FlowStepSkeleton() {
  return (
    <Page>
      <HeaderSkeleton />
      <Block className="h-72" />
      <Bar className="h-12 w-44" />
    </Page>
  );
}

/** Clinician caseload: rollup tiles + a two-column roster of patient cards + telemetry feed. */
export function ClinicCaseloadSkeleton() {
  return (
    <main className="mx-auto max-w-app px-5 py-10 sm:px-8">
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
    <main className="mx-auto max-w-app px-5 py-8 sm:px-8">
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
