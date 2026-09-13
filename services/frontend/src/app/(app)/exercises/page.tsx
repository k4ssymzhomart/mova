// Retired route. /exercises was a browsable catalogue of upper-limb and freezing-of-gait exercises. A knee
// patient only does what has been prescribed, so the address now lands on the plan (/program).

import { redirect } from "next/navigation";

export default function ExercisesPage() {
  redirect("/program");
}
