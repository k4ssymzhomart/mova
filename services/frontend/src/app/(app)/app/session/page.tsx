import { redirect } from "next/navigation";

// /app/session on its own is not a step. The flow starts from Today's «Начать» for a specific prescription, so
// anyone landing here goes back to Today.
export default function SessionIndex() {
  redirect("/app");
}
