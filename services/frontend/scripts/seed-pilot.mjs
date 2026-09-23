// Create one clinician and one patient for a pilot, in a clinic of their own.
//
// What it makes, and nothing else: a clinic, two accounts with confirmed e-mail addresses, the clinician's and
// the patient's records, an active care-team link between them, one programme, and one active prescription per
// published catalogue exercise. It never touches another clinic, never grants an admin role, and never deletes.
//
// It is idempotent: run it twice and the second run reports what already existed. Passwords are only ever set on
// creation, or when --reset-password is given, and they are printed once, here, to whoever ran the script.
//
//   node scripts/seed-pilot.mjs --doctor doctor@example.org --patient patient@example.org
//   node scripts/seed-pilot.mjs --dry-run
//   node scripts/seed-pilot.mjs --clinic "Пилот НИИТО" --doctor … --patient … --reset-password
//
// Environment (services/frontend/.env.local is read when the process environment does not carry them):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required — the key bypasses row-level security.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
loadEnvFile(resolve(root, ".env.local"));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith("--") ? argv[at + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

if (has("help") || has("h")) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(0, 16).join("\n"));
  process.exit(0);
}

const DRY_RUN = has("dry-run");
const RESET_PASSWORD = has("reset-password");
const CLINIC_NAME = flag("clinic", "Пилот Mova");
const CLINIC_SLUG = flag("clinic-slug", "pilot");
const DOCTOR_EMAIL = (flag("doctor", "pilot-doctor@mova.test") ?? "").trim().toLowerCase();
const PATIENT_EMAIL = (flag("patient", "pilot-patient@mova.test") ?? "").trim().toLowerCase();
const DOCTOR_NAME = flag("doctor-name", "Врач пилота");
const PATIENT_NAME = flag("patient-name", "Пациент пилота");
const SIDE = flag("side", "right");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("seed-pilot: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}
for (const [label, email] of [["doctor", DOCTOR_EMAIL], ["patient", PATIENT_EMAIL]]) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`seed-pilot: the ${label} address ${JSON.stringify(email)} is not an e-mail address.`);
    process.exit(2);
  }
}
if (DOCTOR_EMAIL === PATIENT_EMAIL) {
  console.error("seed-pilot: the doctor and the patient need different addresses.");
  process.exit(2);
}
if (!["left", "right"].includes(SIDE)) {
  console.error('seed-pilot: --side takes "left" or "right".');
  process.exit(2);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const say = (what, detail) => console.log(`  ${what.padEnd(14)} ${detail}`);
const must = (result, what) => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
};
/** A password a person can read out over the phone once and never again. */
const newPassword = () => randomBytes(18).toString("base64url");

async function findUserByEmail(email) {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const data = must(await db.auth.admin.listUsers({ page, perPage }), "list users");
    const found = data.users.find((user) => (user.email ?? "").toLowerCase() === email);
    if (found) return found;
    if (data.users.length < perPage) return null;
  }
}

async function ensureClinic() {
  const existing = must(
    await db.from("clinics").select("id, name").eq("slug", CLINIC_SLUG).maybeSingle(),
    "read clinic",
  );
  if (existing) {
    say("clinic", `${existing.name} (exists, ${existing.id})`);
    return existing.id;
  }
  if (DRY_RUN) {
    say("clinic", `${CLINIC_NAME} (would create)`);
    return null;
  }
  const created = must(
    await db.from("clinics").insert({ name: CLINIC_NAME, slug: CLINIC_SLUG, timezone: "Asia/Almaty" }).select("id").single(),
    "create clinic",
  );
  say("clinic", `${CLINIC_NAME} (created, ${created.id})`);
  return created.id;
}

/** The auth user, its profile role and clinic. Returns { id, password } — password only when it was just set. */
async function ensureAccount({ email, role, fullName, clinicId }) {
  const existing = await findUserByEmail(email);
  let password = null;
  let userId = existing?.id ?? null;

  if (!existing) {
    password = newPassword();
    if (DRY_RUN) {
      say(role, `${email} (would create)`);
      return { id: null, password: null };
    }
    const created = must(
      await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        // The role never comes from signup metadata (migration 0035); it is set on the profile below.
        user_metadata: { full_name: fullName },
      }),
      `create ${role}`,
    );
    userId = created.user.id;
    say(role, `${email} (created, ${userId})`);
  } else {
    say(role, `${email} (exists, ${userId})`);
    if (RESET_PASSWORD && !DRY_RUN) {
      password = newPassword();
      must(await db.auth.admin.updateUserById(userId, { password, email_confirm: true }), `reset ${role} password`);
      say("", "password reset");
    }
  }

  if (!DRY_RUN) {
    // The signup trigger has already made a profile in a personal clinic (0036); move it into the pilot clinic
    // and set the role. Both are admin-only operations, which the service role is.
    must(
      await db.from("profiles").update({ role, clinic_id: clinicId, full_name: fullName }).eq("id", userId),
      `set ${role} profile`,
    );
  }
  return { id: userId, password };
}

async function ensureClinician(profileId, clinicId) {
  const existing = must(
    await db.from("clinicians").select("id").eq("profile_id", profileId).maybeSingle(),
    "read clinician",
  );
  if (existing) {
    say("clinician row", existing.id);
    return existing.id;
  }
  if (DRY_RUN) return null;
  const created = must(
    await db
      .from("clinicians")
      .insert({ profile_id: profileId, clinic_id: clinicId, title: "Врач", specialties: ["orthopaedics"] })
      .select("id")
      .single(),
    "create clinician",
  );
  say("clinician row", `${created.id} (created)`);
  return created.id;
}

async function ensurePatient(profileId, clinicId) {
  const existing = must(await db.from("patients").select("id").eq("profile_id", profileId).maybeSingle(), "read patient");
  if (existing) {
    if (!DRY_RUN) {
      must(await db.from("patients").update({ clinic_id: clinicId, affected_side: SIDE }).eq("id", existing.id), "move patient");
    }
    say("patient row", existing.id);
    return existing.id;
  }
  if (DRY_RUN) return null;
  const created = must(
    await db
      .from("patients")
      .insert({ profile_id: profileId, clinic_id: clinicId, enrollment_status: "active", affected_side: SIDE, mrn: `PILOT-${Date.now().toString(36).toUpperCase()}` })
      .select("id")
      .single(),
    "create patient",
  );
  say("patient row", `${created.id} (created)`);
  return created.id;
}

async function ensureLink(clinicId, clinicianId, patientId) {
  const existing = must(
    await db.from("care_team_links").select("id, is_active").eq("clinician_id", clinicianId).eq("patient_id", patientId).maybeSingle(),
    "read care-team link",
  );
  if (existing) {
    if (!existing.is_active && !DRY_RUN) {
      must(await db.from("care_team_links").update({ is_active: true }).eq("id", existing.id), "reactivate link");
    }
    say("care team", `${existing.id} (exists)`);
    return;
  }
  if (DRY_RUN) return;
  const created = must(
    await db
      .from("care_team_links")
      .insert({ clinic_id: clinicId, clinician_id: clinicianId, patient_id: patientId, relationship: "primary", is_active: true })
      .select("id")
      .single(),
    "create care-team link",
  );
  say("care team", `${created.id} (created)`);
}

async function ensureProgram(patientId, clinicId, clinicianId) {
  const existing = must(
    await db.from("programs").select("id").eq("patient_id", patientId).eq("status", "active").maybeSingle(),
    "read programme",
  );
  if (existing) {
    say("programme", `${existing.id} (exists)`);
    return existing.id;
  }
  if (DRY_RUN) return null;
  const created = must(
    await db
      .from("programs")
      .insert({ patient_id: patientId, clinic_id: clinicId, title: "Программа пилота", status: "active", created_by: clinicianId ? undefined : undefined })
      .select("id")
      .single(),
    "create programme",
  );
  say("programme", `${created.id} (created)`);
  return created.id;
}

async function ensurePrescriptions(patientId, clinicId, programId) {
  const exercises = must(
    await db.from("exercises").select("id, slug, default_dose, difficulty").eq("is_published", true).order("slug"),
    "read exercises",
  );
  const existing = must(
    await db.from("prescriptions").select("exercise_id, status").eq("patient_id", patientId),
    "read prescriptions",
  );
  const active = new Set(existing.filter((row) => row.status === "active").map((row) => row.exercise_id));
  const missing = exercises.filter((exercise) => !active.has(exercise.id));
  if (missing.length === 0) {
    say("prescriptions", `${active.size} active (nothing to add)`);
    return;
  }
  if (DRY_RUN) {
    say("prescriptions", `${active.size} active, would add ${missing.length}`);
    return;
  }
  must(
    await db.from("prescriptions").insert(
      missing.map((exercise) => ({
        patient_id: patientId,
        clinic_id: clinicId,
        program_id: programId,
        exercise_id: exercise.id,
        status: "active",
        dose: exercise.default_dose ?? { reps: 10 },
        frequency_per_week: 3,
        difficulty: exercise.difficulty,
      })),
    ),
    "create prescriptions",
  );
  say("prescriptions", `${active.size} active, ${missing.length} added`);
}

async function main() {
  console.log(`seed-pilot: ${DRY_RUN ? "dry run — nothing is written" : "writing"} to ${url}`);
  const clinicId = await ensureClinic();
  const doctor = await ensureAccount({ email: DOCTOR_EMAIL, role: "clinician", fullName: DOCTOR_NAME, clinicId });
  const patient = await ensureAccount({ email: PATIENT_EMAIL, role: "patient", fullName: PATIENT_NAME, clinicId });
  if (DRY_RUN) {
    console.log("seed-pilot: dry run finished.");
    return;
  }
  const clinicianId = await ensureClinician(doctor.id, clinicId);
  const patientId = await ensurePatient(patient.id, clinicId);
  await ensureLink(clinicId, clinicianId, patientId);
  const programId = await ensureProgram(patientId, clinicId, clinicianId);
  await ensurePrescriptions(patientId, clinicId, programId);

  console.log("\nseed-pilot: done.");
  for (const [label, email, account] of [["Врач", DOCTOR_EMAIL, doctor], ["Пациент", PATIENT_EMAIL, patient]]) {
    if (account.password) {
      console.log(`  ${label}: ${email}   пароль: ${account.password}`);
    } else {
      console.log(`  ${label}: ${email}   пароль не менялся (--reset-password задаёт новый)`);
    }
  }
  console.log("\n  Пароли показаны один раз. Сохраните их и передавайте лично.");
}

main().catch((error) => {
  console.error(`seed-pilot: ${error.message}`);
  process.exit(1);
});
