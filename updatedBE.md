# DoctorFare analytics knowledge

Read-only briefing for the admin analytics agent. Backend code wins over UI labels. Tags: `[code: file:line]`, `[data: env]`, `[inferred]`. Timezone `America/New_York`. Do not return patient data or secrets (section 10).

df-dev counts are from the schema scan on 2026-10-09 and the conflict check on 2026-10-28. On 2026-10-29 local databases `df-dev` and `doctorfare-dev` had **0** `appointments`, so section 4 formulas were **not** re-run and were **not** compared to a dashboard screen. `[data: local mongo 2026-10-29]` Do not treat df-dev `isBlocked` (2393/2459 users) as production. `[data: df-dev schema 2026-10-09]`

## 1. Product

DF books specialist visits for PCP-referred, specialist-initiated, web, chat, SMS-link, eFax, and Tier-3 patients. Actors: DF admin; PCP office/group; specialist **office** (`specialists`); specialist **group** (`specialistgroups`); **provider** (doctor); patient. An appointment is one row in `appointments` with a latest `currentStatus` (not a full event log). Office list ownership is appointment `specialistId` / `specialistGroupId` / created-by, **not** `patients.ownerId`. `[code: appointment.controller.js getSpecialistOwnershipOrCriteria ~2735, getDashboardData ~17447]`

## 2. Entity map

| Collection | Analytics fields | Joins |
|---|---|---|
| `appointments` | `appointmentId` (string), `currentStatus`, `appointmentSubStatus`, `appointmentType`, `appointmentTypeId`, `visitType`, `patientId`, `pcpId`, `specialistId`, **`specialistGroupId[]`**, `providerId`, `createdAt`, `appointmentDate`, `appointmentStartDateTime`, `createdBy`, `createdByPatient`, `createdBySpecialistId`, `createdBySpecialistGroupId`, `isPatientSubmittedAppointment`, `isUploadedFromCSV`, `isDeveloperAppointment`, `eFaxLeadId[]`, `isInfoRequested`, `isRequestInfoClosed`, `handledStatus`, `appointmentHistory[]`, `subStatusForRequestInfo[]`, `callOwnership`, `isTransportation` | patient, pcp, specialist, group, provider |
| `patients` | `uniqueId`, `patientType`, `ownerId`, `ownerRole`, `pcpId`, `patientLanguageSelected`, `isHighRiskPatient`, `isDeleted` | do not project name/phone/dob unless asked |
| `specialists` | office. `entityName`, `specialistGroupId[]`, `providersInSpecialist[]`, `aptTypes[]`, `allowedFeatures[]`, `pcpId[]`, `metricsUnitsData`, `avgResponseTime`, `scheduledHoursLimit`, `isEFaxApt`, `createdAt` | group array; providers |
| `specialistgroups` | `specialistsInSpecialistGroup[]` `{specialistId, providerIds[]}`, `pcpId[]`, `allowedFeatures[]`, `metricsUnitsData`, `avgResponseTime` | offices |
| `providers` | `fullName`, `npiNumber`, `specialty[]`, `specialistId[]`, `insurance[]` | specialty, office |
| `specialties` | `specialtyName` | via provider only |
| `pcps` / `pcpgroups` | `pcpName`/`entityName`, `pcpOfficeInPcpGroup`, `pcpPreference`, `pcpPreferenceForSpg` | appointments.`pcpId` |
| `users` | `role`, `pcpId`, `specialistId`, `specialistGroupId`, `specialistsInSpecialistGroupUsers[]`, `isBlocked`, `blockType`, `lastLoginAt`. `isActive` is not usage | org ids |
| `defaultappointmenttypes` | `appointmentType` (label), `type` (category), `appointmentOrigin` | `appointmentTypeId` |
| `loginlogs` | `userId`, `status`, `loginAt` `[code: LoginLogs model]` | users |
| `efaxleads` | lead → `appointments.eFaxLeadId` | string/ObjectId; confirm in data |
| `bookappointmentsms` | `appointmentId` **string**, `specialistId` string, `smsType`, `fromEFax`, `efaxLeadId`. `contact`/`smsBody` = PHI | `appointments.appointmentId` |
| `examprepsms` | **no appointmentId**. `specialistId`/`specialistGroupId` strings, `examTypes`, `appointmentDate`, `appointmentTime`. `contact`/`smsBody` = PHI `[code: examPrepSMS.js]` | office only, not a visit |
| `requesteddocuments` | request-doc feature | inspect `appointmentId` in dump before joining |
| `patientanalytics` | entity type Patient/PCP `[code: constants ANALYTICS_ENTITY_TYPES]` | do not dump payloads |
| `appointmentfeedbacks` | rating after visit | appointment id if present |
| `apiclients` | developer API clients. secrets: never return | `isDeveloperAppointment` |
| `rides` | Lyft. `appointmentId` string, `appointmentTime`, status fields `[code: integrations lyft]` | `appointments.appointmentId` |
| `chatrooms` / `messages` | chat. message body = PHI | patient/user ids |
| `shorturls` | token map. never return token | — |
| `transactions` | `CASH_MRI` payment status | `appointments.transactionId` |
| `specialistperformances` / `specialistgroupperformances` | snapshot of metrics | written by weekly avg-response job, not live |

## 3. Lifecycle

`currentStatus` is the **latest** status. A completed visit that was rescheduled counts as COMPLETED only.

| Status | Meaning | Set by | Next (code allows) |
|---|---|---|---|
| SUBMITTED | Created, not reviewed | create paths default `[code: appointment.js schema default; create ~1045 area saves SUBMITTED]` | review, add-date, info request, patient-called, cancel |
| REVIEWED | Specialist accepted **or** staff added a date. **Not** a separate “scheduled” bucket. UI label “Reviewed/Scheduled” is the portal, not a second status `[inferred from UI vs reviewAppointment]` | `reviewAppointment` sets REVIEWED from SUBMITTED, REVIEWED, SCHEDULED, RESCHEDULED, WORK_IN_PROGRESS **without requiring a slot** `[code: ~7168–7223]`. `addDateTime` sets REVIEWED unless patient submit, then stays SUBMITTED `[code: ~12287–12290]` | reschedule, cancel, no-show, complete, info request |
| SCHEDULED | Auto-accept **tele** create only. **0 rows** in the df-dev status list (visitType there is always IN_PERSON, `isTeleAppointment` always false) `[data: df-dev schema 2026-10-09]` | `autoAcceptAppointment` `[code: appointment.controller.js ~2698–2705]`, called when `isTeleAppointment` after create `[code: ~4385, ~4986, ~21082]` | review/reschedule still list it |
| RESCHEDULED | Slot moved | `rescheduleAppointment` `[code: ~6966–6972]`. `isNoShowAppointment` → RESCHEDULE_NOSHOW | review, cancel, complete |
| DATE_ADDED | **Usually a sub-status**, not currentStatus. One path still sets **currentStatus** DATE_ADDED | sub-status on add-date for FULL_SERVICE, FOLLOW_UP, TIER_3, FOLLOW_UP_PROCEDURE, SPECIALIST_INITIATED `[code: ~12269–12279]`. currentStatus DATE_ADDED in the other add-date function `[code: ~12613–12627]` | treat both; do not assume one |
| WORK_IN_PROGRESS | Open work: info request **or** a call, only if status was SUBMITTED | info request `[code: ~12774–12776]`; patient-called `[code: ~22258–22286]` | add-date moves WIP → REVIEWED `[code: ~12295]` |
| COMPLETED | Visit done; blocked if now is before start | `completeAppointment` `[code: ~7871–7881]` | terminal for dashboard |
| CANCELED | Canceled | `cancelAppointment` `[code: ~7409]` + `appointmentStatusAuthor` by role | — |
| NOSHOW | No-show | `noShowAppointment` `[code: ~7669]` | reschedule can become RESCHEDULE_NOSHOW |
| HOLD | Enum only. Create-time HOLD is **commented out** `[code: ~2247]` | not set by current code | do not use |
| MOBILE_UNVERIFIED | Enum only. Assignments are **commented out** `[code: ~1189 and siblings]` | not set by current code | legacy rows possible |
| EXPIRED | Enum + list filter validation only `[code: appointment.validation.js]` | **no cron sets it** `[code: cron.controller.js runAllCronJobs ~1213]` | open question |

SUBMITTED **with** `appointmentStartDateTime` means a date was stored while status stayed SUBMITTED: patient submit on add-date `[code: ~12287–12289]`, or create-with-slot that does not flip status (non-tele). `[code]` + `[inferred]` for the 380/2058 df-dev split.

Sub-status (`appointmentSubStatus`), separate from currentStatus:

| Value | Set by |
|---|---|
| SUBMITTED | default / clone `[code: ~5638]` |
| REFERRAL_REQUESTED | follow-up create `[code: ~1138]` |
| REFERRAL_UPLOADED / FOLLOW_UP_REFERRAL_UPLOADED | referral upload `[code: ~5192, ~6392]` |
| DATE_ADDED | add-date `[code: ~12278, ~12626]` |
| INFO_REQUESTED | open info request `[code: ~12778]` |
| PATIENT CALLED (space) | call endpoint; also increments `callCount` `[code: ~22248]` |
| PROVIDER_NOTES_UPLOADED / DOWNLOADED | notes upload / download `[code: ~9748, ~10444]` |
| EXAM_REPORTS_UPLOADED | exam report upload `[code: ~18677]` |
| CALLING, NOTCONTACTED, RESEARCH | **No writer in this API.** They are real `appointmentSubStatus` values in df-dev `[data: df-dev schema 2026-10-09]` | open question: old portal or removed code |

Info-request rows: `subStatusForRequestInfo[].requestStatus` OPEN, REOPEN, RESOLVED, CLOSED, AUTO_CLOSED `[code: constants REQUEST_STATUS]`. No job in `runAllCronJobs` auto-closes them.

`appointmentHistory[]`: `{updatedEntity:[{entityName, comment, from, to, fromValue, toValue, action, isAdded, isUpdated}], updatedBy, updatedByPatient, updatedAt}` `[code: appointment.js:127–147]`. Known `entityName`: Reviewed, Canceled, NoShow, Complete, DATE_ADDED, REVIEWED_AND_DATE_ADDED, OpenRequestInfo, appointmentSubStatus, appointmentStatus, CALL_ATTEMPT_COUNT, AUTO_ACCEPTED, PATIENT_SPOKEN_EDIT. Not every historical row has from/to. Rebuild “time to review” only when a Reviewed (or DATE_ADDED) entry exists. Avg response job uses **DATE_ADDED history date minus createdAt, in days** `[code: agenda/helper.js ~150–180, ~741–770]`.

## 4. Metrics

Screen: office/group dashboard `getDashboardData` `[code: ~17391]`. Date: `createdAt`, shifted +4h DST / +5h standard on the NY calendar bounds `[code: ~17983–18004]`. Scope: group user → `specialistGroupId` = user group, and if `specialistsInSpecialistGroupUsers` non-empty also `specialistId $in` those offices `[code: ~17447–17457]`. Office user → `specialistId`. PCP → `pcpId` or group’s `pcpOfficeInPcpGroup`. **Not** “all member offices” unless their ids were copied onto `appointments.specialistGroupId`.

Percents = count/total×100, 2 decimals; missing previous month growth = 100 `[code: applyLiveDashboardMetrics ~3330, applyDashboardGrowthFromLastMonth ~3375]`.

| Metric | Formula | Filters |
|---|---|---|
| totalAppointmentsCount | count | scope + createdAt window. **No status filter** |
| completedCount | `currentStatus=COMPLETED` | same |
| reviewedCount | `currentStatus=REVIEWED` only. **Excludes SCHEDULED, RESCHEDULED, and any REVIEWED visit later completed** | same |
| workInProgressCount | `WORK_IN_PROGRESS` | same |
| rescheduledCount | `RESCHEDULED` **and** `lastChangedByRole` in specialist/group roles **for PCP users only** `[code: ~18014, ~17440]` | PCP dashboard ≠ raw RESCHEDULED |
| canceledCount | `CANCELED` + same lastChangedByRole rule for PCP | |
| noShowCount | `NOSHOW` (no lastChangedByRole) | |
| actedOnCount | **Live dashboard:** `currentStatus != SUBMITTED` `[code: getDashboardData ~18043]`. Includes CANCELED, NOSHOW, COMPLETED. **Snapshot job differs:** count of appointments whose `appointmentHistory.updatedEntity.entityName` is in Reviewed, DATE_ADDED, Rescheduled, NoShow, Canceled, workInProgress, Complete `[code: helper.js ~647–668]`. Info-request WIP writes `entityName: "appointmentStatus"`, not `"workInProgress"`, so the snapshot often misses it | do not mix the two |
| *Percentage | that count / total × 100 | |
| pcpInfoReqCount.open | `isInfoRequested && !isRequestInfoClosed` + shown-to PCP or specialist by role `[code: ~18078, ~18124]` | |
| closed | `isInfoRequested && isRequestInfoClosed` | resolve and closed criteria are the same flags |
| growthFromLastMonth | (now−prev)/prev×100 on **percent fields and counts** vs last `specialist(group)performances` row | if no row, growth not applied `[code: ~3376]` |
| avgResponseTime | **Not** the live dashboard. Sunday job `updateAvgResponseTimeofSpecialistOffices` / `updateAvgResponseTimeOfSpg` `[code: integrations server.js `0 0 * * 0`; agenda/helper.js ~150, ~3168]`. Window: `createdAt` last **7 days**, `pcpId` not null and not the 3 exclusion ids. Unit: **days**. It averages seven history lags (DATE_ADDED, Reviewed, Rescheduled, Canceled, NoShow, workInProgress, Complete), each `history.updatedAt − createdAt` `[code: helper.js ~741–770, ~1460–1479]`. Writes office/group fields and `specialistperformances` / `specialistgroupperformances` `[code: helper.js ~1485–1509; admin.controller.js add path ~5708 / ~7548]`. df-dev snapshots stop **2025-06** and office `metricsUnitsData` is mostly 0 `[data: df-dev schema 2026-10-09]` | use live `appointments`, not the snapshot |
| admin `getStats` | module 0 = org counts (`isDeleted:false`). Appointment modules use query `createdAt` **without** the +4h shift `[code: admin.controller.js ~3357–3391]` | **differs** from office dashboard dates |
| getSpecialistPerformance | averages **stored** `metricsUnitsData` / `avgResponseTime` `[code: admin.controller.js ~3998]` | not a live recount |

**Screen check: not run.** Local `df-dev` and `doctorfare-dev` had 0 appointments on 2026-10-29, so no office/month was compared to `getDashboardData`. `[data: local mongo]`

## 5. Booking channel

First match wins. `[code]` fields; channel names are the agent vocabulary.

```json
{"$switch":{"branches":[
  {"case":{"$eq":["$isDeveloperAppointment",true]},"then":"developer_api"},
  {"case":{"$eq":["$isUploadedFromCSV",true]},"then":"csv"},
  {"case":{"$gt":[{"$size":{"$ifNull":["$eFaxLeadId",[]]}},0]},"then":"efax"},
  {"case":{"$in":["$appointmentType",["FOLLOW_UP","FOLLOW_UP_PROCEDURE"]]},"then":"follow_up"},
  {"case":{"$eq":["$appointmentType","TIER_3"]},"then":"tier3"},
  {"case":{"$eq":["$appointmentType","SPECIALIST_INITIATED"]},"then":"specialist_initiated"},
  {"case":{"$in":["$appointmentType",["GUEST_PATIENT","ONLINE","URL"]]},"then":"guest_or_web"},
  {"case":{"$or":[{"$eq":["$isPatientSubmittedAppointment",true]},{"$ne":[{"$ifNull":["$createdByPatient",null]},null]}]},"then":"patient_web_or_chat"},
  {"case":{"$eq":["$appointmentType","PCP_INITIATED"]},"then":"pcp_referral"},
  {"case":{"$in":["$appointmentType",["ORDER","FULL_SERVICE","MRI_349"]]},"then":"pcp_or_full_service"}
],"default":"other"}}
```

`typeOfBookingV2` is only set in a migration script, not create `[code: migration/script.js ~2335]`. Empty in df-dev is expected. `[data: df-dev, prior check]` `createdBySpecialistId` is set on **clone** only `[code: ~5672]`. SMS booking link is `bookappointmentsms` where `appointmentId` matches; it does not by itself set `appointmentType`.

## 6. Dates

| Question | Field |
|---|---|
| When was it booked? Weekly report, dashboard, default list | `createdAt` (UTC instant) |
| Visit day | `appointmentDate`. Add-date sets it **equal to** `appointmentStartDateTime` `[code: ~12258]`, so it may be a datetime, not midnight. Schema type Date; string values are legacy `[inferred]` |
| Slot shown on the grid | `appointmentStartDateTime`, shifted by office offset on write `[code: ~12190–12195]` |
| Month bucket | `{"$dateToString":{"format":"%Y-%m","date":"$createdAt","timezone":"America/New_York"}}` |

Office list API default: `createdAt >= now−90d` `[code: newGetAppointmentsList ~9811]`. Portal copy “45 days” is **not** the API `[inferred]`. Appointment-date filter must use the calendar day, not the +4h createdAt shift.

## 7. Exclusions

Same three PCP ids are skipped by the **weekly Excel** and the **avg-response job**, not by a `isTest` flag `[code: emailAggregationPipelines.js appointments(); agenda/helper.js ~173–178]`:

`{"$oid":"645605a81d616af5e23b7667"}`, `{"$oid":"64537bc1399bdd4d887b2ad3"}`, `{"$oid":"644b901659c62f6718e12dd2"}`.

Weekly report also drops doctor name exactly `"David Adler "` (trailing space) `[code: emailAggregationPipelines.js]`. Not proven to be a test user.

Also drop `isDeleted:true` orgs for “current network”. `isDeveloperAppointment` exists `[code: appointment.js]` but **0 rows in df-dev** `[data: df-dev, prior check]`. Chat patients on **live** get `ownerId` `{"$oid":"6456068c633fc987227b619e"}` `[code: patient.controller.js getOwnerId]`. That id is an org, not a test flag; do not exclude its appointments unless asked. Whether these PCP ids exist in df-dev was not rechecked here.

## 8. Features (`allowedFeatures` on office and group)

`CHAT`, `EXAM_PREPARATIONS`, `BOOK_APPOINTMENT`, `REQUEST_DOCUMENT`, `SMS_METRICS`, `WORKFLOW_MANAGER` `[code: constants.js ALLOWED_FEATURES]`.

| Flag | Use evidence | Metric it should move |
|---|---|---|
| CHAT | `chatrooms` | not appointment volume by itself |
| EXAM_PREPARATIONS | `examprepsms` by office id (no visit id) | no-show, only if you join on office+day `[inferred]` |
| BOOK_APPOINTMENT | `bookappointmentsms.smsType=BOOK_APPOINTMENT` | bookings after SMS |
| REQUEST_DOCUMENT | `requesteddocuments` | info-request / document cycle |
| SMS_METRICS | SMS counters `smsSentCount` on appointments | outreach, not completion |
| WORKFLOW_MANAGER | no separate collection in API `[inferred]` | open question |

## 9. Levers

| Lever | Where | Moves |
|---|---|---|
| `allowedFeatures` | office/group | section 8 |
| `scheduledHoursLimit` | `specialists` (default 72); provider can override `[code: ~898]` | how soon a slot may be booked |
| `aptTypes` | office → `defaultappointmenttypes` | which types can be booked |
| `isEFaxApt` | office | eFax intake |
| `pcpPreference[]` / `pcpPreferenceForSpg[]` | `pcps`. `{specialistId or specialistGroupId, appPreference, toggleEnabled}`. `appPreference` is `Calendar` or `Bulk` `[code: Pcps.js ~44; pcp.validation.js ~228; pcp.controller.js ~1372]` | Calendar vs bulk booking for that PCP→office/group. Moves create path, not status math |
| provider `insurance[]` | providers | whether a payer can book that doctor |
| `appointmentCreationType` SINGLE/BULK | office `[code: Specialists.js]` | bulk vs one-by-one create |
| notification events | `events` collection + cron reminders | SMS/email, not the status math |

## 10. Never return

`patients`: name, phone, email, dob, address, insurance, documents, otp. `users`/`apiclients`: password, otp, tokens, session. `bookappointmentsms`/`examprepsms`/`messages`: `smsBody`, `contact`, message text. `shorturls`: token. `rides`: phone. Aggregates may use `patientType`, `patientLanguageSelected`, `ownerRole`, status, ids.

## 11. Traps

1. `patients.ownerId` ≠ appointments for that office. Chat patients on live are owned by group `6456068c633fc987227b619e` and still appear on other groups’ grids. `[code: getOwnerId; getSpecialistOwnershipOrCriteria]`
2. `specialistGroupId` on appointments is an **array**. An office in two groups copies both ids at booking `[code: ~829]`, so **both dashboards count the visit**.
3. Same name ≠ same patient. Use `uniqueId`.
4. `users.isActive` is not activity.
5. Dashboard `reviewedCount` is status REVIEWED now, not “ever reviewed”. `actedOn` is “not SUBMITTED”.
6. PCP reschedule/cancel tiles use `lastChangedByRole`, office tiles do not.
7. Performance collections can be months stale. Prefer live `appointments`.
8. Weekly report window is last 60 days `createdAt` plus the PCP and Adler filters. Do not use it as all-time truth.
9. Default list is 90 days `createdAt`, not 45, and not visit date.
10. `CALLING` / `NOTCONTACTED` / `RESEARCH` are not backend statuses.
11. `HOLD` and `MOBILE_UNVERIFIED` are not set by current code. df-dev still has **1 HOLD** row `[data: df-dev schema 2026-10-09]`. `EXPIRED` has no writer. `SCHEDULED` is tele-only and absent from that status list.
12. Snapshot `*Percentage` divides by **acted-on**, not by total `[code: admin.controller.js ~7330]`. Live dashboard divides by **total** `[code: applyLiveDashboardMetrics ~3345]`.
13. `users.specialistsInSpecialistGroupUsers` is an ObjectId array in code. In df-dev some rows are `{specialistId, providerIds[]}` `[data: df-dev schema 2026-10-09]`. A `$in` on that field can miss offices.
14. df-dev `appointmentType` includes `BULK` (1 row), which is not in `APPOINTMENT_TYPES` `[data: schema]` `[code: constants.js]`. Channel `$switch` sends it to `other`.

## 12. Open questions

- Who sets EXPIRED, after how long? No writer in this API. Ask backend owner.
- CALLING, NOTCONTACTED, RESEARCH: portal-only? Ask office-frontend owner.
- Are the three weekly-report PCP ids and “David Adler ” test accounts in prod? Code only excludes them. Ask ops.
- Is Lyft still live? Agenda ride jobs exist `[code: integrations server.js]`; df-dev `rides` ending 2023-10 was not rechecked and may be a stale dump. Ask integrations.
- WORKFLOW_MANAGER: which collection proves use? Ask product.
- `requesteddocuments` join key: confirm on the dump.
- Dashboard formulas vs the screen: not executed here. Re-count one office for one month on the env you care about.
