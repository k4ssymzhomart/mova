// The НТЗ §15 RED destination. Giving the stop screen its own route means a reload, or opening the link again,
// keeps the patient on it instead of dropping them back into the exercise. It deliberately does not read the
// session: a stop screen must never wait on, or fail with, a database round trip.

import type { Metadata } from "next";

import SafetyStopPanel from "@/components/layout/SafetyStopPanel";
import { getTranslation } from "@/locales/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("safety.red.title")} · Mova` };
}

export default function StopStep() {
  return <SafetyStopPanel />;
}
