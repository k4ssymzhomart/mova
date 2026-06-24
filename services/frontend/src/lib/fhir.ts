// Mock FHIR adapter.
//
// This is a *stub*: it shapes the local intake/profile data into FHIR R4-style resources (Patient,
// Condition, CarePlan, Observation) and wraps them in a Bundle. There is no server round-trip yet — the
// point is the clean boundary. When a real EHR/FHIR integration lands, only this file changes: the rest
// of the app already speaks "profile", and this layer owns the translation. Codes are illustrative
// (SNOMED CT / LOINC / UCUM shaped) and clearly marked mock where no clean single code exists.

import type { PatientProfile } from "./profile/types";

// --- minimal FHIR-shaped types (only the fields we populate) -----------------------------------------

interface Coding {
  system: string;
  code: string;
  display: string;
}
interface CodeableConcept {
  coding: Coding[];
  text?: string;
}
interface Reference {
  reference: string;
  display?: string;
}
interface Quantity {
  value: number;
  unit: string;
  system: string;
  code: string;
}

export interface FhirPatient {
  resourceType: "Patient";
  id: string;
  active: boolean;
  identifier: { system: string; value: string }[];
  meta: { source: string; tag: Coding[] };
}
export interface FhirCondition {
  resourceType: "Condition";
  id: string;
  clinicalStatus: CodeableConcept;
  code: CodeableConcept;
  bodySite?: CodeableConcept[];
  subject: Reference;
}
export interface FhirObservation {
  resourceType: "Observation";
  id: string;
  status: "final" | "preliminary";
  category: CodeableConcept[];
  code: CodeableConcept;
  bodySite?: CodeableConcept;
  valueQuantity: Quantity;
  effectiveDateTime: string;
  subject: Reference;
}
export interface FhirCarePlan {
  resourceType: "CarePlan";
  id: string;
  status: "active";
  intent: "plan";
  title: string;
  subject: Reference;
  addresses: Reference[];
  created: string;
  activity: { detail: { kind: "ServiceRequest"; status: "scheduled"; code: CodeableConcept; description: string } }[];
}
export interface FhirBundle {
  resourceType: "Bundle";
  type: "collection";
  timestamp: string;
  entry: { resource: FhirPatient | FhirCondition | FhirObservation | FhirCarePlan }[];
}

// --- code maps (illustrative) ------------------------------------------------------------------------

const SNOMED = "http://snomed.info/sct";
const LOINC = "http://loinc.org";
const UCUM = "http://unitsofmeasure.org";
const MOVA = "https://mova.health/fhir";

const CONDITION_CODE: Record<PatientProfile["condition"], Coding> = {
  stroke: { system: SNOMED, code: "230690007", display: "Cerebrovascular accident" },
  parkinsons: { system: SNOMED, code: "49049000", display: "Parkinson's disease" },
  ortho: { system: MOVA, code: "ortho-recovery", display: "Orthopaedic recovery (mock)" },
};

const LATERALITY: Record<PatientProfile["affectedSide"], Coding> = {
  left: { system: SNOMED, code: "7771000", display: "Left" },
  right: { system: SNOMED, code: "24028007", display: "Right" },
  bilateral: { system: SNOMED, code: "51440002", display: "Right and left" },
};

const PACK_CODE = {
  reaching: { system: MOVA, code: "pack-upper-limb-reaching", display: "Upper-limb reaching pack" },
  gait: { system: MOVA, code: "pack-gait-balance", display: "Gait & balance pack" },
} as const;

// --- builders ----------------------------------------------------------------------------------------

const cc = (coding: Coding, text?: string): CodeableConcept => ({ coding: [coding], text });

export function toFhirPatient(p: PatientProfile): FhirPatient {
  return {
    resourceType: "Patient",
    id: p.id,
    active: true,
    identifier: [{ system: `${MOVA}/patient-id`, value: p.id }],
    meta: { source: "mova-app", tag: [{ system: MOVA, code: "mock", display: "Mock / non-PHI demo data" }] },
  };
}

export function toFhirCondition(p: PatientProfile): FhirCondition {
  return {
    resourceType: "Condition",
    id: `cond-${p.id}`,
    clinicalStatus: cc({ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active", display: "Active" }),
    code: cc(CONDITION_CODE[p.condition]),
    bodySite: [cc(LATERALITY[p.affectedSide])],
    subject: { reference: `Patient/${p.id}` },
  };
}

export function toFhirObservations(p: PatientProfile): FhirObservation[] {
  if (!p.baseline) return [];
  const when = new Date(p.baseline.capturedAt).toISOString();
  const deg: Quantity["unit"] = "degree";
  const q = (value: number): Quantity => ({ value: Math.round(value), unit: deg, system: UCUM, code: "deg" });
  const exam = cc({ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "exam", display: "Exam" });
  const side = (s: "left" | "right"): CodeableConcept => cc(LATERALITY[s]);

  const obs: FhirObservation[] = [];
  const push = (id: string, code: Coding, region: "left" | "right", value: number) =>
    obs.push({
      resourceType: "Observation",
      id: `${id}-${p.id}`,
      status: "final",
      category: [exam],
      code: cc(code),
      bodySite: side(region),
      valueQuantity: q(value),
      effectiveDateTime: when,
      subject: { reference: `Patient/${p.id}` },
    });

  const arm: Coding = { system: LOINC, code: "movaa-shoulder-elev", display: "Shoulder elevation ROM (mock)" };
  const knee: Coding = { system: LOINC, code: "movaa-hip-flex", display: "Hip flexion / knee-raise ROM (mock)" };
  push("obs-arm-l", arm, "left", p.baseline.armElevationDeg.left);
  push("obs-arm-r", arm, "right", p.baseline.armElevationDeg.right);
  push("obs-knee-l", knee, "left", p.baseline.kneeRaiseDeg.left);
  push("obs-knee-r", knee, "right", p.baseline.kneeRaiseDeg.right);
  return obs;
}

export function toFhirCarePlan(p: PatientProfile): FhirCarePlan {
  const pack = PACK_CODE[p.recommendedPack];
  return {
    resourceType: "CarePlan",
    id: `plan-${p.id}`,
    status: "active",
    intent: "plan",
    title: "Mova home rehabilitation plan",
    subject: { reference: `Patient/${p.id}` },
    addresses: [{ reference: `Condition/cond-${p.id}`, display: CONDITION_CODE[p.condition].display }],
    created: new Date(p.updatedAt).toISOString(),
    activity: [
      {
        detail: {
          kind: "ServiceRequest",
          status: "scheduled",
          code: cc(pack),
          description: `Prescribed ${pack.display}, personalised to the ${p.affectedSide} side from a CV-guided ROM baseline.`,
        },
      },
    ],
  };
}

/** The full intake → FHIR bundle: Patient + Condition + baseline Observations + CarePlan. */
export function toFhirBundle(p: PatientProfile): FhirBundle {
  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: [
      { resource: toFhirPatient(p) },
      { resource: toFhirCondition(p) },
      ...toFhirObservations(p).map((resource) => ({ resource })),
      { resource: toFhirCarePlan(p) },
    ],
  };
}
