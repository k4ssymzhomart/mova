import { redirect } from "next/navigation";

// /app/session/new without a prescription is not a step. This route used to open a session row on every visit,
// before any sensor was connected. Sessions are now created only once the sensors step passes (#22), so this
// just returns the patient to Today, where «Начать» carries the prescription.
export default function NewSessionWithoutPrescription() {
  redirect("/app");
}
