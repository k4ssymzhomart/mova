# Patient app: information architecture

The shell and route skeleton of the patient app in `services/frontend`, for rehabilitation after primary
unilateral total knee arthroplasty (TKA), measured by three IMUs on the thigh, shank and foot.

Screens owned by other issues are held in place here, not built: sensor transport (#21), calibration (#17),
the exercise screen and check-in (#22), scoring (#23), and the clinical schema (#20).

## Navigation

| RU / KZ / EN | Route | Icon | Why it has a slot |
|---|---|---|---|
| Сегодня / Бүгін / Today | `/app` | `House` | Prescribed exercises. The only way into the exercise flow. |
| План / Жоспар / Plan | `/program` | `ClipboardList` | The full prescription and precautions (НТЗ §4.3), kept off the start screen. |
| Прогресс / Ілгерілеу / Progress | `/progress` | `ChartLine` | Session history from Supabase. Not `TrendingUp`: an up arrow claims an improvement nobody measured. |
| Специалисты / Мамандар / Care team | `/care-team` | `Users` | The clinicians actually linked in `care_team_links`. |

The footer holds Настройки (`/settings`), the RU / KZ / EN switch, and sign-out. Below 1024px the four items
sit in a bottom tab bar; the drawer behind the labelled «Меню» button holds everything, including the footer.

Items live in `src/components/layout/nav.ts`. Highlighting is longest-prefix (`src/lib/nav/match.ts`, unit
tested): every `/app/session/*` route highlights Сегодня, `/program/<id>` highlights План.

**Why there is no messages tab.** Phoenix ships План / Прогресс / Сообщения, but its inbox is real. Here nothing
on the clinician side reads `messages`, so a message box would tell a post-op patient that someone had seen
their complaint when nobody had.

## Route map

```
NAV       /app                         Today
          /program                     Plan
          /progress                    Progress
          /care-team                   Care team
UTILITY   /settings                    footer
          /devices                     not in nav; empty state until #21 builds the device page
DETAIL    /program/[prescriptionId]    highlights Plan
          /progress/[sessionId]        highlights Progress
FLOW      all under /app/session, all highlight Today, tab bar hidden
          /app/session/new/[prescriptionId]   1 Датчики      no session row yet
          /app/session/[id]/calibrate          2 Калибровка   #17, #21
          /app/session/[id]/exercise           3 Упражнение   #22
          /app/session/[id]/check-in           4 Опрос        #22
          /app/session/[id]/summary            5 Итог         scores #23
          /app/session/[id]/stop               RED instruction (НТЗ §15)
REDIRECT  /app/session, /app/session/new       → /app
          /app/session/[id]                    → the step matching the session's status
          /exercises                           → /program
          /achievements                        → /progress
          /learn, /learn/[slug], /intake       → /app
```

Every route renders real data, an explicit empty state, or an explicit load-error state. A failed read is never
shown as "nothing here". A missing or foreign id shows a not-found state inside the shell instead of a 404.

## Removed

| Was | Now | Why |
|---|---|---|
| Тренировка `/app/session/new` | redirect to `/app` | The flow is a wizard entered from Today. As a nav item it invited starting with no sensors, and the old route created a session row on every click. |
| Упражнения `/exercises` | redirect to `/program` | The catalog is upper-limb and freezing-of-gait work; a patient never browses unprescribed exercises. |
| Достижения `/achievements`, sidebar streak ring | redirect to `/progress` | Gamification is not shell chrome. Bringing it back safely (scoring spec §12.2) belongs to #22. |
| Устройства `/devices` | out of nav, empty state | Sensor status belongs in the flow. The page showed three fake sensors with invented battery and signal values; #21 rebuilds it. |
| Команда по уходу `/care-team` | renamed Специалисты | Its invented clinician, email, phone number, review date, and a messenger that saved to localStorage are gone. |
| Обучение `/learn`, «Помощь и поддержка» | redirect to `/app` | Four of the five articles were about Parkinson's, freezing of gait or stroke. |
| `/intake` (not in nav) | redirect to `/app` | A stroke / Parkinson's picker with a camera range-of-motion baseline. |
| Settings: side picker, camera and metronome preferences, «Отозвать доступ» | removed | The patient could set their own "operated" side. The preferences belonged to the camera studio. The revoke button claimed a control it did not have (see Known gaps). |
| `ready` flag, «скоро» pill, `ComingSoon.tsx` | deleted | Every remaining route is built or an honest empty state. |

## Shell decisions

### Post-operative day: persistent chrome

- **Where.** `PatientContextBar`: a sticky strip at the top of the content column on desktop and the top bar on
  mobile, on every route including the exercise flow. Not in the rail, which would cut it off when collapsed
  to 74px.
- **Why chrome rather than a card on Today.** The whole protocol is indexed to it, and the patient needs it
  inside the flow as much as on the main screen (PAT-01 is met either way). One component renders it, so two
  numbers can never disagree.
- **How it is computed.** On the server, once per request: `getPatientContext()` calls `computePostOpDay()`
  (`src/lib/patient/pod.ts`), which counts calendar days in a named timezone.
- **What is pending.** There is no surgery-date column yet (#20). The origin (is the day of surgery POD 0 or 1?)
  and the timezone (clinic or patient; both columns default to UTC) are with the clinician. `POD_CONVENTION`
  stays `null` until then.
- **What it says meanwhile.** Each unknown reason has its own text:
  - no date: «Дата операции не внесена»;
  - a date but no confirmed convention: «День после операции пока не рассчитывается»;
  - an unreadable date: «Дата операции записана с ошибкой».

  The date is never estimated from the signup date, the first session, `programs.start_date` or
  `patients.baseline`.

### Operated side and precautions

- **Badge.** The side sits next to the POD as full words in a bordered badge («Левое колено»), never Л/П, never
  colour alone.
- **Today it reads «Сторона операции не указана» for everyone, on purpose.** The only existing column,
  `patients.affected_side`, is the stroke app's "affected side", which patients picked for themselves in the old
  Settings. Showing it as the operated knee could send a patient to the wrong leg.
- **Source to come.** The badge switches to a clinic-recorded field when #20 adds one (`getPatientContext`, marked
  `TODO(#20)`). Settings shows the side read-only and no longer has an editor.
- **Precautions** have a card on Today and on Plan. With no record the card says «Ограничения не внесены в
  приложение», never «Нет ограничений». Recorded wording is shown verbatim once #20 adds the fields. Whether the
  clinic uses presets or free text is with the clinician.

### Sensor status: inside the flow only

- **Not in the shell.** Sensors are off between sessions, so a shell indicator would show three permanent
  warnings to a patient who did nothing wrong. AC-03 is about the moment before an exercise starts.
- **Where it shows.** Step 1 shows three rows, each with an icon, the role and a status word. Calibration and
  exercise show a compact strip in the flow frame.
- **Contract.** `src/lib/sensors/types.ts` and the hook `useSensorStatus()`. The `unsupported` state covers
  browsers without Web Bluetooth (every iOS browser), so they are never told a sensor is merely disconnected.
- **Sources.** With no transport the source is `none`. `NEXT_PUBLIC_SENSOR_MOCK=1` turns on a mock (refused when
  `NEXT_PUBLIC_VERCEL_ENV=production`), which shows a banner that cannot be dismissed plus buttons to step
  through each state. Battery is always `null` in the mock.
- **«Далее».** On step 1 it is enabled only when all three stream from a real (`ble`) source. `TODO(#21)`.
- **Step indicator.** The flow frame shows the current step and never marks earlier steps as done: it only knows
  the URL, not whether calibration or the check-in actually happened.

### RED safety slot (НТЗ §15)

- **Replacing the page.** `SafetyProvider` wraps the shell. `raiseRed()` exits fullscreen, and AppShell renders
  `SafetyStopPanel` in place of the page, so the flow unmounts. An overlay would sit hidden behind a fullscreen
  exercise and leave it running.
- **Surviving a reload.** When RED is raised inside a session, it also moves to `/app/session/[id]/stop`, which
  renders the same panel, so a reload keeps the instruction. Outside a session there is no route to hold it, and
  a reload clears it. Every flow step has an «Остановить» control.
- **Not yet decided.** Nothing raises RED yet. The rules, the approved RU/KZ/EN instruction, and who may clear the
  state are with the clinician. Until then the instruction slot says «Утверждённый текст инструкции ещё не
  получен от клиники.»

### Mobile and keyboard

- **Tab bar.** A bottom tab bar with the four labelled items, because older users rarely open a hamburger menu.
  It is hidden inside the flow. Long labels wrap inside their tab instead of being clipped at 360px.
- **Drawer.** It closes on navigation and on Escape, and locks body scroll. While closed it is `invisible` and
  `inert` in the rendered markup itself, so its links are never focusable, before hydration included. While it
  is open, the page behind it is inert and focus moves into it; closing returns focus to «Меню».
- **Obscured focus.** Scroll padding keeps a focused control clear of the sticky context bar and the fixed tab bar
  (WCAG 2.2 SC 2.4.11).
- **Controls.** A skip link, `focus-visible` rings on every control, sr-only labels on the collapsed rail, and
  48px targets throughout.

## Typography, contrast and dates

**Electrolize ships Latin only, at one weight.** Russian is the default locale, so every Cyrillic character was
already rendering in the system fallback font:

- `font-semibold` bolded Russian text but not Latin text on the same screen.
- The Kazakh letters ә, қ, ң, ө, ұ, ү and і could never render in it.
- The single-typeface look only ever existed on the landing page and in the English UI.

**The patient app now uses Inter** (latin, latin-ext, cyrillic, cyrillic-ext; variable weight):

- It is loaded in `(app)/layout.tsx` and scoped by `.app-type` in `globals.css`, which points `--font-inter`,
  `--font-mono` and `--font-serif` at it.
- The landing and the clinician portal keep their look. The clinician portal has the same Cyrillic problem,
  which is a separate decision.

**Contrast:**

| Token | On white | WCAG | Now used for |
|---|---|---|---|
| `signal` #16A35B | 3.27:1 | fails 1.4.3 (text needs 4.5:1), passes 1.4.11 (UI needs 3:1) | bars, rings, borders, active indicators only |
| `signal-deep` #0A6E3E | 6.34:1 | passes | green text, primary button fill («Начать») |
| `ink-faint` #8A8B82 | 3.44:1 | fails for text | not used for text |
| `ink-soft` #55564E | 7.43:1 | passes | secondary text and labels |

**Recipes** live in `src/components/app/recipes.ts`:

- The size scale is unchanged; headings are now semibold and wrap anywhere.
- No text is smaller than 14px. Tile and field labels are sentence case; only the one-line eyebrow above a title
  stays uppercase.
- `prefers-reduced-motion` is honoured across the patient app from `globals.css`.

**Language switch:**

- The patient variant marks the selected language with a dark fill and a check mark, not colour alone.
- The landing and the clinician header offer RU and EN only, because they have no Kazakh copy. Sign-in offers all
  three.

**Dates:**

- Dates and times are formatted in the browser's timezone (`LocalDateTime`), because the server runs in UTC and
  nothing records the patient's timezone yet.
- Kazakh dates are assembled from month and weekday names (`src/lib/i18n/formatDate.ts`). Browser ICU builds
  often lack Kazakh and would print «M09 13, SUN».

## Interfaces left for other issues

| For | Interface | File |
|---|---|---|
| #20 | `getPatientContext()` returns POD, operated side and precautions; all three are `TODO(#20)` | `src/lib/patient/context.ts` |
| #21 | `SensorStatusSnapshot` and `useSensorStatus()` | `src/lib/sensors/` |
| #22 | `useSafety().raiseRed({ sessionId })`, the step routes, and the `TODO(#22)` for creating the session row and recording a stop | `src/lib/safety/`, `src/app/(app)/app/session/` |
| #23 | the "scores not available yet" cards on the summary and progress screens | `progress/`, `app/session/[id]/summary` |

`DevicesClient.tsx` and `SessionStudio.tsx` are left in place, unused, for #21 and #22.

## i18n

`ru.json` and `en.json` have identical key sets. `kk.json` covers the shell, the patient pages and sign-in;
anything else falls back to Russian. The Kazakh copy needs a native speaker's review. `npm run i18n:check`
checks all three.

## Known gaps

- **Nothing creates programs or prescriptions**, and the catalog has no TKA exercises, so Today is an empty state
  for every patient and the exercise flow cannot be entered. No issue owns the clinician prescription builder or
  seeding the eight core exercises yet.
- **Clinic-wide visibility (#20, hole 1).** `clinic_caseload()` and `clinic_patient_overview()` (migration 0022)
  return every patient in the caller's clinic without a role or care-team check, every self-serve patient sits
  in the shared "Mova Personal" clinic, and `/clinician` only checks that someone is signed in. Any signed-in
  self-serve account can therefore read the others' profiles and sessions. Settings says plainly that anyone
  whose Mova account belongs to the patient's clinic can see their profile and sessions, and that this cannot be
  changed from the app. Copy cannot close the hole; the RPC scoping in #20 does.
- **Specialist names (#20).** Under the current policies a patient cannot read the profile of a clinician linked
  to them, so `/care-team` shows «Имя недоступно» for a linked specialist until a patient-visible read exists.
- **Exercise names** come from `exercises.name` untranslated. The seeded catalog is English.
- **Lost sign-in path.** `(app)/layout.tsx` sends signed-out users to `/signin?next=/app`, dropping the page they
  asked for.

## Checking it

```bash
npm run test:unit        # nav matching, flow steps, POD arithmetic, date formatting
npm run i18n:check       # ru/en parity, kk subset
NEXT_PUBLIC_SENSOR_MOCK=1 npx next dev   # walk the flow and step through every sensor state
```
