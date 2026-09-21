# What comes next

This is the plan for the work after `feat/moving-exercise-scripts`. It is written for three people: whoever presents
the project, and the two people who will build it. It says what is on disk today, what to build, in what order, and
what nobody knows yet. Where two readings of the code disagreed, both are written down rather than smoothed over.

Nothing in this plan has been built. Every claim about the code names the file it came from, so any line here can be
checked in a minute.

## What exists today

`main` is `9bb9a14`. One exercise works end to end: Today, three sensors, Heel Slide with a live repetition count and
a drawing of the leg, the check-in, and the clinician's view of that session. The exercise library at `/exercises`
lists twelve exercises with fourteen clinician-recorded clips in `services/frontend/public/exercises`. The scoring
engine in `services/frontend/src/lib/scoring` is written and tested, and no patient screen uses it.

Two finished branches are waiting. Both merge cleanly into `main` and into each other; `git merge-tree --write-tree`
reports no conflict for any of the three pairings, and the two branches change no file in common.

Merge in this order, as one integration branch:

1. `origin/feature/deterministic-scoring-engine` — wires the stored score into the Heel Slide summary and the
   clinician view. Adds `lib/scoring/heelSlideStoredScore.ts`, `lib/scoring/loadHeelSlideStoredScore.server.ts` and
   `supabase/migrations/0041_session_scores.sql`. The migration has not been applied anywhere.
2. `origin/feat/moving-exercise-scripts` — adds `services/imu-tools` (the Phoenix IMU gateway, capture and analysis
   tools, repetition labelling, execution-score checks) and, in the frontend, five new exercises in
   `lib/exercises/catalog.ts`, the identity table `lib/exercises/ids.ts`, five configs in
   `lib/scoring/exerciseConfigs.ts`, and abstention inside `lib/scoring/correctnessScore.ts`.

Order matters only because the second branch makes `tempoRangeSec` nullable in `lib/scoring/types.ts` and patches
every consumer that indexes it (`correctnessScore.ts`, `cuePriority.ts`, `repDetector.ts`) on the same branch. The
scoring branch's new files never touch that field, so `tsc --noEmit` should pass either way. Merging the smaller
branch first keeps the type change and its fixes in one step.

### The Python files the handoff note names

The note points at `services/api/app/exercise_signals.py`, `services/api/app/execution_score.py` and
`services/api/migrations/versions/0023_execution_score_exercises.sql`. None of those paths exists in this repository,
on any branch, and none is missing work. `services/imu-tools/VENDORED.md` records what happened: the first two were
copied verbatim from Phoenix `feat/llm-feedback-two-tier` commit `1480ab0` and now live at
`services/imu-tools/src/mova_imu/analysis/exercise_signals.py` and `.../analysis/execution_score.py`. The migration
was deliberately not ported, because Phoenix's `exercise_definitions` / `organization_id` schema has no counterpart
here; its content — seven exercises, their positions and their required sensors — is
`services/frontend/src/lib/exercises/catalog.ts` instead. Do not write a migration for it.

The same file states a rule that binds the whole plan: files under `analysis/` and `gateway/` are vendored and are
not edited in mova. `services/imu-tools/README.md` adds that the Execution Score computed by the Python is an
engineering number that must not reach `services/frontend`, `session_metrics` or any clinician screen. The Python is
a measuring instrument for calibration, not a runtime dependency.

## The seven exercise pages

### Build one page, not seven

The route stays `services/frontend/src/app/(app)/app/session/[id]/exercise/page.tsx`. What varies per exercise goes
into a descriptor resolved from the session's own slug, not into seven routes.

The reason is that the flow chrome is already exercise-blind and URL-driven. `components/flow/steps.ts` parses the
flow from fixed URL positions (`parts[2]` is the session id, `parts[3]` the step). `app/(app)/app/session/layout.tsx`
mounts `SessionFlowFrame` once for all five steps. Every navigation in the app goes through
`stepHref(sessionId, step)` — in `HeelSlideExercise.tsx`, in `session/new/[prescriptionId]/SensorsStep.tsx`, in
`session/[id]/page.tsx`. A route per exercise would make every one of those calls need the slug, and would put the
exercise identity in the URL as a second source of truth that can disagree with the session row.

`HeelSlideExercise.tsx` is 713 lines and most of it is exercise-independent: the session-status re-read, the recorder
lifecycle, the reload-and-restart notice, the baseline window in `sessionStorage`, the outbox, the finish retry. That
code took real work to get right. Rename the component to `ExerciseSession`, give it an exercise descriptor, and do
not copy the file.

This is also the clean answer to a problem the note does not raise. Exercises 6 and 7 are indistinguishable in the
data: `exercise-ankle-pumps-active-v1` and `exercise-resisted-ankle-pump-v1` have the same sensors, the same signal
(foot pitch minus shank pitch) and the same thresholds in
`services/imu-tools/src/mova_imu/analysis/exercise_signals.py`. Nothing in the signal can tell a band from no band,
and nothing should try. The descriptor is keyed by the slug the server read from the session row, never inferred.

### What already exists per exercise, after the merge

| # | Exercise | Catalog entry | Scoring config | Clip attached | Sensors |
|---|---|---|---|---|---|
| 1 | Ball Knee Flexion | yes (branch) | `ball_knee_flexion` | `seated-ball-roll.mp4` | thigh, shank |
| 2 | Heel Slide With Band | yes (branch) | `heel_slide_with_band` | `supine-knee-flexion-strap.mp4` | thigh, shank |
| 3 | Supported Knee Raise | yes (branch) | `supported_knee_raise` | `supine-bend-and-raise-strap.mp4` | thigh, shank, foot |
| 4 | Lying Partial Leg Raise | no | no | none | thigh, shank |
| 5 | Lying Partial Leg Hold | no | no | none | thigh, shank |
| 6 | Ankle Pumps (Active) | yes (on `main`) | `ankle_pumps` | `ankle-dorsiflexion-strap.mp4`, probably wrong | shank, foot |
| 7 | Resisted Ankle Pump | yes (branch) | `resisted_ankle_pump` | `ankle-dorsiflexion-band.mp4` | shank, foot |

Exercises 4 and 5 are not merely missing. They are excluded on purpose. `lib/exercises/ids.ts` lists
`exercise-lying-partial-leg-raise-v1` and `exercise-lying-partial-leg-hold-v1` under `PHOENIX_UNMAPPED`, with the
comment that both are thigh-absolute raises mova has no clinician-recorded clip for. `ids.test.ts` reads
`services/imu-tools/exercise_ids.json` and fails if the identity table and the catalog list different exercises, so
adding a catalog entry without also moving the id out of `phoenix_unmapped` breaks the test suite. Shipping these two
is a clinical decision plus a filming job, not a coding task. They go last.

The branch also adds a sixth exercise the note does not list, `seated-knee-extension`, with a clip that certainly
shows that movement. It is the cheapest of the set and can ride along.

### Two corrections to the handoff note

The note says exercises 6 and 7 have no target, so they score on Volume alone. That is true of the Python and false of
this repository. `lib/scoring/exerciseConfigs.ts` gives `ankle_pumps` `targetValueDeg: 20` and
`minValidExcursionDeg: 8` on `main`, and the branch gives `resisted_ankle_pump` the same 20, with a comment admitting
the target was borrowed from `ankle-pumps` because a null target scores 0 rather than abstaining. `ankle_pumps` also
has a real `tempoRangeSec` of `[1.5, 4]`, so its Correctness does not abstain either. Both numbers need clinical
confirmation; see the questions at the end.

The note also says a component with no calibrated target is dropped and its weight redistributed. That describes
`assess_execution` in the vendored `analysis/execution_score.py`, which filters to components with a non-null score
and divides by the used weight. The TypeScript does not do this at the top level.
`lib/scoring/executionScore.ts` is one line:

```ts
export function executionEffectiveness(correctnessScore: number, volumeScore: number, targetScore: number): number {
  return Math.round(0.5 * correctnessScore + 0.2 * volumeScore + 0.3 * targetScore);
}
```

Three numbers, fixed weights, no abstention. Redistribution exists one level down, inside `correctnessScore.ts`, and
only there.

### The prerequisite: make «не оценивается» expressible

Today the app cannot say that a component was not measured, and the two places that would have to say it return a
number instead. `lib/scoring/targetScore.ts` ends its default branch with
`config.targetValueDeg === null ? 0 : atLeastRatio(...)` — a literal zero, which is exactly the outcome the note
forbids. `sessionCorrectnessScore` returns `0` when every component abstained, while `perRepCorrectnessScore` returns
`100` for the same input, so the live cue and the summary can contradict each other on one session.

There is a subtler problem in the same place, and it is worse than a zero. Four of the five new configs carry
`tempoRangeSec: null`, which makes tempo (weight 0.26 to 0.28) and controlled return (0.17 to 0.22) abstain.
`sessionCorrectnessScore` renormalizes over what is left and returns, say, 91. That 91 is computed from smoothness and
consistency alone, it is then carried at the full 0.50 Correctness weight, and nothing in the data or on the screen
says which half of the measurement was skipped. A plausible number with an undisclosed basis is harder to catch than
a zero.

The fix is in the shared scoring core, not in the seven pages:

- `perRepTargetScore` and `sessionTargetScore` return `number | null`.
- `sessionCorrectnessScore` returns `number | null`; `perRepCorrectnessScore` returns `null` instead of `100`.
- The four score fields on `SessionResult` in `lib/scoring/types.ts` become nullable.
- A new `executionScore({ correctness, volume, target })` accepts nulls, renormalizes over the used weights and
  returns `{ score, componentsUsed }`. Keep the existing three-number `executionEffectiveness` as a wrapper so the
  two worked examples pinned in `executionScore.test.ts` and `heelSlideStoredScore.ts` keep passing untouched.
- The UI renders a null component as «не оценивается» with a one-line reason, and renders `componentsUsed` so the
  patient and the clinician can see what the number was made of.
- `0041_session_scores.sql` declares the four score columns `not null check (… between 0 and 100)`. It has never been
  applied, so amend it in place: drop those NOT NULLs and add `components_used jsonb not null default '{}'`. Also
  drop the `Number(...) || 0` coercions in `heelSlideStoredScore.ts`, which would turn a stored null into a
  fabricated 0 on read. If 0041 has been applied in any environment by the time this starts, it becomes 0042.

Nothing else in this plan is safe to ship before this lands.

### The five places Heel Slide is welded in

**Four slug gates**, all comparing against the literal `"heel-slide"` from `app/(app)/app/session/_flow/load.ts:18`:
the sensors step refuses to open a session (`session/new/[prescriptionId]/page.tsx:73`), the exercise step renders
`StepPending` (`session/[id]/exercise/page.tsx:45`), the check-in renders `StepPending`
(`session/[id]/check-in/page.tsx:42`), and the library's Start button is gated by `STARTABLE_SLUG`
(`components/exercises/library.ts:14,118`). Each becomes a registry lookup: an exercise is startable when a runtime
descriptor exists for its slug.

**Signal quality hard-requires all three sensors, and fails silently.** `lib/ble/signalQuality.ts` computes
`missingRoles` over all three roles and, if any is absent, returns `level: "INVALID"` and `scoringPermitted: false`
before any other check. `lib/ble/sessionRecorder.ts` stamps that report onto every recorded frame's `quality`, and
`lib/scoring/useLiveScoring.ts` treats `scoringPermitted: false` as frozen and never unfreezes. Six of the seven
exercises use two sensors. Without a fix, every one of them would write a wrong number — zero — into
`session_frames.quality` for the whole session, and show an Execution Score frozen from the first frame. This is the
highest-risk item in the plan. `evaluateSignalQuality` must take the exercise's required roles as an argument.

**Readiness is computed three times over a hard-coded three-role list**: `lib/ble/liveSensors.ts` (`allStreaming`),
`lib/sensors/useSensorStatus.ts`, and `components/flow/sensorsReady.ts`, which only ever receives the boolean. Add a
`streamingFor(snapshot, roles)` selector rather than redefining `allStreaming`, whose meaning is pinned by
`liveSensors.test.ts`. `sensorsStepReady` takes the required roles.

**The counting pair is a constant.** `components/flow/exerciseStatus.ts` has
`COUNTING_ROLES = ["thigh", "shank"]` and exactly three pause strings (thigh, shank, both). Ankle work needs shank and
foot, which means two more strings in all three locale files.

**The motion signal is fixed to the knee.** `lib/motion/flexion.ts` documents its proxy as
`wrap(shank.pitch - thigh.pitch)` and nothing else. Exercises 4 and 5 need an absolute thigh pitch, and 6 and 7 need
foot minus shank; the vendored `exercise_signals.py` gives all three shapes. Add a pure `lib/motion/signal.ts` that
generalizes the pairer to `{ kind: "relative", distal, proximal }` and `{ kind: "absolute", role }`, reusing the
existing wrap, circular-median baseline and orienter unchanged, and make `flexion.ts` the knee-shaped caller of it.
That way the recorded walkthrough's numbers cannot move.

**The guide is one drawing.** `components/flow/HeelSlideGuide.tsx` and `lib/motion/legGuide.ts` solve a supine leg with
the heel pinned to a bed line, clamped 0 to 120 degrees, from a single scalar. A seated ball roll, a partial leg raise
and an ankle pump are three different pictures. Each descriptor names its own guide; where no drawing exists yet, show
the reference clip and the counter and no drawing, rather than the wrong drawing.

### Two more things that are missing, and one that is doubled

The hold at the top is not measured for exercise 3 (0.5 s) or exercise 5 (3 s). `lib/scoring/repDetector.ts` only
enters the `HOLDING` phase when `config.targetType === "hold"`, which is Quad Set alone. Both of these are
`at_least` with a `holdTargetSec`, so the state machine goes RISING to RETURNING, `holdSec` stays 0, and
`correctnessScore.ts` then scores a 0.21-weighted hold component as zero for a hold nothing ever tried to measure.
Measure it without a new phase: while RISING, accumulate the time spent within the noise band of the running peak and
above `minValidExcursionDeg`. That is derivable from samples already buffered and cannot invent a hold.

There are two repetition detectors. `lib/motion/reps.ts` is the hysteresis counter the patient sees and the clinician
recounts with. `lib/scoring/repDetector.ts` is the scoring engine's and is wired to no patient route.
`heelSlideStoredScore.ts` says in its header that it will not run `RepDetector`, because a second never-validated
counter would risk a repetition count that disagrees with both of the others. Keep that arrangement: `reps.ts` stays
the counter and the boundary source, and the per-repetition features come from each segment's own samples.

The clinician cannot recount an ankle exercise. `supabase/migrations/0034_heel_slide_path.sql` builds the thigh and
shank series in `clinician_session_result` but emits only `frames.foot_count`, a count with no series. Exercises 6 and
7 need a migration adding `frames.foot` as a series, keeping `foot_count` for compatibility. Number it 0042, and
applying it to production is a separate decision that needs its own approval.

### How a prescription drives a page

Nothing in the data model needs to change for this. `start_prescribed_session` in `0034_heel_slide_path.sql` already
writes `exercise_id` and `prescription_id` onto the session row, and `loadSessionExercise` in `_flow/load.ts` already
returns the slug, the scoring rubric and the target repetitions to the page. What is new is a registry:

```
lib/exercises/runtime.ts   slug -> { signal, countingRoles, requiredRoles, thresholds, guide, copyKeys, scoringSlug }
```

resolved once on the server, passed to `ExerciseSession` as a prop. The catalog stays the source of names, positions,
sensors, cues and clips; `exerciseConfigs.ts` stays the source of scoring parameters; `ids.ts` stays the one place
that maps the three id spaces. The registry only joins them and adds the four runtime things none of them holds: the
signal shape, the guide, the pause copy and the required roles.

Order of build, and roughly what each costs:

1. The scoring-core nullability and `componentsUsed`, plus the amended 0041. Two days. Nothing ships before it.
2. The signal-quality role fix, the readiness selector and the configurable counting pair. Two days, mostly tests.
3. `ExerciseSession` plus the registry, with Heel Slide as the only entry, proving the recorded walkthrough still
   passes unchanged. Two to three days.
4. Exercise 7, Resisted Ankle Pump, as the first two-sensor page: it exercises the ankle signal, the foot role and
   the new pause copy. Two days.
5. Exercises 1, 2, 3 and the bonus seated knee extension, which share the knee signal and differ only in copy,
   target and the hold. One day each after the first.
6. Exercise 6, Ankle Pumps (Active), once its clip question is settled. Half a day.
7. Exercises 4 and 5, behind the clinical gate and the filming. Two days, plus the absolute-thigh signal.

## Videos

### The framing bug comes first

Every card and detail view renders its clip in a 16:9 box with `object-cover`:
`components/exercises/ExerciseCardMedia.tsx` uses `aspect-video` on the wrapper and `object-cover` on both the video
and the poster, and `ExerciseDetailDialog.tsx` does the same. Measured from the files, nine of the fourteen posters
are portrait — eight at 576×1024 and the overview at 464×832 — and five are landscape at 1024×576. A 9:16 source
cover-cropped into a 16:9 frame shows 31.6 per cent of its height. For `seated-knee-flexion`, `step-up` and
`walking-gait-front-side`, all three live on `main` today, that band is a torso with no legs. The exercise is cropped
out of its own video.

The correct treatment already exists one file away. `components/exercises/LibraryOverviewVideo.tsx` uses
`aspect-[464/832]` with `object-contain`, because someone already hit this with the overview clip. Carry each asset's
real aspect ratio through the card, the dialog and the reference player, and switch to `object-contain` on a
paper-soft surface. `components/exercises/media.ts` currently holds a single hand-tuned override, `CLIP_FOCUS` for
`/exercises/heel-slide.mp4` at `50% 58%`, which is right for that one letterboxed file and does not generalize.

Do this before attaching any new clip. Landing the branch's five pairings without it takes the count of broken cards
from three to six.

### Which clip belongs to which exercise

`catalog.test.ts` on the branch pins the pairings in `CONFIRMED_CLIPS`. A second, independent read of the poster
frames agreed with some and not others. Both readings are given here; where they differ, the clinician decides.

| # | Exercise | Clip | Confidence |
|---|---|---|---|
| 1 | Ball Knee Flexion | `seated-ball-roll.mp4` | likely. Seated, foot on a ball, side view. The movement matches; the setup is a high plinth, not a home chair. |
| 2 | Heel Slide With Band | `supine-knee-flexion-strap.mp4` | ask the clinician. The poster shows the heel off the bed and the thigh coming toward the chest. A heel slide keeps the heel on the bed. |
| 3 | Supported Knee Raise | `supine-bend-and-raise-strap.mp4` | likely, needs a trim. The clip contains two movements; cut it to the raise. |
| 4 | Lying Partial Leg Raise | none | must be filmed. |
| 5 | Lying Partial Leg Hold | none | must be filmed. |
| 6 | Ankle Pumps (Active) | `ankle-dorsiflexion-strap.mp4`, attached on `main` | probably wrong. The poster shows long sitting with a strap round the forefoot pulled by hand. That is assisted; the exercise is active. |
| 7 | Resisted Ankle Pump | `ankle-dorsiflexion-band.mp4` | likely. Seated, knee at about 90 degrees, band under the forefoot. Which direction the band resists is not readable from one frame and changes the cue text. |
| — | Seated Knee Extension | `seated-knee-extension.mp4` | certain. |

Do not borrow `straight-leg-raise.mp4` for exercises 4 and 5. It shows a full lift well past 15 degrees and is already
attached to a different exercise with a different target. Reusing it would teach the wrong amplitude, which is the
honesty problem in video form.

Until a clip is confirmed, the honest state is the existing «Видео скоро» frame, not a plausible-looking substitute.

### What must be filmed, and how

Three clips are needed: Lying Partial Leg Raise, Lying Partial Leg Hold, and an unassisted supine Ankle Pump. If the
clinician confirms that exercise 2's clip shows the wrong movement, a fourth.

Shooting notes, from what the existing files are: they are phone recordings, most of them portrait, encoded with x264
at `preset veryfast` and `crf=26` (the overview at `crf=30`). Keep the phone in one orientation for the whole set,
frame the whole limb from hip to foot, and shoot from the side for knee work and from the side or foot-end for ankle
work. Ten to fifteen seconds is enough; the player loops. There is no `ffmpeg` on the build machine at the moment, so
either install it or hand the raw files over as recorded — the current clips are used as recorded, without
re-encoding, and that is fine.

### Put a clip beside the live exercise

This is the part of «каждое видео надо, чтобы она работала» that matters most, and it is already written.
`feat/exercise-library` has a complete `services/frontend/src/components/flow/ReferenceVideo.tsx`: it looks the clip
up by slug through `exerciseBySlug`, renders nothing when there is no clip or the clip fails, honours
`prefers-reduced-motion`, and re-pauses when reduced motion is switched on mid-play. It was wired into the exercise
screen through one new prop. The locale keys exist in all three files on that branch, and `flow.referenceVideo` is
absent from `main`'s `ru.json`, `kk.json` and `en.json`.

Landing it is a targeted copy — one file, one prop, three locale entries per language — not a merge of that branch.
Note that the older `components/session/ReferenceVideo.tsx` on `main` is a different, orphaned component, imported by
nothing, and it carries both problems this plan fixes: `bg-night`, which breaks the white-and-green rule, and
`aspect-video ... object-cover`.

## Camera tracking

The request was a skeleton overlay that tracks whether the exercise is being done correctly. Part of it is buildable
now, honestly. Part of it is not, and saying so is cheaper than discovering it in front of a patient.

### What is already in the repository

`@mediapipe/tasks-vision` and `onnxruntime-web` are already dependencies in `services/frontend/package.json`. So no
new heavyweight library is needed. `src/lib/cv/` holds `landmarks.ts`, `drawSkeleton.ts`, `useMediaPipePose.ts`,
`imuWindow.ts` and `poseToImu.ts`, and `components/session/PoseStage.tsx` draws the result. All of it is from the gait
era and is wired only into `SessionStudio.tsx`, not into the knee-replacement flow.

Three things about that code have to change before it is reused. `useMediaPipePose.ts` requests
`facingMode: "user"` — the front camera — on a device that would be propped across the room pointing at a leg. It
drives inference from `requestAnimationFrame` with no `visibilitychange` handling. And `drawSkeleton.ts` defaults to
`mirror = true` for a selfie view, which would draw the operated leg on the wrong side of the body in an application
whose whole subject is which knee was operated on.

What does not exist is a function from landmarks to a joint angle. `poseToImu.ts` turns landmarks into a six-channel
virtual IMU for the gait models, not into a knee angle.

### What is refused

A live coaching overlay during repetitions is not buildable for this product this quarter. Six of the seven exercises
are supine or seated, so the phone has to stand two to three metres away to see the leg. At that distance the patient
cannot read the instruction text — every cue on the exercise screen is set at `text-lg` or `text-base` and only the
repetition count is `text-6xl` — and cannot reach the buttons. A camera that the patient cannot read and cannot reach
is not a coach.

Also refused for now: writing any camera-derived data to the database. `0006_sessions.sql` states in its header that
frames store derived keypoints and metrics only and that raw video never leaves the client, and `0018` and `0021`
repeat it. Phases 0 to 2 below persist nothing from the camera, so that promise stays intact and there is no consent
surface to build and no revocation path to get wrong.

### What is built, and in what order

**Phase A — stop the copy from overclaiming.** `src/locales/ru.json` currently tells Russian users, in production,
that Mova «превращает камеру вашего устройства в клинический датчик движения» (line 55) and «Никаких датчиков. Только
ваша камера…» (line 61). Both are false for this product, and every guard rail below is undercut if a reviewer opens
the home page during the presentation. The clinician chart caption already shows the right register and can be
copied. Half a day.

**Phase B — the camera as a mirror during the still hold.** Add an opt-in camera panel to
`app/(app)/app/session/[id]/calibrate/page.tsx`, which today is a `StepPending` placeholder carrying `TODO(#17)` and
`TODO(#21)` and which the recorded walkthrough never visits. It shows the live picture with the pose skeleton drawn
over it, `mirror: false`, rear camera, paced inference rather than one frame per animation frame. It answers exactly
one question, with three values and no degrees: is the leg straight, bent, or not visible.

That single question is worth answering because `lib/motion/flexion.ts` documents, under "Known limitation", that the
zero is whatever pose the leg holds during the baseline window and that nothing in the sensor path can tell a
straight leg from a bent one. Its own worked example shows that a baseline taken with the knee bent by 25 degrees
produces one phantom repetition on the patient's screen, and that a small enough repetition amplitude inverts the
whole session. A camera check during the still hold repairs a defect that exists today.

The panel is off by default, the session proceeds normally when the patient declines, and nothing it sees is stored
or scored.

**Phase C — anything more.** Only after a reference set exists and the score's abstention is honest. Candidates, in
order of usefulness: a rear-camera setup helper that says the leg is out of frame before the set starts; a
side-by-side replay of the reference clip and the recorded repetition curve; a camera-derived knee angle, which needs
its own validation against a goniometer exactly as the sensor path does, and which is not a shortcut around
calibration.

### The exact wording the interface must use

Russian, on the camera panel and in any place the camera is described:

> Камера показывает, как вы двигаетесь, и помогает проверить положение ноги. Она не измеряет угол в колене и не
> влияет ни на счёт повторений, ни на оценку.

In English, for the team: the camera shows how you move and helps check the position of the leg. It does not measure
the knee angle and it does not affect the repetition count or the score.

The three answers of the position check, in Russian: «Нога выпрямлена», «Нога согнута», «Не вижу ногу». The third is a
real answer and must appear whenever the confidence is low, rather than the panel guessing between the other two.

## What unlocks the Execution Score's null components

The nulls are not a coding gap. They are an empty directory.

`services/imu-tools/src/mova_imu/analysis/reference_sets/.gitignore` says it plainly: no reference set ships with the
repository, and `assess_reps` abstains until one exists there. The vendored `analysis/execution_score.py` says where
the numbers come from: the tempo, hold and controlled-return targets are calibrated from each exercise's recorded
good reference repetitions, as the average `duration_seconds`, `extension_seconds` and `hold_seconds`, and the
exercises with no recordings keep `None` so their sub-metrics abstain rather than guess.

The tools to produce those numbers are on the branch and need no database and no patient:

- `services/imu-tools/tools/capture_wt901ble68.py` records a take from the sensors to a JSONL capture.
- `services/imu-tools/tools/label_reps.py` segments one take into repetitions and writes a CSV with the measured
  features and the quality labels pre-filled. Its own header gives the recording design: vary one quality per take,
  three takes good on both axes, and two takes each of range-mediocre, range-bad, tempo-mediocre and tempo-bad. If
  the detected count differs from `--expected`, the take is not written, so a wrong segmentation cannot be labelled.
- `services/imu-tools/tools/build_rep_quality_reference.py` builds the reference set from the labelled CSVs.
- `services/imu-tools/tools/tune_reps.py` checks an exercise's enter and exit thresholds against real takes.
- `services/imu-tools/tools/check_execution_score.py` verifies the resulting score end to end.

The deliverable is small: per exercise, the mean and standard deviation of three durations over the good repetitions,
with the number of takes and the number of subjects written next to them. That table is what turns `tempoRangeSec:
null` into a window, and it is the one piece of work that nothing else depends on and that blocks nothing, so it can
run in parallel from day one.

Rules for it: consenting volunteers, never patients; the local capture files, never the production database; and the
Python's own Execution Score stays inside `services/imu-tools`, per that package's README. When the two engines
disagree on the same take — and they will, because mova counts an ankle cycle at 8 degrees where Phoenix counts one
direction at 4, and because mova gave the ankle exercises a borrowed 20-degree target — write the difference down
rather than reconciling it silently.

## Order of work, with rough effort

| Order | Work | Effort | Blocks |
|---|---|---|---|
| 1 | Merge the two branches into one integration branch | half a day | everything |
| 2 | Un-crop the videos; aspect ratio per asset, `object-contain` | 1 day | nothing |
| 3 | Fix the Russian landing copy about the camera | half a day | the camera phase |
| 4 | Nullable score components, `componentsUsed`, amended 0041 | 2 days | every new page |
| 5 | Role-aware signal quality and readiness; configurable counting pair | 2 days | every two-sensor page |
| 6 | `ExerciseSession` and the runtime registry, Heel Slide only | 2–3 days | pages 1, 2, 3, 6, 7 |
| 7 | Land `ReferenceVideo` from `feat/exercise-library` | half a day | nothing |
| 8 | Exercise 7, the first two-sensor page | 2 days | page 6 |
| 9 | Exercises 1, 2, 3 and seated knee extension | 1 day each | — |
| 10 | Migration 0042: foot series in `clinician_session_result` | half a day, plus approval to apply | the clinician view of 6 and 7 |
| 11 | Exercise 6, once its clip is settled | half a day | — |
| 12 | Camera panel on `/calibrate`, opt-in, three-valued, stores nothing | 3 days | — |
| 13 | Exercises 4 and 5, after filming and the clinical decision | 2 days | — |
| — | Calibration captures and the reference set, in parallel throughout | ongoing | the real tempo and hold targets |

## Risks

The quiet failure in `signalQuality.ts` is the one to watch. If a two-sensor page ships before the role fix, the
application writes zeros into `session_frames.quality` for entire sessions and freezes the score from the first
frame, and none of it looks like an error. Everything after item 5 in the table depends on item 5 being done first.

The second risk is the partial Correctness described above. A score that silently drops half its components and
renormalizes is exactly the kind of confident wrong number the project exists to avoid, and it is already possible on
the merged branch. Item 4 is not optional and is not a refactor.

The third is the clip pairings. Attaching a plausible-looking clip to the wrong exercise teaches the patient the wrong
movement, and it is not caught by any test — `catalog.test.ts` checks that a file exists, not that it shows the right
thing. Two of the seven pairings and one clip already on `main` are open questions.

The fourth is scope against the demo. The recorded walkthrough at `docs/walkthrough/heel-slide-walkthrough-1920.mp4`
and the working Heel Slide path have to keep working. Item 6 is the moment they are at risk, and it is worth
re-running the whole walkthrough by hand after it, before anything else lands on top.

The fifth is the database. Production holds real patients, and migrations 0037 to 0040 are already in the repository
unapplied. 0041 is amended, not applied. 0042 is new. None of them touches production without a separate decision.

The sixth is hardware. Nothing in this plan has run on physical sensors; that is still Test 1 in `HARDWARE-TEST.md`,
and the calibration work in the last section needs real takes on real legs before any of its numbers mean anything.

## Open questions

For the founder to decide:

Whether the two ankle exercises keep their borrowed 20-degree target, or whether the Target component abstains for
them and their Execution Score is Correctness and Volume renormalized. The borrowed number is flagged in
`exerciseConfigs.ts` as needing confirmation.

Whether `/calibrate` becomes a step the patient actually walks through. Adding a panel to the existing placeholder is
safe; re-routing sensors to calibrate to exercise changes the flow and forces the walkthrough to be recorded again.
Those are two separate decisions and should not be bundled.

Whether exercises 4 and 5 ship at all in this round. They need footage, a clinical decision, the absolute-thigh
signal and a change to the vendored identity file. Everything else in this plan lands without them.

For the clinician, below.

## Спросить у врача

### Съёмка (нужны новые видео)

1. Подъём прямой ноги на 15° лёжа (Lying Partial Leg Raise) — нога поднимается только до 15°, без задержки.
2. То же с удержанием 3 секунды в верхней точке (Lying Partial Leg Hold).
3. Активные движения стопой лёжа (Ankle Pumps) — **без ленты и без ремня**, пациент двигает стопой сам.
4. Возможно, скольжение пятки с лентой (Heel Slide With Band) — см. вопрос 6 ниже.

Как снимать: телефон в одном положении для всех роликов, сбоку, в кадре вся нога от бедра до стопы, 10–15 секунд,
движение показать 3–4 раза. Без монтажа и без подписей: ролик зацикливается в приложении.

### Вопросы по существующим роликам

5. `ankle-dorsiflexion-strap.mp4` сейчас привязан к упражнению «Насос стопой (активный)». На кадре — положение сидя с
   вытянутыми ногами и ремень на стопе, то есть движение с помощью. Это то же упражнение или другое?
6. `supine-knee-flexion-strap.mp4` привязан к «Скольжению пятки с лентой». На кадре пятка отрывается от кровати и
   бедро идёт к груди. При скольжении пятки пятка остаётся на кровати. Это то же упражнение?
7. `ankle-dorsiflexion-band.mp4` — лента сопротивляется движению стопы **на себя** или **от себя**? От этого зависит
   текст подсказки.
8. `supine-bend-and-raise-strap.mp4` содержит два движения подряд. Можно ли обрезать его до подъёма ноги, или нужен
   отдельный ролик?

### Вопросы по нормативам

9. Для упражнений со стопой («Насос стопой» и «Движения стопой с сопротивлением») в спецификации нет целевой
   амплитуды. Сейчас в коде стоит 20° на полный цикл, взятые по аналогии. Это допустимо, или для этих упражнений
   амплитуду оценивать не нужно вообще?
10. Сколько секунд должно занимать одно правильное повторение для каждого из семи упражнений: фаза движения и фаза
    возврата отдельно? Сейчас этих чисел нет, и приложение честно пишет «не оценивается» вместо оценки темпа.
11. Удержание в верхней точке: 0,5 с для «Подъёма колена с поддержкой» и 3 с для удержания ноги — это минимум или
    ориентир? Считать ли повторение неправильным, если удержание короче?
12. Целевой угол для «Скольжения пятки с лентой» взят такой же, как у обычного скольжения пятки (90°). Это верно?
13. Сколько повторений назначать по умолчанию для каждого упражнения на разных сроках после операции?
14. Для калибровки нужны записи правильных повторений: 3 записи «правильно» и по 2 записи с намеренно неправильной
    амплитудой и намеренно неправильным темпом, на каждое упражнение. Кто может их выполнить и записать?
