// The program overview: a one-minute compilation of the clinician's clips, shown once at the top of the library and
// on no single exercise. It is a portrait phone recording, some of it landscape shots letterboxed inside, so it is shown
// whole in a portrait frame rather than cropped. It never starts by itself (it is a minute long), so reduced motion needs no special case:
// nothing moves until the patient presses play. preload="none" keeps the page from fetching it until then.

import { bodyText, card, sectionTitle } from "@/components/app/recipes";
import { cn } from "@/lib/utils";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export default function LibraryOverviewVideo({ t }: { t: Translate }) {
  return (
    <section aria-labelledby="exercise-overview-title" className={cn(card, "overflow-hidden")}>
      <div className="flex flex-col sm:flex-row">
        <div className="relative mx-auto aspect-[464/832] w-full max-w-[13rem] shrink-0 sm:mx-0 sm:max-w-[14rem]">
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
