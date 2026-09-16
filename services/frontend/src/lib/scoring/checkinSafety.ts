// Post-session check-in safety gate. A RED response replaces the check-in screen with a fixed,
// clinically-approved instruction and stops the training flow — never a diagnosis (NTZ §15.1/§15.2).

export type NewSymptom = "none" | "swelling" | "redness" | "drainage" | "calf_pain" | "dizziness" | "other";

const RED_FLAG_SYMPTOMS: ReadonlySet<NewSymptom> = new Set(["drainage", "dizziness", "calf_pain"]);

export function isRedFlag(symptoms: NewSymptom[]): boolean {
  return symptoms.some((s) => RED_FLAG_SYMPTOMS.has(s));
}
