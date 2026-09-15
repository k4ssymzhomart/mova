import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type CheckInAnswers,
  checkInRpcArgs,
  firstMissing,
  INITIAL_ANSWERS,
  isScaleAnswer,
  missingAnswers,
  parseStoredCheckIn,
  SCALE_VALUES,
  storedMatchesSent,
  submitErrorFor,
  toggleSymptom,
} from "./answers.ts";

const answered: CheckInAnswers = {
  ...INITIAL_ANSWERS,
  painBefore: 2,
  painAfter: 5,
  difficulty: 6,
  kneeFeels: "same",
  symptoms: ["none"],
};

test("starts with every question unanswered, no preset scale values", () => {
  assert.deepEqual(INITIAL_ANSWERS, {
    painBefore: null,
    painAfter: null,
    difficulty: null,
    kneeFeels: null,
    symptoms: [],
    otherNote: "",
  });
  assert.deepEqual(missingAnswers(INITIAL_ANSWERS), {
    painBefore: true,
    painAfter: true,
    difficulty: true,
    kneeFeels: true,
    symptoms: true,
  });
  assert.equal(checkInRpcArgs("s1", INITIAL_ANSWERS, "ru"), null);
});

test("the scale offers each whole number from 0 to 10 once", () => {
  assert.deepEqual(SCALE_VALUES, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(isScaleAnswer(0), true);
  assert.equal(isScaleAnswer(10), true);
  assert.equal(isScaleAnswer(null), false);
  assert.equal(isScaleAnswer(-1), false);
  assert.equal(isScaleAnswer(11), false);
  assert.equal(isScaleAnswer(2.5), false);
});

test("nothing is sent while any scale is unanswered", () => {
  for (const question of ["painBefore", "painAfter", "difficulty"] as const) {
    const answers = { ...answered, [question]: null };
    assert.equal(checkInRpcArgs("s1", answers, "ru"), null, question);
    assert.equal(missingAnswers(answers)[question], true, question);
    assert.equal(firstMissing(missingAnswers(answers)), question);
  }
});

test("0 is an answer, not a missing one", () => {
  const zeros = { ...answered, painBefore: 0, painAfter: 0, difficulty: 0 };
  assert.deepEqual(missingAnswers(zeros), {
    painBefore: false,
    painAfter: false,
    difficulty: false,
    kneeFeels: false,
    symptoms: false,
  });
  const args = checkInRpcArgs("s1", zeros, "en");
  assert.equal(args?.p_pain_before, 0);
  assert.equal(args?.p_pain_after, 0);
  assert.equal(args?.p_difficulty, 0);
});

test("the first missing answer follows the form's order", () => {
  assert.equal(firstMissing(missingAnswers(INITIAL_ANSWERS)), "painBefore");
  assert.equal(firstMissing(missingAnswers({ ...answered, kneeFeels: null, symptoms: [] })), "kneeFeels");
  assert.equal(firstMissing(missingAnswers({ ...answered, symptoms: [] })), "symptoms");
  assert.equal(firstMissing(missingAnswers(answered)), null);
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
  assert.deepEqual(missingAnswers({ ...answered, symptoms: [] }), {
    painBefore: false,
    painAfter: false,
    difficulty: false,
    kneeFeels: false,
    symptoms: true,
  });
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

test("the row the RPC answers with is read as a stored check-in; anything else is not one", () => {
  const row = {
    id: "row",
    session_id: "s",
    pain_before: 2,
    pain_after: 5,
    difficulty: 6,
    knee_feels: "same",
    symptoms: ["other", "redness"],
    other_note: "stiff",
    language: "ru",
  };
  assert.deepEqual(parseStoredCheckIn(row), {
    painBefore: 2,
    painAfter: 5,
    difficulty: 6,
    kneeFeels: "same",
    symptoms: ["redness", "other"],
    otherNote: "stiff",
  });
  assert.equal(parseStoredCheckIn([row])?.painAfter, 5);
  assert.equal(parseStoredCheckIn({ ...row, other_note: "" })?.otherNote, null);
  assert.equal(parseStoredCheckIn(null), null);
  assert.equal(parseStoredCheckIn([]), null);
  assert.equal(parseStoredCheckIn({ ...row, pain_after: null }), null);
  assert.equal(parseStoredCheckIn({ ...row, difficulty: 11 }), null);
  assert.equal(parseStoredCheckIn({ ...row, knee_feels: "worse" }), null);
  assert.equal(parseStoredCheckIn({ ...row, symptoms: ["none"] }), null);
  assert.equal(parseStoredCheckIn({ ...row, other_note: 3 }), null);
});

test("a stored row that differs from the answers sent means an earlier check-in was kept", () => {
  const args = checkInRpcArgs("s", { ...answered, symptoms: ["other", "redness"], otherNote: " stiff " }, "ru");
  assert.ok(args);
  const stored = parseStoredCheckIn({
    pain_before: 2,
    pain_after: 5,
    difficulty: 6,
    knee_feels: "same",
    symptoms: ["redness", "other"],
    other_note: "stiff",
  });
  assert.ok(stored);
  assert.equal(storedMatchesSent(args, stored), true, "same answers, symptoms in another order");
  assert.equal(storedMatchesSent(args, { ...stored, painBefore: 3 }), false);
  assert.equal(storedMatchesSent(args, { ...stored, painAfter: 7 }), false);
  assert.equal(storedMatchesSent(args, { ...stored, difficulty: 0 }), false);
  assert.equal(storedMatchesSent(args, { ...stored, kneeFeels: "better" }), false);
  assert.equal(storedMatchesSent(args, { ...stored, symptoms: ["redness"] }), false);
  assert.equal(storedMatchesSent(args, { ...stored, otherNote: null }), false);

  const none = checkInRpcArgs("s", answered, "en");
  assert.ok(none);
  assert.equal(storedMatchesSent(none, { ...stored, symptoms: [], otherNote: null }), true, "none is stored as an empty list");
  assert.equal(storedMatchesSent(none, stored), false);
});
