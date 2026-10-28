# Analytics insights plan

Source: business recommendation "Analytics Chat: From Table Reports to Business Growth Insights" (received 2026-10-27).

Goal: keep today's table reports and add a short insights layer under them: key findings, growth opportunities, a top recommendation and clickable follow-up questions. Everything must come from the data, with uncertainty stated.

Success measure: a business user goes from reading a report to knowing what it means and what to do next.

**Status:** Phase 1 was implemented and verified on 2026-10-27 (results in 1.6). Phase 2 has not started.

---

## 1. Where we are today

| Recommendation asks for | Today | Where |
|---|---|---|
| Table report | Done: pipe tables in replies, CSV via `export_csv` | [route.ts:45](../app/api/chat/route.ts#L45), `Reply` in [page.tsx:72](../app/page.tsx#L72) |
| Answers only from data | Done: "Answer ONLY from query results. Never invent names or numbers." | [route.ts:29](../app/api/chat/route.ts#L29) |
| State the period | Done: NY-time months, "State the period you used" | `months()` [route.ts:23](../app/api/chat/route.ts#L23) |
| Privacy | Done: read-only guard, secrets stripped, logs show row counts only, `patients` not readable | [guard.ts](../app/api/chat/guard.ts) |
| Supporting data | Partly: "Queried appointments" footer | [page.tsx](../app/page.tsx) |
| Key findings, opportunities, recommendation | Missing | |
| Follow-up question buttons | Missing (only static `SUGGESTIONS` on the empty screen) | [page.tsx:18](../app/page.tsx#L18) |
| Like-for-like comparisons | Missing: nothing stops "this month (27 days) vs last month (30 days)" | |

## 2. Approach

The agent writes the insights in the same final turn as the report. It already has the query results in context, so no extra model call is needed. A second "insights" call would double latency and the request count; that matters because OpenRouter's free tier allows 50 requests a day.

- **Format:** plain-text section labels and pipe tables. The UI already renders pipe tables, so the opportunities table needs no new UI code.
- **Follow-ups:** the server moves the trailing "Follow-up questions" bullets into a `followUps: string[]` field, and the UI renders them as buttons. Previous follow-ups never return to the model in history.
- **Metric definitions** go into `docs/df-dev-schema.md`. That file is the agent's system prompt, so every report uses the same definitions.

How the recommendation's five sections map to the reply:

| Recommendation section | In the reply |
|---|---|
| 1. Report | Existing table (unchanged) |
| 2. Key findings | `Key findings`: up to 3 bullets |
| 3. Growth opportunities + 4. Recommended actions | `Growth opportunities` table, up to 3 rows: Priority, Opportunity, Supporting data, Recommended action, Expected benefit |
| AI recommendation (top action) | `Recommendation`: 1 or 2 sentences |
| 5. Follow-up questions | `Follow-up questions`: 2 to 4 bullets, rendered as buttons |

**Not doing in Phase 1** (and when to add each):

| Skipped | Add when |
|---|---|
| A second "insights" model pass | Insights from a single turn turn out to be poor in QA |
| JSON output or a new "insights" tool | The plain-text format proves too unreliable to parse. A new tool also needs new validation in `model.ts` |
| `react-markdown` or charts | Users ask for richer formatting or for trend charts |
| New collections or data sources | Phase 2.5, once the data exists |
| Saving chats or recommendations | Phase 2.6, if users want progress tracking |
| Retrying when the format is wrong | Never: a retry spends rate-limited requests just to fix formatting. The UI falls back to plain text |

## 3. What data exists for each growth area

The recommendation lists 8 business areas. The df-dev database covers only some of them, so the agent must say when data is missing instead of guessing.

| Area | Data in df-dev | Phase 1 behaviour |
|---|---|---|
| Appointments | `appointments`: `createdAt`, `currentStatus`, `appointmentStartDateTime`, `reasonToCancel`, `appointmentStatusAuthor` | Full insights |
| Imaging centres | Specialist offices and groups; imaging appointments via `appointmentType` MRI_349, `examType`, `bodyPart`. `medicalcenters` is not readable (`medicalCenterId` is set on 11% of appointments) | Insights per specialist office (an imaging centre is a specialist office) |
| Centre partnerships | `specialists` and `specialistgroups` (`createdAt`, `isDeleted`), PCP links | Full insights |
| Operations | Unscheduled backlog (`appointmentStartDateTime` null on 1,749 rows), `handledStatus`, no-shows, reschedules, `appointmentHistory[]` | Full insights |
| Revenue | `price`, `discount` (7%), `transactionId` (8%), `isPaymentCompleted`: sparse | States the coverage. Real analysis is Phase 2.5 |
| Patient experience | Only `providers.type` (NPS bucket) and `isRatingGiven`. No feedback or complaints | "Not enough data" |
| Website performance | None (known gap, section 7) | "This database has no website data" |
| Marketing | None | "This database has no campaign or traffic data" |

Traps in the data that the prompt must cover:
- 951 appointments were bulk-imported from CSV in 2026-04 (`isUploadedFromCSV`). That spike is not growth.
- `isDeveloperAppointment: true` rows are test data and must be excluded.
- Data runs to about 2026-09, so "this month" may have only a handful of rows.
- Referrals created recently haven't had time to be completed, so their completion rate isn't comparable with older ones.

## 4. Metric definitions

Booking status comes from `appointments.currentStatus` (confirmed by the team, 2026-10-27). It holds the *latest* status, so an appointment that was scheduled and then completed now reads COMPLETED. "Confirmed" therefore counts every status at or past scheduling, not just SCHEDULED. In df-dev, no appointment has SCHEDULED, so "SCHEDULED only" would always report 0.

The 13 statuses fall into these buckets (confirmed by the team, 2026-10-27):

| Bucket | `currentStatus` values | Rows in df-dev (2026-10-27) |
|---|---|---|
| Pending | SUBMITTED, HOLD, REVIEWED, WORK_IN_PROGRESS | 2,317 |
| Confirmed (the patient was given a date) | DATE_ADDED, SCHEDULED, RESCHEDULED, COMPLETED, NOSHOW, RESCHEDULE_NOSHOW | 140 |
| Lost | CANCELED, EXPIRED | 46 |
| Ignored for now | MOBILE_UNVERIFIED | 0 |

SCHEDULED, DATE_ADDED, EXPIRED and MOBILE_UNVERIFIED have no rows in df-dev yet.

These definitions go into `docs/df-dev-schema.md` as a "Metric definitions" section:

| Metric | Definition (exclude `isDeveloperAppointment: true` and MOBILE_UNVERIFIED) |
|---|---|
| Requests (referrals received) | Appointments by `createdAt` in the period |
| Confirmed | Confirmed bucket |
| Completed | COMPLETED |
| Cancelled / expired | CANCELED / EXPIRED |
| No-show | NOSHOW or RESCHEDULE_NOSHOW |
| Rescheduled | RESCHEDULED |
| Scheduling rate / cancellation rate | Confirmed ÷ requests / cancelled ÷ requests |
| Open backlog | Pending bucket |
| Cohort rule | Statuses are the *current* status of referrals *created* in the period, not status changes during the period. The reply says so |

Limit: a booking that was scheduled and then cancelled now reads CANCELED, so it is not counted as confirmed. The exact path needs `appointmentHistory[]` (Phase 2.4).

---

## 5. Phase 1: analytics insights

Files touched: `docs/df-dev-schema.md`, `app/api/chat/route.ts`, `app/api/chat/guard.ts`, `scripts/check-guard.mjs`, `app/page.tsx`, `README.md`.

### 1.1 Metric definitions → `docs/df-dev-schema.md`
- [x] Add the section 4 bucket and metric tables after "Conventions".
- [x] Update the `currentStatus` row in the appointments table to list all 13 values. Mark the 4 with no df-dev rows (SCHEDULED, EXPIRED, DATE_ADDED, MOBILE_UNVERIFIED), so the agent knows they exist and can report 0 for them.
- [x] Add one query starter: "Appointment summary for a period vs the previous equal period". A single `$facet` (or `$group` with `$cond`) returns requests, confirmed, cancelled, completed and no-shows for both periods, with the % change computed in the pipeline.

### 1.2 Prompt → `system()` in [route.ts:29](../app/api/chat/route.ts#L29)
- [x] `months()`: also return `day` (today's day of month), so the prompt can name the matching days of last month.
- [x] Line 45 ("Reports and CSV"): keep everything, and append "then the insight sections below".
- [x] Line 47 ("Answer style"): keep it, but allow the 4 plain-text section labels.
- [x] Add this block (draft; tune during QA):

```text
Insights: after a report (a table, comparison or trend), add these sections in this order, each label alone on its own line, no markdown:
Key findings
- Up to 3 bullets in plain language: what changed and what it means. Give the numbers (count and %) and the period. Do not repeat the table row by row.
Growth opportunities
| Priority | Opportunity | Supporting data | Recommended action | Expected benefit |
Up to 3 rows. Supporting data quotes the figures from your query results. Priority is High/Medium/Low by how many referrals the gap affects.
Recommendation
One or two sentences: what to do first and why.
Follow-up questions
- 2 to 4 short questions the user could ask next about this report, answerable from this database.

Rules for insights:
- Every number comes from a query result. Compute rates and % changes in the pipeline ($divide, $subtract, $round), not in your head.
- Compare like with like: the metric definitions in the schema, equal-length periods. This month (${thisMonth}) is partial: compare it with ${lastMonth}-01 to ${lastMonth}-${day}, or say it is partial.
- Counts under 20 are noise: give the counts, do not call it a trend.
- The data shows what happened, not why. Phrase causes as "may" or "worth checking" and say what would confirm them. Benefits are "could" or "potentially", never promised numbers.
- If the data cannot support a finding, or the question needs data this database does not hold (website traffic, marketing, patient feedback, revenue beyond the price fields), say what is missing instead of guessing.
- Exclude isDeveloperAppointment:true. Point out the 2026-04 CSV import (isUploadedFromCSV) instead of calling it growth.
- Aggregates only: no patient-level details in insights.
- For a single number or a lookup (e.g. "how many PCPs in Miami"), skip the insight sections and give only the answer and Follow-up questions.
```

### 1.3 Follow-ups as data → `guard.ts`, `route.ts`
- [x] `splitFollowUps(reply) → { reply, followUps }` in [guard.ts](../app/api/chat/guard.ts), next to `toCsv`; it holds the pure output helpers, which are already tested.
  - Find the last line that matches `Follow-up questions`. Tolerate a trailing `:` and `**` around the label.
  - Take only the bullet lines directly under that label (`- `, `* `, `1.`), with the bullet marker stripped. Keep at most 4.
  - Any other line stays in the reply. With no label, return the reply unchanged and `followUps: []`.
- [x] `done()` at [route.ts:130](../app/api/chat/route.ts#L130): split the reply and return `{ reply, followUps, used, files, … }`.
- [x] Cases for [check-guard.mjs](../scripts/check-guard.mjs):
  - no block
  - a plain block
  - a `**Follow-up questions:**` label
  - a numbered list
  - text after the bullets stays in the reply
  - more than 4 bullets are capped
  - a question that starts with a number ("2026 referrals by month?") keeps that number

### 1.4 UI → [page.tsx](../app/page.tsx)
- [x] `Msg` gets `followUps?: string[]`. Save it from the response at line 174.
- [x] `Reply`: render a line that is exactly one of the 4 labels as a small sans heading in its own block. Today such a line would be merged into the surrounding paragraph. The opportunities table needs no change.
- [x] Under the **latest** assistant message only, show the follow-up buttons, styled like the `SUGGESTIONS` buttons, with `onClick={() => send(q)}`. Disable them while a reply is loading.
- [x] `SUGGESTIONS`: add a "This month vs last" prompt; the 4 existing suggestions stay.
- [x] Strip the `**` bold markers before rendering. Models add bold despite the prompt, and the UI does not parse markdown.

### 1.5 Docs
- [x] README: one paragraph on the insight sections, the `followUps` field, and the data each insight area can use.

### 1.6 Verify
- [x] `npm test`, `npm run lint`, `npm run build` pass.
- [x] Ask these questions against df-dev on at least 2 models from the fallback list (models differ in how well they follow the format):

| # | Question | Expect |
|---|---|---|
| Q1 | Show me appointment analytics for this month | Table of this month vs the same days of last month; findings; up to 3 opportunities; follow-ups. Small counts are called noise |
| Q2 | Top 10 specialist groups by referrals in the last 90 days | Report unchanged; insights below it |
| Q3 | CSV of appointments created with each specialist office last month | CSV still attached; insights below the preview |
| Q4 | How many PCP offices are in Miami? | Plain answer, no insight sections |
| Q5 | How can I improve website booking conversions? | Says there is no website data and what would be needed. No invented numbers |
| Q6 | Why have cancellations increased? | Causes worded as possibilities; cites `appointmentStatusAuthor` / `reasonToCancel` counts |
| Q7 | How many referrals came in each month this year? | Points out the 2026-04 CSV import instead of calling it growth |
| Q8 | Click a follow-up button | Sent as the next question in the same chat |

- [x] Number audit: for Q1 and Q6, re-run the pipelines from the `[db]` log lines in mongosh and match every figure in the reply.

**Results (2026-10-27, df-dev, the live model list).** Every figure was checked against independent queries.

| # | Result |
|---|---|
| Q1 | October has 0 appointments in df-dev. The agent says so, shows the latest month's status mix, and offers a Sep-vs-Aug comparison as a follow-up |
| Q2 | Table correct. Insights correct (17 of 51 = 33%), benefits qualitative, 4 follow-ups |
| Q3 | CSV attached, figures correct (7/2/2/1, 58%), 4 follow-ups |
| Q4 | Plain answer with no insight sections |
| Q5 | No invented numbers. The weak fallback model asked a clarifying question instead of naming the missing website data |
| Q6 | All 5 monthly counts and rates match. September is called a small-sample artifact, and causes are worded as possibilities |
| Q7 | All 9 monthly counts match. The April import is flagged, not called growth |
| Q8 | Clicking a follow-up sends it in the same chat. The answer (scheduling rate per group with the Confirmed bucket) matches the database exactly |

The first run surfaced four problems; three are fixed:
- Follow-ups written as "Follow‑up" with a non-breaking hyphen were not split. Fixed in the regex.
- Fallback models worked out shares in their heads ("53%" for 33%) and promised numeric benefits. Fixed in the prompt: every number must come from the pipeline, and benefits are qualitative.
- Literal `**` showed in replies. Fixed by stripping the markers in the UI.
- **Still open:** the `openrouter:openrouter/free` fallback routes to a random free model, and that model still sometimes ignores the "compute in the pipeline" rule (e.g. "34%", "top 3 … 79%" while naming 4 groups). The primary NVIDIA models followed it. See risks.

**Phase 1 acceptance** (the recommendation's section 10):

| Criterion | Checked by |
|---|---|
| Table reports still work | Q2, Q3 |
| Plain-language explanation under each relevant report, and only there | Q1–Q3, Q4 |
| Important changes and trends highlighted | Q1, Q7 |
| Growth opportunities with actions and benefits | Q1, Q2 |
| Insights relevant and supported by data | Number audit |
| Assumptions not presented as facts | Q6 |
| Says when data is insufficient | Q5, small counts in Q1 |
| Follow-up questions to explore | Q8 |
| Clear and concise | At most 3 findings, 3 opportunities, 4 follow-ups |

---

## 6. Phase 2: advanced growth insights (gated)

Phase 2 starts once Phase 1 has passed QA and the metric definitions are signed off. Each item starts as a prompt or schema-doc change. Code comes only when that fails.

| # | Item | Approach | Gate |
|---|---|---|---|
| 2.1 | Centre comparisons | Query starter: per specialist office or group, volume plus scheduling, cancellation, no-show and completion rates vs the peer median. Only offices with 20+ referrals are ranked | None (an imaging centre is a specialist office) |
| 2.2 | Recurring issues | Query starters: cancellations by `appointmentStatusAuthor` and normalised `reasonToCancel`; info requests by `subStatusForRequestInfo.requestType`; no-shows by office or provider; age of the unhandled backlog | None |
| 2.3 | Multi-period trends | 6–12 month series using the same definitions, with an option to exclude `isUploadedFromCSV` for organic growth. Tables first | Charts only if users ask |
| 2.4 | Booking conversion funnel | Pending → Confirmed → COMPLETED. Each appointment's exact path comes from `appointmentHistory[]`; this catches bookings that were scheduled and then cancelled, which `currentStatus` alone hides. Time to schedule = `appointmentStartDateTime − createdAt`; time to first action from `appointmentHistory[]`. Medians via `$median` (MongoDB 7.0+, check the server version) | None |
| 2.5 | Revenue and marketing | Revenue from `price`, `discount` and `isPaymentCompleted`, only after a coverage check. Marketing and website need a new source (e.g. a GA4 export). Adding one means adding the collection to `COLLECTIONS` in `guard.ts` and to the schema doc | The data exists |
| 2.6 | Tracking after actions | No storage needed first: "compare cancellations before and after 2026-11-01" already works. A saved action list needs a store outside df-dev, because the assistant is read-only there | Users want a recurring view |
| 2.7 | Server-computed metrics | A `metrics` tool returning the funnel for two periods, with % changes computed in code | Phase 1 QA shows the model getting the arithmetic or definitions wrong |

---

## 7. Known gaps and open questions

**Known gaps** (accepted for the POC, to be handled later):

| Gap | For now | Later |
|---|---|---|
| No website performance data (also no marketing or patient-feedback data) | The agent says the database has no such data and names what would be needed | Phase 2.5, once a data source exists |
| No login or per-organisation access | Internal POC: every user sees all organisations' aggregates | Comes with auth. Scope queries to the user's organisation on the server (`route.ts` / `guard.ts`), never through the prompt. Must be in place before anyone outside the DoctorFare team uses the chat |

**Open question:** what should priority rank on: referral volume, completion or revenue? Default for now: number of referrals affected.

**Answered (2026-10-27):**
- Booking status is `currentStatus`.
- An imaging centre is a specialist office.
- DATE_ADDED means the patient was given a date, so it counts as Confirmed.
- MOBILE_UNVERIFIED is ignored for now.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Free models drift from the format | The UI degrades to plain text. Test on 2 models (1.6) |
| Longer replies hit `max_tokens: 4096` ([model.ts:123](../app/api/chat/model.ts#L123)), which fails as "output token limit reached" and burns fallback attempts | The caps keep insights short. Watch the logs and raise the limit if it shows up |
| Model arithmetic is wrong. **Seen in QA** with `openrouter:openrouter/free`, which picks a random free model | The prompt requires every number to come from the pipeline, and the primary models comply. Next steps: move `openrouter/free` to the end of `LLM_MODELS` or drop it; build item 2.7 if errors persist |
| df-dev data is skewed (82% SUBMITTED, no SCHEDULED rows, the CSV spike) | On dev data, judge format and honesty, not business value |
| Database text steers the follow-up questions | The agent is read-only and a follow-up only runs when the user clicks it. Acceptable |
