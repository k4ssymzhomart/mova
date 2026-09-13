// Devices (/devices). No longer in the navigation: sensors are connected inside the exercise flow. The old page
// listed three sensors with invented battery and signal readings, so until the app can talk to real sensors
// this route says plainly that there is nothing to manage here and points back home.
//
// TODO(#21): the real device page (pairing, battery, signal) replaces this file and DevicesClient.tsx. The
// client is left in place for that work but is no longer rendered.

import type { Metadata } from "next";
import Link from "next/link";
import { Bluetooth, House } from "lucide-react";

import EmptyState from "@/components/app/EmptyState";
import PageHeader from "@/components/app/PageHeader";
import { secondaryButton } from "@/components/app/recipes";
import { getTranslation } from "@/locales/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("devices.metaTitle")} · Mova` };
}

export default function DevicesPage() {
  const { t } = getTranslation();

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t("devices.eyebrow")} title={t("devices.title")} lead={t("devices.lead")} />

      <EmptyState
        icon={Bluetooth}
        title={t("devices.empty.title")}
        body={t("devices.empty.body")}
        action={
          <Link href="/app" className={secondaryButton}>
            <House className="size-5" strokeWidth={1.9} aria-hidden="true" />
            {t("shell.home")}
          </Link>
        }
      />
    </div>
  );
}
