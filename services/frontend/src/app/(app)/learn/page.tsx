import type { Metadata } from "next";
import { BookOpen } from "lucide-react";

import ComingSoon from "@/components/layout/ComingSoon";

export const metadata: Metadata = { title: "Learn · Mova" };

export default function LearnPage() {
  return (
    <ComingSoon
      icon={BookOpen}
      title="Learn"
      description="Your education hub — papers and guides on why each exercise works, personalised to your condition, in the Mova reading experience."
    />
  );
}
