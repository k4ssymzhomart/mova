// Retired route. Levels, streaks and badges are no longer part of the app's chrome, and bringing any reward
// back safely belongs with the exercise session work (#22). The address now lands on /progress.

import { redirect } from "next/navigation";

export default function AchievementsPage() {
  redirect("/progress");
}
