import type { Metadata } from "next";
import { Trophy } from "lucide-react";

import ComingSoon from "@/components/layout/ComingSoon";

export const metadata: Metadata = { title: "Achievements · Mova" };

export default function AchievementsPage() {
  return (
    <ComingSoon
      icon={Trophy}
      title="Achievements"
      description="Levels and XP, badges, streaks, and your recovery journey rendered as a map — every milestone mapped to a clinical metric."
    />
  );
}
