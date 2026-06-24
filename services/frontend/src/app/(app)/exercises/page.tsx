import type { Metadata } from "next";
import { Dumbbell } from "lucide-react";

import ComingSoon from "@/components/layout/ComingSoon";

export const metadata: Metadata = { title: "Exercises · Mova" };

export default function ExercisesPage() {
  return (
    <ComingSoon
      icon={Dumbbell}
      title="Exercises"
      description="Browse exercise packs — each with an explainer, target muscles and joints, difficulty, safety notes, and an add-to-program request."
    />
  );
}
