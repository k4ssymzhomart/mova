"use client";

// An exercise's detail, opened on the library itself by ?exercise=<slug>. The URL is the only state: a card's link
// pushes it, Back removes it, and a shared or reloaded link opens the same detail.
//  - A native modal <dialog>: focus moves in and stays in, Escape closes it, the page behind is inert, and focus
//    returns to the link that opened it. A click on the backdrop closes it too.
//  - Closing steps back when the library pushed the entry, and otherwise drops the parameter in place.
//  - Every section comes from the static catalog and is omitted when the catalog has nothing for it. No section is
//    filled in from elsewhere.
//  - The clip loops muted and inline. Under prefers-reduced-motion it does not start by itself; the play button does.
//  - Only Heel Slide with the patient's own active prescription offers «Начать» (library.ts startActionFor).

import { Pause, Play, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";

import { bodyText, eyebrow, focusRing, sectionTitle, tileLabel } from "@/components/app/recipes";
import { exerciseBySlug } from "@/lib/exercises/catalog";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

import { DETAIL_HISTORY_KEY } from "./ExerciseDetailLink";
import {
  EXERCISE_PARAM,
  type HeelSlidePrescription,
  linesIn,
  phaseShortKey,
  quantifiabilityKey,
  selectedSlug,
  sensorRoleKeys,
  startActionFor,
  textIn,
} from "./library";
import { clipObjectPosition, prefersReducedMotion } from "./media";
import SensorChips from "./SensorChips";
import StartControl from "./StartControl";

const TITLE_ID = "exercise-detail-title";

export default function ExerciseDetailDialog({ heelSlide }: { heelSlide: HeelSlidePrescription }) {
  const { t, locale } = useTranslation();
  const searchParams = useSearchParams();
  const slug = selectedSlug(searchParams?.getAll(EXERCISE_PARAM), (value) => exerciseBySlug(value) !== undefined);
  const entry = slug ? (exerciseBySlug(slug) ?? null) : null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Set once the URL has been told this opening is over, so no path steps back twice.
  const leftRef = useRef(true);

  // The URL drives the dialog: open it for a known slug, close it when the parameter goes (Back).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (entry) {
      if (!dialog.open) {
        leftRef.current = false;
        dialog.showModal();
      }
      document.body.style.overflow = "hidden";
    } else {
      leftRef.current = true; // the parameter is already gone
      document.body.style.overflow = "";
      if (dialog.open) dialog.close();
    }
  }, [entry]);

  useEffect(
    () => () => {
      document.body.style.overflow = "";
    },
    [],
  );

  /**
   * Takes ?exercise= off the URL once per opening: steps back over the entry the library pushed, or drops the
   * parameter in place for a link that was opened directly.
   */
  function leaveDetail() {
    if (leftRef.current) return;
    leftRef.current = true;
    document.body.style.overflow = "";
    if (!new URLSearchParams(window.location.search).has(EXERCISE_PARAM)) return;
    const state = window.history.state as Record<string, unknown> | null;
    if (state?.[DETAIL_HISTORY_KEY]) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete(EXERCISE_PARAM);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  // The close button, Escape and the backdrop close through here, so the URL follows at once. The dialog's own close
  // event also calls leaveDetail, for a close this component did not start; a browser may hold that event back in
  // a hidden tab, so it is not the only path.
  function requestClose() {
    dialogRef.current?.close();
    leaveDetail();
  }

  // Escape is handled here as well as natively: a browser that skips the native cancel (some embedded and older
  // engines do) still closes. preventDefault keeps a browser that does both from closing twice.
  function onDialogKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    requestClose();
  }

  // A click on the backdrop lands on the <dialog> itself, outside its box.
  function onDialogClick(event: MouseEvent<HTMLDialogElement>) {
    const dialog = event.currentTarget;
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) requestClose();
  }

  const name = entry ? (textIn(entry.name, locale) ?? "") : "";
  const sensorLabels = entry ? sensorRoleKeys(entry.sensors).map((key) => t(key)) : [];
  const target = entry ? textIn(entry.target, locale) : null;
  const minValidExcursion = entry ? textIn(entry.minValidExcursion, locale) : null;
  const measures = entry ? textIn(entry.measures, locale) : null;
  const quantKey = entry ? quantifiabilityKey(entry.quantifiability) : null;
  const cues = entry ? linesIn(entry.cues, locale) : [];
  const commonErrors = entry ? linesIn(entry.commonErrors, locale) : [];
  const hasFacts = Boolean(sensorLabels.length > 0 || target || minValidExcursion || measures || quantKey);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={entry ? TITLE_ID : undefined}
      onClose={leaveDetail}
      onKeyDown={onDialogKeyDown}
      onClick={onDialogClick}
      className={cn(
        "m-0 h-[100dvh] max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-card p-0 text-ink backdrop:bg-ink/30",
        "sm:m-auto sm:h-auto sm:max-h-[calc(100dvh-4rem)] sm:w-[calc(100%-4rem)] sm:max-w-2xl sm:rounded-card sm:border sm:border-line sm:shadow-card",
      )}
    >
      {entry && (
        <div>
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-card px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <p className={eyebrow}>{t(phaseShortKey(entry.phase))}</p>
              <h2 id={TITLE_ID} className={cn("mt-1 [overflow-wrap:anywhere]", sectionTitle)}>
                {name}
              </h2>
            </div>
            <button
              type="button"
              onClick={requestClose}
              className={cn(
                "inline-flex min-h-12 shrink-0 items-center gap-2 rounded-pill px-4 text-base text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink",
                focusRing,
              )}
            >
              <X className="size-5" strokeWidth={1.8} aria-hidden="true" />
              {t("exerciseLibrary.detail.close")}
            </button>
          </div>

          <div className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
            {entry.video && <DetailVideo key={entry.video} video={entry.video} poster={entry.poster} name={name} />}

            <StartControl
              action={startActionFor(entry.slug, heelSlide)}
              id="exercise-detail-start"
              titleId={TITLE_ID}
              labels={{
                start: t("exerciseLibrary.start"),
                notPrescribed: t("exerciseLibrary.notPrescribed"),
                unknown: t("exerciseLibrary.prescriptionUnknown"),
              }}
            />

            {hasFacts && (
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {sensorLabels.length > 0 && (
                  <div>
                    <dt className={tileLabel}>{t("exerciseLibrary.field.sensors")}</dt>
                    <dd className="mt-2">
                      <SensorChips labels={sensorLabels} />
                    </dd>
                  </div>
                )}
                {quantKey && (
                  <div>
                    <dt className={tileLabel}>{t("exerciseLibrary.field.quantifiability")}</dt>
                    <dd className="mt-1 text-base font-medium text-ink">{t(quantKey)}</dd>
                  </div>
                )}
                {target && <Fact label={t("exerciseLibrary.field.target")} value={target} />}
                {minValidExcursion && (
                  <Fact label={t("exerciseLibrary.field.minValidExcursion")} value={minValidExcursion} />
                )}
                {measures && <Fact label={t("exerciseLibrary.field.measures")} value={measures} wide />}
              </dl>
            )}

            {cues.length > 0 && (
              <section aria-labelledby="exercise-detail-cues">
                <h3 id="exercise-detail-cues" className="text-lg font-semibold text-ink">
                  {t("exerciseLibrary.detail.cues")}
                </h3>
                <ol className={cn("mt-2 list-decimal space-y-2 pl-6", bodyText, "text-ink")}>
                  {cues.map((cue, index) => (
                    <li key={index}>{cue}</li>
                  ))}
                </ol>
              </section>
            )}

            {commonErrors.length > 0 && (
              <section aria-labelledby="exercise-detail-errors">
                <h3 id="exercise-detail-errors" className="text-lg font-semibold text-ink">
                  {t("exerciseLibrary.detail.commonErrors")}
                </h3>
                <ul className={cn("mt-2 list-disc space-y-2 pl-6", bodyText, "text-ink")}>
                  {commonErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className={tileLabel}>{label}</dt>
      <dd className="mt-1 text-base leading-relaxed text-ink">{value}</dd>
    </div>
  );
}

/** The reference clip, looping muted and inline. It starts by itself unless reduced motion is asked for. */
function DetailVideo({ video, poster, name }: { video: string; poster: string | null; name: string }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    // Muted as a property too: React does not reliably set the attribute, and only a muted clip may start itself.
    element.muted = true;
    // Started on the next frame: this effect runs before the dialog's own effect opens it, and a browser may refuse
    // or pause a clip that starts itself while it is still hidden.
    const frame = window.requestAnimationFrame(() => {
      if (prefersReducedMotion()) return;
      element.play().catch(() => {
        /* the browser refused to start it; the play button still works */
      });
    });
    // Switching reduced motion on while the clip plays pauses it.
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      if (query.matches) element.pause();
    };
    query.addEventListener("change", onChange);
    return () => {
      window.cancelAnimationFrame(frame);
      query.removeEventListener("change", onChange);
    };
  }, []);

  function toggle() {
    const element = videoRef.current;
    if (!element) return;
    element.muted = true;
    if (element.paused) element.play().catch(() => {});
    else element.pause();
  }

  // A clip that fails to load is left out, like one the catalog does not have.
  if (failed) return null;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-card bg-paper-soft ring-1 ring-line">
      <video
        ref={videoRef}
        src={video}
        poster={poster ?? undefined}
        loop
        muted
        playsInline
        preload="none"
        aria-label={t("exerciseLibrary.media.video", { name })}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(true)}
        disablePictureInPicture
        disableRemotePlayback
        className="size-full object-cover"
        style={{ objectPosition: clipObjectPosition(video) }}
      />
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "absolute bottom-3 left-3 inline-flex min-h-12 items-center gap-2 rounded-pill border border-line bg-card px-4 text-base font-medium text-ink shadow-soft transition-colors hover:bg-paper-soft",
          focusRing,
        )}
      >
        {playing ? (
          <Pause className="size-5" strokeWidth={2} aria-hidden="true" />
        ) : (
          <Play className="size-5" strokeWidth={2} aria-hidden="true" />
        )}
        {t(playing ? "exerciseLibrary.media.pause" : "exerciseLibrary.media.play")}
      </button>
    </div>
  );
}
