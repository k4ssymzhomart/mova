// The program overview: a one-minute compilation of the clinician's clips, shown once at the top of the library and
// on no single exercise. It never starts by itself (it is a minute long), so reduced motion needs no special case:
// nothing moves until the patient presses play. preload="none" keeps the page from fetching it until then.

import { bodyText, card, sectionTitle } from "@/components/app/recipes";
import { cn } from "@/lib/utils";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export default function LibraryOverviewVideo({ t }: { t: Translate }) {
  return (
    <section aria-labelledby="exercise-overview-title" className={cn(card, "overflow-hidden")}>
      <div className="grid gap-0 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="relative aspect-video w-full bg-paper-soft">
          <video
            src="/exercises/overview.mp4"
            poster="/exercises/overview.jpg"
            controls
            muted
            playsInline
            preload="none"
            disablePictureInPicture
            disableRemotePlayback
            aria-label={t("exerciseLibrary.overview.video")}
            className="absolute inset-0 size-full object-contain"
          />
        </div>
        <div className="p-5 sm:p-6 lg:self-center">
          <h2 id="exercise-overview-title" className={sectionTitle}>
            {t("exerciseLibrary.overview.title")}
          </h2>
          <p className={cn("mt-2", bodyText)}>{t("exerciseLibrary.overview.caption")}</p>
        </div>
      </div>
    </section>
  );
}
