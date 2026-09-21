// The program overview: a one-minute compilation of the clinician's clips, shown once at the top of the library and
// on no single exercise. It never starts by itself (it is a minute long), so reduced motion needs no special case:
// nothing moves until the patient presses play. preload="none" keeps the page from fetching it until then.
//
// This file was already framing its clip correctly by hand. It now takes the same numbers from the geometry table
// that every other clip surface reads, so there is one place to correct if the file is ever re-exported. The clip is
// recorded there as bars:"mixed" — decoding frames across its minute shows an early landscape shot letterboxed into
// the portrait frame and later shots filling it — which is why its fit is "contain" and must stay so. No crop is
// right for a clip that changes shape while it plays, so it is shown whole in its file's own frame.

import { bodyText, card, sectionTitle } from "@/components/app/recipes";
import { CLIP_GEOMETRY, clipFitClass } from "@/lib/exercises/clipGeometry";
import { cn } from "@/lib/utils";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const OVERVIEW = "/exercises/overview.mp4";
const OVERVIEW_POSTER = "/exercises/overview.jpg";

export default function LibraryOverviewVideo({ t }: { t: Translate }) {
  const geometry = CLIP_GEOMETRY[OVERVIEW];

  return (
    <section aria-labelledby="exercise-overview-title" className={cn(card, "overflow-hidden")}>
      <div className="flex flex-col sm:flex-row">
        <div
          className={cn(
            "relative mx-auto w-full max-w-[13rem] shrink-0 sm:mx-0 sm:max-w-[14rem]",
            geometry.frameClass,
          )}
        >
          <video
            src={OVERVIEW}
            poster={OVERVIEW_POSTER}
            controls
            muted
            playsInline
            preload="none"
            disablePictureInPicture
            disableRemotePlayback
            aria-label={t("exerciseLibrary.overview.video")}
            className={cn("absolute inset-0 size-full", clipFitClass(geometry))}
          />
        </div>
        <div className="p-5 sm:self-center sm:p-8">
          <h2 id="exercise-overview-title" className={sectionTitle}>
            {t("exerciseLibrary.overview.title")}
          </h2>
          <p className={cn("mt-2", bodyText)}>{t("exerciseLibrary.overview.caption")}</p>
        </div>
      </div>
    </section>
  );
}
