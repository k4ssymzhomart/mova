// Retired route. Old article links (/learn/<slug>) land on Today (/app), the same as /learn: none of the
// articles was written for knee replacement, and no approved replacement content exists yet.

import { redirect } from "next/navigation";

export default function ArticlePage() {
  redirect("/app");
}
