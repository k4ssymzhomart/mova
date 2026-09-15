/**
 * seed-heel-slide.mjs — test data for the Heel Slide path (docs/heel-slide-path.md).
 *
 * Link 1 of the path is "a prescription exists", and there is deliberately no prescription builder UI, so this
 * script writes it. On the hosted project it creates, or brings back in line:
 *
 *   exercises          heel-slide (draft engineering config in scoring_rubric, unpublished)
 *   clinics            heel-slide-test — an isolated clinic, so the real patients in "Mova Personal" never see
 *                      these accounts and the test clinician never sees them
 *   auth users         one patient and one clinician (email confirmed), with their profiles placed in that clinic
 *   patients           affected side from HEEL_SLIDE_SIDE, mrn TEST-HEEL-SLIDE
 *   clinicians         + an active care_team_link to the patient (the clinician view requires it)
 *   programs           an active program for the patient
 *   prescriptions      an active Heel Slide prescription, dose {"reps": 10}, prescribed by the clinician
 *
 * Idempotent: every run looks each row up first and only creates what is missing or updates fields that
 * differ. It uses the service role, so it runs only where SUPABASE_SERVICE_ROLE_KEY is available and never in
 * the browser. Passwords come from the environment, are needed only when an account is created, and are never
 * printed; output is limited to ids, emails and routes.
 *
 * The database is shared with real users. Before writing anything the script checks every precondition, and it
 * refuses to take over an existing account that lives outside the test clinic unless --adopt-existing is given.
 *
 * Usage (from services/frontend):
 *   node scripts/seed-heel-slide.mjs --dry-run
 *   HEEL_SLIDE_PATIENT_PASSWORD=… HEEL_SLIDE_CLINICIAN_PASSWORD=… node scripts/seed-heel-slide.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(here, "../.env.local");

const EXERCISE = {
  slug: "heel-slide",
  name: "Heel Slide",
  modality: "knee_flexion_extension",
  target_joints: [],
  is_published: false,
  default_dose: { reps: 10 },
  scoring_rubric: {
    schema: "exercise_config/heel_slide_path.v1",
    approval_state: "draft",
    quantifiability_class: "FULL",
    target: { type: "AT_LEAST", metric: "knee_flexion_deg", value: 90 },
    min_valid_excursion_deg: 22.5,
    reps: 10,
    sensors: ["thigh", "shank"],
    note: "Engineering config for the heel slide path. Not clinically approved. Moves to exercise_configs with #20.",
  },
};

const CLINIC = { slug: "heel-slide-test", name: "Heel Slide test clinic", timezone: "Asia/Almaty" };
const PATIENT_MRN = "TEST-HEEL-SLIDE";
const PROGRAM_TITLE = "Heel Slide test program";
const PRESCRIPTION_DOSE = { reps: 10 };

const DEFAULT_PATIENT_EMAIL = "heel-slide-patient@mova.test";
const DEFAULT_CLINICIAN_EMAIL = "heel-slide-clinician@mova.test";

const KNOWN_ARGS = new Set(["--dry-run", "--adopt-existing", "--help", "-h"]);
const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has("--dry-run");
const ADOPT_EXISTING = ARGS.has("--adopt-existing");

function usage() {
  return [
    "Usage: node scripts/seed-heel-slide.mjs [--dry-run] [--adopt-existing]",
    "",
    "  --dry-run          read-only: print what would be created or changed and write nothing",
    "  --adopt-existing   allow an existing account outside the test clinic to be moved into it",
    "",
    "Environment (the process environment wins over services/frontend/.env.local):",
    "  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required",
    `  HEEL_SLIDE_PATIENT_EMAIL        default ${DEFAULT_PATIENT_EMAIL}`,
    `  HEEL_SLIDE_CLINICIAN_EMAIL      default ${DEFAULT_CLINICIAN_EMAIL}`,
    "  HEEL_SLIDE_PATIENT_PASSWORD     required only when the patient account is created",
    "  HEEL_SLIDE_CLINICIAN_PASSWORD   required only when the clinician account is created",
    "  HEEL_SLIDE_SIDE                 operated side: right (default) or left",
  ].join("\n");
}

/** Minimal .env reader: KEY=VALUE lines, optional quotes, # comments. Never overrides the real environment. */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (raw.trimStart().startsWith("#")) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(raw);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    process.env[key] = value;
  }
}

/** Key-order-independent JSON, so a jsonb column read back from PostgREST compares equal to the desired value. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function changedFields(current, desired) {
  return Object.keys(desired).filter((key) => stable(current?.[key]) !== stable(desired[key]));
}

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

function must({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message || "request failed"}${error.code ? ` (${error.code})` : ""}`);
  return data;
}

function step(action, subject, detail) {
  const verb = action === "ok" ? "ok" : `${DRY_RUN ? "would " : ""}${action}`;
  console.log(`  ${verb.padEnd(13)} ${subject}${detail ? `  ${detail}` : ""}`);
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function findUserByEmail(db, email) {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const data = must(await db.auth.admin.listUsers({ page, perPage }), "list auth users");
    const hit = data.users.find((user) => user.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < perPage) return null;
  }
}

async function findClinic(db) {
  return must(
    await db.from("clinics").select("id, name, slug, timezone").eq("slug", CLINIC.slug).maybeSingle(),
    "read clinic",
  );
}

async function findProfile(db, userId) {
  return must(
    await db.from("profiles").select("id, role, clinic_id, full_name, display_name").eq("id", userId).maybeSingle(),
    "read profile",
  );
}

/**
 * Everything that must hold before the first write. Returns human-readable blockers; an empty list means the
 * real run can proceed. Reads only.
 */
async function preflight(db, accounts) {
  const blockers = [];

  const enumProbe = await db.from("exercises").select("id").eq("modality", EXERCISE.modality).limit(1);
  if (enumProbe.error) {
    blockers.push(
      enumProbe.error.code === "22P02"
        ? `exercise_modality has no '${EXERCISE.modality}' value: apply supabase/migrations/0034_heel_slide_path.sql`
        : `cannot read exercises: ${enumProbe.error.message}`,
    );
  }
  const checkIns = await db.from("session_check_ins").select("id").limit(1);
  if (checkIns.error) {
    blockers.push("public.session_check_ins is missing: apply supabase/migrations/0034_heel_slide_path.sql");
  }
  const bindings = await db.from("patient_ble_devices").select("patient_id").limit(1);
  if (bindings.error) {
    blockers.push("public.patient_ble_devices is missing: apply supabase/migrations/0023_patient_ble_devices.sql");
  }

  const clinic = await findClinic(db);
  for (const account of accounts) {
    account.user = await findUserByEmail(db, account.email);
    if (!account.user) {
      if (!process.env[account.passwordVar]) {
        blockers.push(`${account.email} does not exist yet and ${account.passwordVar} is not set`);
      }
      continue;
    }
    const profile = await findProfile(db, account.user.id);
    const inTestClinic = Boolean(clinic && profile?.clinic_id === clinic.id);
    if (!inTestClinic && !ADOPT_EXISTING) {
      blockers.push(
        `${account.email} already exists outside the test clinic (role ${profile?.role ?? "unknown"}); ` +
          "pass --adopt-existing to move it into the test clinic",
      );
    }
    // A patient account must not already be a clinician, and the other way round.
    const otherTable = account.role === "patient" ? "clinicians" : "patients";
    const other = must(
      await db.from(otherTable).select("id").eq("profile_id", account.user.id).maybeSingle(),
      `read ${otherTable}`,
    );
    if (other) {
      blockers.push(`${account.email} already has a ${otherTable} row, so it cannot be the test ${account.role}`);
    }
  }

  return blockers;
}

// ── Writes (each one looks up first; in a dry run it only reports) ─────────────────────────────────────────────

async function ensureExercise(db) {
  const desired = pick(EXERCISE, ["name", "modality", "target_joints", "is_published", "default_dose", "scoring_rubric"]);
  const current = must(
    await db
      .from("exercises")
      .select("id, slug, name, modality, target_joints, is_published, default_dose, scoring_rubric")
      .eq("slug", EXERCISE.slug)
      .maybeSingle(),
    "read exercise",
  );
  if (!current) {
    step("create", `exercise ${EXERCISE.slug}`);
    if (DRY_RUN) return null;
    return must(
      await db.from("exercises").insert({ slug: EXERCISE.slug, ...desired }).select("id").single(),
      "create exercise",
    ).id;
  }
  const changed = changedFields(current, desired);
  if (changed.length === 0) {
    step("ok", `exercise ${EXERCISE.slug}`, current.id);
  } else {
    step("update", `exercise ${EXERCISE.slug}`, `${current.id} (${changed.join(", ")})`);
    if (!DRY_RUN) must(await db.from("exercises").update(pick(desired, changed)).eq("id", current.id), "update exercise");
  }
  return current.id;
}

async function ensureClinic(db) {
  const desired = { name: CLINIC.name, timezone: CLINIC.timezone };
  const current = await findClinic(db);
  if (!current) {
    step("create", `clinic ${CLINIC.slug}`);
    if (DRY_RUN) return null;
    return must(
      await db.from("clinics").insert({ slug: CLINIC.slug, ...desired }).select("id").single(),
      "create clinic",
    ).id;
  }
  const changed = changedFields(current, desired);
  if (changed.length === 0) {
    step("ok", `clinic ${CLINIC.slug}`, current.id);
  } else {
    step("update", `clinic ${CLINIC.slug}`, `${current.id} (${changed.join(", ")})`);
    if (!DRY_RUN) must(await db.from("clinics").update(pick(desired, changed)).eq("id", current.id), "update clinic");
  }
  return current.id;
}

/** The auth user and its profile (role + clinic). Returns the user id, or null in a dry run before creation. */
async function ensureAccount(db, account, clinicId) {
  let userId = account.user?.id ?? null;
  if (!userId) {
    step("create", `${account.role} account ${account.email}`, "email confirmed");
    if (DRY_RUN) return null;
    const created = must(
      await db.auth.admin.createUser({
        email: account.email,
        password: process.env[account.passwordVar],
        email_confirm: true,
        // role is read by app.handle_new_user, so the profile is born with the right role.
        user_metadata: { role: account.role, full_name: account.fullName },
      }),
      `create ${account.role} account`,
    );
    userId = created.user.id;
  } else {
    step("ok", `${account.role} account ${account.email}`, userId);
  }

  const profile = await findProfile(db, userId);
  const desired = { role: account.role, clinic_id: clinicId };
  if (!profile) {
    step("create", `${account.role} profile`, userId);
    if (!DRY_RUN) {
      must(
        await db.from("profiles").insert({ id: userId, email: account.email, full_name: account.fullName, ...desired }),
        "create profile",
      );
    }
    return userId;
  }
  // Names are only filled in, never overwritten: an adopted account keeps its owner's name.
  if (!profile.full_name) desired.full_name = account.fullName;
  if (!profile.display_name) desired.display_name = account.fullName;
  const changed = clinicId ? changedFields(profile, desired) : Object.keys(desired);
  if (changed.length === 0) {
    step("ok", `${account.role} profile`, `role ${profile.role}, test clinic`);
  } else {
    step("update", `${account.role} profile`, `${userId} (${changed.join(", ")})`);
    if (!DRY_RUN) must(await db.from("profiles").update(pick(desired, changed)).eq("id", userId), "update profile");
  }
  return userId;
}

async function ensurePatient(db, profileId, clinicId, side) {
  const desired = { clinic_id: clinicId, mrn: PATIENT_MRN, affected_side: side, enrollment_status: "active" };
  const current = profileId
    ? must(
        await db
          .from("patients")
          .select("id, clinic_id, mrn, affected_side, enrollment_status")
          .eq("profile_id", profileId)
          .maybeSingle(),
        "read patient",
      )
    : null;
  if (!current) {
    step("create", "patient record", `side ${side}, mrn ${PATIENT_MRN}`);
    if (DRY_RUN) return null;
    return must(await db.from("patients").insert({ profile_id: profileId, ...desired }).select("id").single(), "create patient").id;
  }
  const changed = changedFields(current, desired);
  if (changed.length === 0) {
    step("ok", "patient record", `${current.id} (side ${side})`);
  } else {
    step("update", "patient record", `${current.id} (${changed.join(", ")})`);
    if (!DRY_RUN) must(await db.from("patients").update(pick(desired, changed)).eq("id", current.id), "update patient");
  }
  return current.id;
}

async function ensureClinician(db, profileId, clinicId) {
  const desired = { clinic_id: clinicId, is_active: true };
  const current = profileId
    ? must(
        await db.from("clinicians").select("id, clinic_id, is_active").eq("profile_id", profileId).maybeSingle(),
        "read clinician",
      )
    : null;
  if (!current) {
    step("create", "clinician record");
    if (DRY_RUN) return null;
    return must(
      await db.from("clinicians").insert({ profile_id: profileId, ...desired }).select("id").single(),
      "create clinician",
    ).id;
  }
  const changed = changedFields(current, desired);
  if (changed.length === 0) {
    step("ok", "clinician record", current.id);
  } else {
    step("update", "clinician record", `${current.id} (${changed.join(", ")})`);
    if (!DRY_RUN) must(await db.from("clinicians").update(pick(desired, changed)).eq("id", current.id), "update clinician");
  }
  return current.id;
}

async function ensureCareTeamLink(db, clinicianId, patientId, clinicId) {
  const desired = { clinic_id: clinicId, relationship: "primary", is_active: true };
  const current =
    clinicianId && patientId
      ? must(
          await db
            .from("care_team_links")
            .select("id, clinic_id, relationship, is_active")
            .eq("clinician_id", clinicianId)
            .eq("patient_id", patientId)
            .maybeSingle(),
          "read care team link",
        )
      : null;
  if (!current) {
    step("create", "care team link", "clinician → patient, active");
    if (DRY_RUN) return null;
    return must(
      await db
        .from("care_team_links")
        .insert({ clinician_id: clinicianId, patient_id: patientId, ...desired })
        .select("id")
        .single(),
      "create care team link",
    ).id;
  }
  const changed = changedFields(current, desired);
  if (changed.length === 0) {
    step("ok", "care team link", current.id);
  } else {
    step("update", "care team link", `${current.id} (${changed.join(", ")})`);
    if (!DRY_RUN) must(await db.from("care_team_links").update(pick(desired, changed)).eq("id", current.id), "update care team link");
  }
  return current.id;
}

/** Today lists the active prescriptions of the patient's newest active program, so reuse that one if it exists. */
async function ensureProgram(db, patientId, clinicId, clinicianId) {
  const current = patientId
    ? must(
        await db
          .from("programs")
          .select("id, title")
          .eq("patient_id", patientId)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "read program",
      )
    : null;
  if (current) {
    step("ok", "active program", current.id);
    return current.id;
  }
  step("create", "active program", PROGRAM_TITLE);
  if (DRY_RUN) return null;
  return must(
    await db
      .from("programs")
      .insert({ patient_id: patientId, clinic_id: clinicId, title: PROGRAM_TITLE, status: "active", created_by: clinicianId })
      .select("id")
      .single(),
    "create program",
  ).id;
}

async function ensurePrescription(db, { programId, patientId, clinicId, exerciseId, clinicianId }) {
  const desired = { dose: PRESCRIPTION_DOSE, prescribed_by: clinicianId };
  const current =
    programId && exerciseId
      ? must(
          await db
            .from("prescriptions")
            .select("id, dose, prescribed_by")
            .eq("program_id", programId)
            .eq("exercise_id", exerciseId)
            .eq("status", "active")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
          "read prescription",
        )
      : null;
  if (!current) {
    step("create", `active prescription ${EXERCISE.slug}`, `dose ${JSON.stringify(PRESCRIPTION_DOSE)}`);
    if (DRY_RUN) return null;
    return must(
      await db
        .from("prescriptions")
        .insert({
          program_id: programId,
          patient_id: patientId,
          clinic_id: clinicId,
          exercise_id: exerciseId,
          status: "active",
          ...desired,
        })
        .select("id")
        .single(),
      "create prescription",
    ).id;
  }
  const changed = changedFields(current, desired);
  if (changed.length === 0) {
    step("ok", `active prescription ${EXERCISE.slug}`, current.id);
  } else {
    step("update", `active prescription ${EXERCISE.slug}`, `${current.id} (${changed.join(", ")})`);
    if (!DRY_RUN) must(await db.from("prescriptions").update(pick(desired, changed)).eq("id", current.id), "update prescription");
  }
  return current.id;
}

// ── Main ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  if (ARGS.has("--help") || ARGS.has("-h")) {
    console.log(usage());
    return 0;
  }
  const unknown = [...ARGS].filter((arg) => !KNOWN_ARGS.has(arg));
  if (unknown.length > 0) {
    console.error(`seed:heel-slide: unknown argument ${unknown.join(" ")}\n\n${usage()}`);
    return 2;
  }

  loadEnvFile(ENV_FILE);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("seed:heel-slide: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (env or .env.local)");
    return 2;
  }
  // patient_ble_devices stores lateralized roles (l_thigh / r_thigh …), so the path needs a definite side.
  const side = (process.env.HEEL_SLIDE_SIDE || "right").trim().toLowerCase();
  if (side !== "left" && side !== "right") {
    console.error("seed:heel-slide: HEEL_SLIDE_SIDE must be left or right");
    return 2;
  }
  const accounts = [
    {
      role: "clinician",
      email: (process.env.HEEL_SLIDE_CLINICIAN_EMAIL || DEFAULT_CLINICIAN_EMAIL).trim().toLowerCase(),
      passwordVar: "HEEL_SLIDE_CLINICIAN_PASSWORD",
      fullName: "Heel Slide test clinician",
      user: null,
    },
    {
      role: "patient",
      email: (process.env.HEEL_SLIDE_PATIENT_EMAIL || DEFAULT_PATIENT_EMAIL).trim().toLowerCase(),
      passwordVar: "HEEL_SLIDE_PATIENT_PASSWORD",
      fullName: "Heel Slide test patient",
      user: null,
    },
  ];
  const [clinicianAccount, patientAccount] = accounts;
  if (clinicianAccount.email === patientAccount.email) {
    console.error("seed:heel-slide: the patient and clinician emails must differ");
    return 2;
  }

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  console.log(`Heel Slide test data on ${new URL(url).host}${DRY_RUN ? " (dry run: nothing is written)" : ""}`);

  const blockers = await preflight(db, accounts);
  if (blockers.length > 0) {
    console.log("\nPreconditions not met:");
    for (const blocker of blockers) console.log(`  - ${blocker}`);
    if (!DRY_RUN) {
      console.log("\nNothing was written.");
      return 1;
    }
    console.log("\nPlan as the database stands now:");
  } else {
    console.log("\nPreconditions met.\n");
  }

  const exerciseId = await ensureExercise(db);
  const clinicId = await ensureClinic(db);
  const clinicianProfileId = await ensureAccount(db, clinicianAccount, clinicId);
  const clinicianId = await ensureClinician(db, clinicianProfileId, clinicId);
  const patientProfileId = await ensureAccount(db, patientAccount, clinicId);
  const patientId = await ensurePatient(db, patientProfileId, clinicId, side);
  const linkId = await ensureCareTeamLink(db, clinicianId, patientId, clinicId);
  const programId = await ensureProgram(db, patientId, clinicId, clinicianId);
  const prescriptionId = await ensurePrescription(db, { programId, patientId, clinicId, exerciseId, clinicianId });

  const show = (id) => id ?? "(not created yet)";
  console.log("");
  console.log(`exercise        ${show(exerciseId)}`);
  console.log(`clinic          ${show(clinicId)}`);
  console.log(`clinician       ${clinicianAccount.email}  profile ${show(clinicianProfileId)}  clinician ${show(clinicianId)}`);
  console.log(`patient         ${patientAccount.email}  profile ${show(patientProfileId)}  patient ${show(patientId)}  side ${side}`);
  console.log(`care team link  ${show(linkId)}`);
  console.log(`program         ${show(programId)}`);
  console.log(`prescription    ${show(prescriptionId)}`);
  if (prescriptionId) console.log(`patient start   /app/session/new/${prescriptionId}`);
  if (patientId) console.log(`clinician view  /clinician/patient/${patientId}`);

  if (DRY_RUN) return blockers.length > 0 ? 1 : 0;
  console.log("\nDone.");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`seed:heel-slide: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
