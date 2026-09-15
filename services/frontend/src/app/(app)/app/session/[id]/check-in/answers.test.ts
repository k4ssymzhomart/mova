import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type CheckInAnswers,
  checkInRpcArgs,
  INITIAL_ANSWERS,
  missingAnswers,
  submitErrorFor,
  toggleSymptom,
} from "./answers.ts";

const answered: CheckInAnswers = { ...INITIAL_ANSWERS, kneeFeels: "same", symptoms: ["none"] };

test("starts from Phoenix's defaults with nothing chosen", () => {
  assert.deepEqual(INITIAL_ANSWERS, {
    painBefore: 0,
    painAfter: 0,
    difficulty: 3,
    kneeFeels: null,
    symptoms: [],
    otherNote: "",
  });
  assert.deepEqual(missingAnswers(INITIAL_ANSWERS), { kneeFeels: true, symptoms: true });
});

test('"none" is exclusive in both directions', () => {
  assert.deepEqual(toggleSymptom(["swelling", "redness"], "none"), ["none"]);
  assert.deepEqual(toggleSymptom(["none"], "calf_pain"), ["calf_pain"]);
  assert.deepEqual(toggleSymptom(["none"], "none"), []);
});

test("symptoms toggle on and off in the order picked", () => {
  assert.deepEqual(toggleSymptom([], "redness"), ["redness"]);
  assert.deepEqual(toggleSymptom(["redness"], "swelling"), ["redness", "swelling"]);
  assert.deepEqual(toggleSymptom(["redness", "swelling"], "redness"), ["swelling"]);
});

test("nothing is sent while how the knee feels or the symptoms are unanswered", () => {
  assert.equal(checkInRpcArgs("s1", { ...answered, kneeFeels: null }, "ru"), null);
  assert.equal(checkInRpcArgs("s1", { ...answered, symptoms: [] }, "ru"), null);
  assert.deepEqual(missingAnswers({ ...answered, symptoms: [] }), { kneeFeels: false, symptoms: true });
});

test('"none" is sent as an empty list, with the answers and language as given', () => {
  assert.deepEqual(
    checkInRpcArgs("s1", { ...answered, painBefore: 4, painAfter: 6, difficulty: 7, kneeFeels: "much_worse" }, "kk"),
    {
      p_session: "s1",
      p_pain_before: 4,
      p_pain_after: 6,
      p_difficulty: 7,
      p_knee_feels: "much_worse",
      p_symptoms: [],
      p_other_note: null,
      p_language: "kk",
    },
  );
});

test('the note goes only with "other", trimmed, and an empty note is null', () => {
  const withOther = { ...answered, symptoms: ["swelling", "other"] as const, otherNote: "  тянет под коленом \n" };
  assert.equal(checkInRpcArgs("s1", withOther, "ru")?.p_other_note, "тянет под коленом");
  assert.deepEqual(checkInRpcArgs("s1", withOther, "ru")?.p_symptoms, ["swelling", "other"]);
  assert.equal(checkInRpcArgs("s1", { ...withOther, otherNote: "   " }, "ru")?.p_other_note, null);
  // Typed, then "other" unticked: the note stays in the form but is not sent.
  assert.equal(checkInRpcArgs("s1", { ...withOther, symptoms: ["swelling"] }, "ru")?.p_other_note, null);
});

test("RPC error codes map to patient reasons, anything else is a failed send", () => {
  assert.equal(submitErrorFor("55000"), "notCompleted");
  assert.equal(submitErrorFor("42501"), "notAllowed");
  assert.equal(submitErrorFor("22023"), "invalid");
  assert.equal(submitErrorFor("PGRST202"), "failed");
  assert.equal(submitErrorFor(""), "failed");
  assert.equal(submitErrorFor(undefined), "failed");
});
