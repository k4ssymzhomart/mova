import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EXERCISE_CATALOG } from "./catalog.ts";
import { catalogSlug, EXERCISE_IDS, PHOENIX_UNMAPPED, phoenixId, resolveExerciseIds, scoringSlug } from "./ids.ts";

// The Python side reads this file directly; ids.ts mirrors it by hand. This test is what keeps the
// two honest, so the mapping can never drift between the app and the analysis tooling.
const TABLE_URL = new URL("../../../../imu-tools/exercise_ids.json", import.meta.url);

interface Row {
  catalog: string;
  scoring: string | null;
  phoenix: string | null;
}

function canonical(): { exercises: Row[]; phoenix_unmapped: { ids: string[] } } {
  return JSON.parse(readFileSync(TABLE_URL, "utf8"));
}

test("ids.ts matches services/imu-tools/exercise_ids.json exactly", () => {
  const json = canonical();
  const fromJson = json.exercises.map((r) => ({
    catalog: r.catalog,
    scoring: r.scoring ?? null,
    phoenix: r.phoenix ?? null,
  }));
  assert.deepEqual(
    EXERCISE_IDS.map((r) => ({ catalog: r.catalog, scoring: r.scoring, phoenix: r.phoenix })),
    fromJson,
    "ids.ts and exercise_ids.json have drifted — the Python tools and the app would disagree",
  );
  assert.deepEqual([...PHOENIX_UNMAPPED], json.phoenix_unmapped.ids);
});

test("every id table row names a real catalog exercise, and every exercise has a row", () => {
  const catalogSlugs = EXERCISE_CATALOG.map((e) => e.slug).sort();
  const tableSlugs = EXERCISE_IDS.map((r) => r.catalog).sort();
  assert.deepEqual(tableSlugs, catalogSlugs, "the id table and the catalog list different exercises");
});

test("no id is used twice in any space", () => {
  for (const space of ["catalog", "scoring", "phoenix"] as const) {
    const values = EXERCISE_IDS.map((r) => r[space]).filter((v): v is string => v !== null);
    assert.equal(new Set(values).size, values.length, `${space}: duplicate id`);
  }
});

test("a scored exercise has a scoring id, an unscored one does not", () => {
  for (const entry of EXERCISE_CATALOG) {
    const row = resolveExerciseIds(entry.slug);
    assert.ok(row, `${entry.slug}: no id row`);
    assert.equal(
      row.scoring !== null,
      entry.scored,
      `${entry.slug}: scored=${entry.scored} but scoring id ${row.scoring}`,
    );
  }
});

test("lookups round-trip across all three spaces", () => {
  for (const row of EXERCISE_IDS) {
    assert.equal(catalogSlug(row.catalog), row.catalog);
    if (row.scoring) {
      assert.equal(catalogSlug(row.scoring), row.catalog);
      assert.equal(scoringSlug(row.catalog), row.scoring);
    }
    if (row.phoenix) {
      assert.equal(catalogSlug(row.phoenix), row.catalog);
      assert.equal(phoenixId(row.catalog), row.phoenix);
    }
  }
});

test("an unknown id is undefined rather than guessed", () => {
  // `heel-slide` and `heel_slide` differ by one character and are two different things here.
  assert.equal(resolveExerciseIds("heel slide"), undefined);
  assert.equal(resolveExerciseIds("exercise-heel-slide"), undefined);
  assert.equal(phoenixId("quad-set"), undefined, "quad-set has no PHOENIX signal profile");
});
