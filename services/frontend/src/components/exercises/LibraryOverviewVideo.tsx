// The program overview: a one-minute compilation of the clinician's clips, shown once at the top of the library and
// on no single exercise. It is a sideways shot letterboxed inside an upright phone frame, so it is drawn in a box the
// shape of the picture itself (lib/exercises/clipFrames.ts) and the black bands are left outside the box. It never
// starts by itself — it is a minute long — so reduced motion needs no special case, and preload="none" keeps the page
// from fetching it until the patient presses play.

import { bodyText, card, sectionTitle } from "@/components/app/recipes";
import { clipFrame } from "@/lib/exercises/clipFrames";
import { cn } from "@/lib/utils";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const VIDEO = "/exercises/overview.mp4";

export default function LibraryOverviewVideo({ t }: { t: Translate }) {
  const frame = clipFrame(VIDEO);

  return (
    <section aria-labelledby="exercise-overview-title" className={cn(card, "overflow-hidden")}>
      <div className="grid gap-0 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="relative w-full bg-paper-soft" style={{ aspectRatio: frame.ratio }}>
          <video
            src={VIDEO}
            poster="/exercises/overview.jpg"
            controls
            muted
            playsInline
            preload="none"
            disablePictureInPicture
            disableRemotePlayback
            aria-label={t("exerciseLibrary.overview.video")}
            className="absolute inset-0 size-full object-cover"
            style={{ objectPosition: frame.objectPosition }}
          />
        </div>
        <div className="p-5 sm:p-7 lg:self-center">
          <h2 id="exercise-overview-title" className={sectionTitle}>
            {t("exerciseLibrary.overview.title")}
          </h2>
          <p className={cn("mt-2", bodyText)}>{t("exerciseLibrary.overview.caption")}</p>
        </div>
      </div>
    </section>
  );
}
