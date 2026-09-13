// Retired route. /intake asked for a stroke/Parkinson's condition and took a camera range-of-motion baseline.
// Neither applies to a knee patient measured by body-worn sensors; onboarding after knee replacement is a
// separate piece of work. The address now lands on Today (/app).

import { redirect } from "next/navigation";

export default function IntakePage() {
  redirect("/app");
}
