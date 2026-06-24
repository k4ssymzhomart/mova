import type { Metadata } from "next";
import { Settings } from "lucide-react";

import ComingSoon from "@/components/layout/ComingSoon";

export const metadata: Metadata = { title: "Settings · Mova" };

export default function SettingsPage() {
  return (
    <ComingSoon
      icon={Settings}
      title="Settings"
      description="Profile, condition and affected side, accessibility (reduced motion, font size, contrast, language), privacy and consent, connected accounts."
    />
  );
}
