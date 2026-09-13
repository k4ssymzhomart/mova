// Retired route. Four of the five Learn articles were about Parkinson's, freezing of gait or stroke, and there
// is no approved education content for knee replacement yet. The address now lands on Today (/app).

import { redirect } from "next/navigation";

export default function LearnPage() {
  redirect("/app");
}
