// The patient's own history, as one wide row per session: when it was, which exercise, how many repetitions the
// device counted against the number prescribed, how long it took, whether everything it recorded reached the
// server, and the answers the patient gave afterwards.
//
// Every column is read back from something the session itself stored — sessions.summary (lib/sessions/summary.ts)
// and session_check_ins — and a field the session did not store shows «—», never a zero. Nothing here is a score:
// the app computes none, and a repetition count is a count, not a mark.
//
// On a phone the same rows are cards, because a nine-column table is not readable at 400px.

import Link from "next/link";

import LocalDateTime from "@/components/app/LocalDateTime";
import { card, focusRing, tileLabel } from "@/components/app/recipes";
import type { CheckInEntry, SessionEntry, Translate } from "@/app/(app)/progress/sessionView";
import { formatDuration, SessionStatus } from "@/app/(app)/progress/sessionView";
import { recordingComplete } from "@/lib/sessions/summary";
import { cn } from "@/lib/utils";

const DASH = "—";

function reps(session: SessionEntry, t: Translate): string {
  const facts = session.facts;
  if (!facts || facts.repsCounted === null) return DASH;
  if (facts.targetReps === null) return String(facts.repsCounted);
  return t("progress.log.repsOf", { done: facts.repsCounted, target: facts.targetReps });
}

function recording(session: SessionEntry, t: Translate): { label: string; muted: boolean } {
  const facts = session.facts;
  if (!facts) return { label: DASH, muted: true };
  const complete = recordingComplete(facts);
  if (complete === null) return { label: DASH, muted: true };
  if (complete) {
    const frames = facts.telemetry.framesConfirmed;
    return { label: frames === null ? t("progress.log.recordingComplete") : t("progress.log.frames", { n: frames }), muted: false };
  }
  return { label: t("progress.log.recordingPartial"), muted: false };
}

function pain(entry: CheckInEntry | undefined, t: Translate): string {
  if (!entry || (entry.painBefore === null && entry.painAfter === null)) return DASH;
  const before = entry.painBefore === null ? DASH : String(entry.painBefore);
  const after = entry.painAfter === null ? DASH : String(entry.painAfter);
  return t("progress.log.painPair", { before, after });
}

function feels(entry: CheckInEntry | undefined, t: Translate): string {
  if (!entry?.kneeFeels) return DASH;
  // The same four words the check-in form itself offers (flow.checkIn.kneeOpt.*), so the history reads back what
  // the patient was asked. An answer this build does not know is shown as stored rather than guessed at.
  const known = ["better", "same", "slightly_worse", "much_worse"];
  return known.includes(entry.kneeFeels) ? t(`flow.checkIn.kneeOpt.${entry.kneeFeels}`) : entry.kneeFeels;
}

export default function SessionLogTable({
  sessions,
  checkIns,
  t,
}: {
  sessions: SessionEntry[];
  checkIns: Map<string, CheckInEntry>;
  t: Translate;
}) {
  const columns = [
    t("progress.log.date"),
    t("progress.log.exercise"),
    t("progress.log.status"),
    t("progress.log.reps"),
    t("progress.log.duration"),
    t("progress.log.recording"),
    t("progress.log.pain"),
    t("progress.log.difficulty"),
    t("progress.log.feels"),
  ];

  return (
    <>
      {/* The table, from the large breakpoint up. */}
      <div className={cn(card, "hidden overflow-hidden lg:block")}>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-paper-soft">
              {columns.map((column) => (
                <th key={column} scope="col" className={cn("px-4 py-3 font-medium", tileLabel)}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => {
              const entry = checkIns.get(session.id);
              const record = recording(session, t);
              const duration = formatDuration(session.startedAt, session.endedAt, t);
              return (
                <tr key={session.id} className="border-b border-line last:border-0 hover:bg-paper-soft">
                  <td className="px-4 py-4 align-middle">
                    <Link
                      href={`/progress/${session.id}`}
                      className={cn("rounded-sm font-medium text-ink underline-offset-4 hover:underline", focusRing)}
                    >
                      <LocalDateTime iso={session.startedAt} format="dateTime" />
                    </Link>
                  </td>
                  <td className="px-4 py-4 align-middle text-ink">{session.exerciseName ?? DASH}</td>
                  <td className="px-4 py-4 align-middle">
                    <SessionStatus status={session.status} />
                  </td>
                  <td className="tnum px-4 py-4 align-middle text-ink">{reps(session, t)}</td>
                  <td className="px-4 py-4 align-middle text-ink-soft">{duration ?? DASH}</td>
                  <td className={cn("px-4 py-4 align-middle", record.muted ? "text-ink-soft" : "text-ink")}>
                    {record.label}
                  </td>
                  <td className="tnum px-4 py-4 align-middle text-ink">{pain(entry, t)}</td>
                  <td className="tnum px-4 py-4 align-middle text-ink">
                    {entry?.difficulty ?? DASH}
                  </td>
                  <td className="px-4 py-4 align-middle text-ink">{feels(entry, t)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* The same rows as cards, below that. */}
      <ul className="space-y-3 lg:hidden">
        {sessions.map((session) => {
          const entry = checkIns.get(session.id);
          const record = recording(session, t);
          const duration = formatDuration(session.startedAt, session.endedAt, t);
          return (
            <li key={session.id} className={cn(card, "p-5")}>
              <Link
                href={`/progress/${session.id}`}
                className={cn("rounded-sm text-lg font-medium text-ink underline-offset-4 hover:underline", focusRing)}
              >
                <LocalDateTime iso={session.startedAt} format="dateTime" />
              </Link>
              <p className="mt-1 text-base text-ink-soft">{session.exerciseName ?? DASH}</p>
              <div className="mt-3">
                <SessionStatus status={session.status} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label={t("progress.log.reps")} value={reps(session, t)} />
                <Field label={t("progress.log.duration")} value={duration ?? DASH} />
                <Field label={t("progress.log.recording")} value={record.label} />
                <Field label={t("progress.log.pain")} value={pain(entry, t)} />
                <Field label={t("progress.log.difficulty")} value={entry?.difficulty == null ? DASH : String(entry.difficulty)} />
                <Field label={t("progress.log.feels")} value={feels(entry, t)} />
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={tileLabel}>{label}</dt>
      <dd className="mt-1 text-base font-medium text-ink">{value}</dd>
    </div>
  );
}
