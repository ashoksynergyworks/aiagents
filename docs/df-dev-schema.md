# df-dev schema (reporting subset)

MongoDB database `df-dev` (local Docker, `mongodb://localhost:27017/df-dev`). It backs a **referral platform**: a primary care office (PCP) refers a patient to a specialist office, which assigns a provider (the doctor) and schedules the visit. Each referral is an `appointments` document.

This file covers the 7 collections the AI agent reads. **The agent loads this whole file as its system prompt** (`app/api/chat/route.ts`), so a field missing here is a field it can't find. Counts, field coverage and enum values come from a full scan on 2026-10-09. Coverage % = share of documents that have the field.

## How the collections connect

```
pcpgroups ──pcpOfficeInPcpGroup[]──▶ pcps ◀──pcpGroupId[]── (pcps point back)
                                      │  specialistsInPcp[] ──▶ specialists
                                      │  specialistGroupsInPcp[{specialistGroupId, specialistIds[]}]
                                      ▼
appointments ── pcpId ──────────────▶ pcps            (referring office)
             ── pcpGroupId ─────────▶ pcpgroups       (rarely set, 31 docs)
             ── specialistId ───────▶ specialists     (receiving office)
             ── specialistGroupId[] ▶ specialistgroups (ARRAY, usually 1 id)
             ── providerId ─────────▶ providers       (the doctor)
             ── patientId ──────────▶ patients        (NOT users; 76k docs, not in this subset)
             ── createdBy / lastChangedBy / updatedBy ▶ users

specialistgroups ── specialistsInSpecialistGroup[{specialistId, providerIds[]}] ──▶ specialists, providers
                 ── pcpId[] ──▶ pcps
specialists ── providersInSpecialist[] ──▶ providers
            ── specialistGroupId[] ──▶ specialistgroups,  pcpId[] ──▶ pcps
providers   ── specialistId[] ──▶ specialists

users (staff logins) ── pcpId / pcpGroupId / specialistId / specialistGroupId ──▶ the org they work for
```

Reference integrity: every `appointments.pcpId`, `specialistId`, `specialistGroupId`, `providerId` resolves (100%). 4 of 2,503 `patientId`s are orphans. 80% of `appointments.createdBy` resolve to users.

## Conventions (read before querying)

- **All ids are `ObjectId`**, never strings. Filter with `{"pcpId": {"$oid": "…"}}` (Extended JSON). Each entity also has a human-readable code: `uniqueId` (e.g. `PC…`, `SP…`, `SG…`), or `appointmentId` (`A…`) on appointments.
- **Dates are BSON `Date` in UTC.** Most orgs are in `America/New_York`, so pass `timezone: "America/New_York"` to `$dateToString` / `$dateTrunc` when bucketing by day.
- **Soft delete:** org and user collections have `isDeleted` and `isBlocked`. Exclude deleted rows unless asked: `{"isDeleted": false}`.
- **Org names live in different fields:** `pcps.pcpName`, `pcpgroups.pcpGroupName`, `specialists.specialistName`, `specialistgroups.specialistGroupName`, `providers.fullName`, `users.fullName`. Each org also has `entityName` (legal/display entity).
- Every collection has `createdAt`, `updatedAt`, `createdBy`, `updatedBy` (→ users), and `__v`. Every org has `address[]` with `{address, city, state, zipCode, country, timeZone, locationLongLat (GeoJSON Point, 2dsphere-indexed)}`, plus `profilePic` and `profileLogo`. These are omitted from the tables below.
- **Sensitive, never expose:** `users.password`, `previousPasswords`, `otp`, `twoFactorAuthCode`, `sessionInfo`, `socketId`, `appointments.secureCode`. The agent strips these.

## Metric definitions (use in every report)

Booking status is `appointments.currentStatus`, the **latest** status: a referral that was scheduled and later completed reads COMPLETED. Group it into buckets:

| Bucket | `currentStatus` |
|---|---|
| Pending | SUBMITTED, HOLD, REVIEWED, WORK_IN_PROGRESS |
| Confirmed (patient was given a date) | DATE_ADDED, SCHEDULED, RESCHEDULED, COMPLETED, NOSHOW, RESCHEDULE_NOSHOW |
| Lost | CANCELED, EXPIRED |
| Ignored (left out of every count) | MOBILE_UNVERIFIED |

| Metric | Definition (always exclude `isDeveloperAppointment: true` and MOBILE_UNVERIFIED) |
|---|---|
| Requests (referrals received) | appointments by `createdAt` in the period |
| Confirmed | Confirmed bucket |
| Completed / Cancelled / Expired / Rescheduled | COMPLETED / CANCELED / EXPIRED / RESCHEDULED |
| No-shows | NOSHOW + RESCHEDULE_NOSHOW |
| Open backlog | Pending bucket |
| Scheduling rate / cancellation rate | Confirmed ÷ Requests / Cancelled ÷ Requests |

- These are cohort counts: the current status of referrals **created** in the period, not status changes during it. Say so. A referral scheduled and then cancelled reads CANCELED, so it is not counted as Confirmed.
- Recent referrals have had less time to complete, so a lower completion rate for a recent period is not by itself a decline.
- An "imaging centre" or "centre" is a specialist office (`specialists`). Imaging referrals have `appointmentType` MRI_349 or `examType`/`bodyPart` set.

---

## appointments (2,503)

One referral / visit. Data runs from 2024-02 to 2026-09. 951 rows were created in 2026-04, mostly through a CSV import (`isUploadedFromCSV`); about 10–20 a month after that.

**Links**

| Field | Type | Cov. | Notes |
|---|---|---|---|
| `appointmentId` | string | 100% | Human code, e.g. `A834176` |
| `pcpId` | ObjectId | 98% | → pcps (referring office) |
| `pcpGroupId` | ObjectId\|null | 1% | → pcpgroups. Usually null, so derive via `pcps.pcpGroupId[]` |
| `specialistId` | ObjectId\|null | 92% | → specialists (receiving office) |
| `specialistGroupId` | **ObjectId[]**\|null | 78% | → specialistgroups. Array, so match with `{"specialistGroupId": id}` or `$unwind` |
| `providerId` | ObjectId\|null | 92% | → providers |
| `patientId` | ObjectId | 100% | → `patients` collection (not in subset) |
| `appointmentTypeId` | ObjectId\|null | | → defaultappointmenttypes |
| `insuranceId` | ObjectId\|null | | → insuranceplans. `policyNumber` string |
| `bodyPart`, `examType` | ObjectId\|null | | → bodyparts, examtypes (imaging referrals) |
| `medicalCenterId` | ObjectId\|null | 11% | → medicalcenters; `medicalCenterFacility{facilityNumber, facilityName}` |
| `linkedAppointmentId` | ObjectId\|null | | → appointments (follow-up chain) |
| `transactionId` | ObjectId\|null | 8% | → transactions (paid exams) |
| `createdBy`, `originalCreatorId`, `lastChangedBy`, `lastRescheduledBy`, `lastCanceledBy` | ObjectId\|null | | → users (sometimes patients) |
| `createdByPatient` | ObjectId\|null | | → patients (self-booked) |

**Status**

| Field | Values (count) |
|---|---|
| `currentStatus` | SUBMITTED 2058, REVIEWED 197, WORK_IN_PROGRESS 61, RESCHEDULED 61, CANCELED 46, COMPLETED 32, NOSHOW 30, RESCHEDULE_NOSHOW 17, HOLD 1. Valid but no rows yet: SCHEDULED, DATE_ADDED, EXPIRED, MOBILE_UNVERIFIED. Buckets: see Metric definitions |
| `appointmentSubStatus` | SUBMITTED, DATE_ADDED, REFERRAL_UPLOADED, CALLING, INFO_REQUESTED, PROVIDER_NOTES_UPLOADED, PROVIDER_NOTES_DOWNLOADED, NOTCONTACTED, PATIENT CALLED, REVIEWED, REFERRAL_REQUESTED, RESEARCH, NOSHOW |
| `handledStatus` | UNHANDLED 1438, COMMENT_UNHANDLED 1003, HANDLED 62 |
| `appointmentStatusAuthor` | "" (most), RESCHEDULED_BY_PCP, RESCHEDULED_BY_SPECIALIST_GROUP, CANCELED_BY_PCP, CANCELED_BY_SPECIALIST_GROUP, RESCHEDULED_BY_SPECIALIST, CANCELED_BY_SPECIALIST |
| `lastChangedByRole` | "" (most), pcpAdmin, specialistGroupAdmin, patient, specialistAdmin, specialistGroupManager |
| `originalCreatorRole` | "", patient, specialistGroupAdmin, specialist |
| `callOwnership` | SPECIALIST 2473, PCP 30 |
| `isPatientSpokenTo` | YES, NOT_ABLE_TO_CONNECT, NO |
| `urgentStatus` | approve, rescheduled, null |
| `reasonToCancel` | free text |

**Type and dates**

| Field | Type | Notes |
|---|---|---|
| `appointmentType` | string | FULL_SERVICE 1465, SPECIALIST_INITIATED 477, PCP_INITIATED 293, MRI_349 202, REQUEST_DOCUMENT 34, ONLINE 21, FOLLOW_UP 6, TIER_3 3, ORDER 1, BULK 1 |
| `visitType` | string | always IN_PERSON |
| `createdAt` | Date | **Always set; use for "referrals received" reports** |
| `appointmentStartDateTime` / `appointmentEndDateTime` | Date\|null | Scheduled slot. **Null on 1,749 rows (not yet scheduled)** |
| `appointmentDate` | Date\|string\|null | Legacy, mixed types. Avoid; use `appointmentStartDateTime` |
| `appointmentDuration` | number | minutes (0, 15, 30) |
| `timeZone` | string | America/New_York mostly |
| `providerNotesUploadDate`, `lastDocumentDownloadedTime`, `secureCodeCreatedAt` | Date | |

**Flags (boolean):** `isReferralRequired`, `isReferralUploaded`, `isReferralUploadLater`, `isProviderNotesRequired`, `isProviderNotesIncluded`, `isProviderNotesDownloaded`, `isInfoRequested`, `isRequestInfoClosed`, `isRequestInfoShownToPCPs`, `isRequestInfoShownToSpecialists`, `isHighRiskPatient` (134 true), `isUrgentAppointment` (18), `isImmediateAppointment`, `isNewPatient`, `isFollowUp`, `isTransportation` (32) + `transportationProvideBy` PCP/SPECIALIST, `isWheelChairRequired`, `isProcedure`, `isPatientSeen`, `isPaymentCompleted`, `isRatingGiven`, `isUploadedFromCSV`, `isPatientSubmittedAppointment`, `isMriSaturdayAppointment`, `isMriExpediteAppointment`, `isDeveloperAppointment` (test data, exclude when true). Always false here: `isTeleHealth`, `isTeleAppointment`, `rideProcessed`, `reminderSent`, `isOtherInsurance`.

**Counters / money:** `price`, `discount` (7% of rows), `followUpCount`, `faxSentCount`, `smsSentCount`, `callCount`, `patientCallCount`.

**Other text:** `appointmentComments`, `referralPhysicianName`, `otherPcpName`, `businessName`, `patientLanguageSelected` (es 1525, en 975, ht 3), `examNotes[]`, `medicalCondition[]`.

**Embedded arrays**

- `appointmentHistory[]` (65%): `{updatedBy → users, updatedByPatient → patients, updatedAt, updatedEntity[{entityName, action, reason, from, to, fromValue, toValue, comment, isAdded, isUpdated, isDeleted, referenceId}]}`. This is the audit trail, used for status-change timing.
- `handledHistory[]` (43%): `{handledStatus, handledBy → users, handledAt}`
- `subStatusForRequestInfo[]` (3%): info requests. `{uniqueId, requestType (PATIENT_INFO|REFERRAL_MISSING|PATIENT_DENIED|WRONG_REFERRAL|OTHERS), requestStatus (OPEN|CLOSED|RESOLVED), requestedBy → users, requestedAt, requestDescription, subCurrentStatus, requestStatusHistory[{requestSubStatus, comment, performedBy, createdAt}]}`
- `referralAttachments[]`, `providerNotes[]`: `{originalName, fileLink, createdAt}`
- `appointmentNotes`: `{notes, comments, createdBy, createdAt, updatedAt}`
- `patientAddress[]`: address snapshot. `insuranceCard[]`, `checklistItem[{item → providerchecklists, flag}]`, `eFaxLeadId[]` → efaxleads

Indexed for reporting: `currentStatus+createdAt`, `specialistGroupId+createdAt`, `pcpId+createdAt+providerId`, `specialistId+appointmentDate+patientId`, `appointmentType+createdAt`, `appointmentStartDateTime`, `appointmentId`.

---

## users (2,459)

Staff and admin logins for every org type (only 3 are `patient`; real patients are in `patients`).

| Field | Type | Cov. | Notes |
|---|---|---|---|
| `fullName`, `firstName`, `lastName` | string | 100% | |
| `email` | string | 100% | |
| `uniqueId` | string | 100% | |
| `role` | string\|null | 93% | see below |
| `userType` | string | 100% | PARTICIPANT 2378, NON_PARTICIPANT 80, superAdmin 1 |
| `pcpId` | ObjectId\|null | | → pcps (436 users) |
| `pcpGroupId` | ObjectId\|null | | → pcpgroups (27) |
| `specialistId` | ObjectId\|null | | → specialists (1236) |
| `specialistGroupId` | ObjectId\|null | | → specialistgroups (547) |
| `specialistsInSpecialistGroupUsers[]` | ObjectId[] or `{specialistId, providerIds[]}` | 21% | offices this group user can see |
| `pcpsInPcpGroupUsers[]` | array | | |
| `patient_ref_id` | ObjectId\|null | 9% | → patients |
| `isDeleted` | bool | | true 65 |
| `isBlocked` | bool | | true 2393 (dev data: most accounts blocked) |
| `blockType` | string | 21% | MANUAL_BLOCK, INACTIVITY_BLOCK, WRONG_PASSWORD_ATTEMPTS, MANUAL_BLOCK_SP_ADMIN, MANUAL_BLOCK_SPG_ADMIN, MANUAL_BLOCK_PCP_ADMIN |
| `isActive`, `isAdminVerified`, `isEmailVerified`, `isTwoFactorAuthEnabled`, `isPasswordSet`, `isTempPassword`, `isUnsubscribed` | bool | | |
| `lastLoginAt` | Date | 11% | |
| `invalidAttempts` | number | | failed logins |
| `timeZoneId` | string | | America/New_York 2442 |
| `contact` | `{countryCode, mobileNumber, iso}` | 99% | |
| `chatStatus` | string | 10% | Grey, Green, Red |
| `gender`, `dob` | | sparse | |
| `userPreferencesForAppointments` | object | 1% | UI filter prefs |

`role` counts: specialistManager 1038, specialistGroupManager 380, pcpMember 223, null 182, specialistMember 165, pcpAdmin 151, pcpManager 57, specialistGroupAdmin 47, specialistAdmin 33, teleHealthPsr 27, teleHealthMedicalAssistant 24, admin 18, pcpGroupAdmin 16, teleHealthCareManager 16, specialistGroupMember 15, teleManager 12, superAdmin 9, pcpGroupManager 7, teleAdmin 7, teleHealthSpecialistProvider 6, teleHealthCallCenter 5, specialistSuperAdmin 4, patient 3, transportation 3, specialistGroupSuperAdmin 2, pcpSuperAdmin 2, teleHeathPsr 2 (typo variant), pcpGroupSuperAdmin 2, pcpGroupMember 2, pa 1.

Pattern: `{pcp|pcpGroup|specialist|specialistGroup}{SuperAdmin|Admin|Manager|Member}`. The prefix says which link field is set.

---

## pcps (99): primary care offices (referrers)

| Field | Type | Notes |
|---|---|---|
| `pcpName` | string | display name |
| `entityName`, `uniqueId` | string | |
| `pcpGroupId` | **ObjectId[]** | → pcpgroups (23% have one) |
| `specialistsInPcp[]` | ObjectId[] | → specialists this PCP refers to |
| `specialistGroupsInPcp[]` | `{specialistGroupId, specialistIds[]}` | → specialistgroups / specialists |
| `preferredProviders[]` | `{providerId, rank}` | → providers |
| `pcpPreference[]` | `{specialistId, appPreference: Calendar\|Bulk, toggleEnabled}` | |
| `pcpPreferenceForSpg[]` | `{specialistGroupId, appPreference, toggleEnabled}` | |
| `isDeleted` | bool | 28 deleted |
| `isBlocked` | bool | 4 blocked |
| `isHighRiskEnabled`, `isMedicalCenterEnabled`, `canCreateBulkApp` | bool | feature flags (sparse) |
| `faxNumber`, `suiteNumber`, `mobileNumber`, `countryCode`, `iso`, `doctorFareUrl` | string | |
| `timeZoneId` | string | America/New_York 85 |

## pcpgroups (27): groups of PCP offices

| Field | Type | Notes |
|---|---|---|
| `pcpGroupName` | string | |
| `entityName`, `uniqueId` | string | |
| `pcpOfficeInPcpGroup[]` | ObjectId[] | → pcps |
| `isDeleted` | bool | 5 deleted |
| `isBlocked`, `isAdminVerified` | bool | |
| `faxNumber`, `suiteNumber`, `mobileNumber`, `timeZoneId` | string | |

---

## specialists (703): specialist offices (receivers)

| Field | Type | Notes |
|---|---|---|
| `specialistName` | string | office display name |
| `entityName`, `uniqueId` | string | |
| `providersInSpecialist[]` | ObjectId[] | → providers working here |
| `specialistGroupId[]` | ObjectId[] | → specialistgroups (40% have one) |
| `pcpId[]` | ObjectId[] | → pcps connected to this office |
| `insurance[]` | ObjectId[] (some legacy objects) | → insuranceplans accepted |
| `bodyPart[]`, `typeOfStudy[]`, `equipments[]`, `aptTypes[]` | ObjectId[] | → bodyparts, studytypes, equipment, defaultappointmenttypes |
| `surcharges[]` | `{surchargeId, price}` | |
| `defaultDuration`, `teleSlotDuration`, `inPersonSlotDuration` | number | minutes (15 typical) |
| `scheduledHoursLimit` | number | booking lead-time hours |
| `appointmentCreationType` | string | SINGLE, BULK |
| `allowedFeatures[]` | string[] | REQUEST_DOCUMENT, EXAM_PREPARATIONS, BOOK_APPOINTMENT, WORKFLOW_MANAGER, CHAT, SMS_METRICS |
| `isDeleted` | bool | 48 deleted |
| `isBlocked`, `isInsuranceVerified`, `isFeatured`, `isEFaxApt`, `allowProviderSlotsVisibleToPatient` | bool | |
| `insuranceVerifiedAt`, `insuranceVerifiedBy` | Date, → users | |
| metrics | numbers | `metricsUnitsData{totalAppointmentsCount, completedCount, reviewedCount, actedOnCount, rescheduledCount, noShowCount, workInProgressCount, canceledCount}`, `*AppointmentsPercentage`, `avgResponseTime`, `pcpInfoReqCount{open…, closed…}`. **Mostly 0 (stale); compute from appointments instead** |
| `faxNumber`, `eFax`, `suiteNumber`, `mobileNumber`, `SEOSlug`, `qrImage`, `notificationEmailRecipient` | string | |
| `timeZoneId` | string | some legacy offsets like `-240` |

## specialistgroups (113): groups of specialist offices

| Field | Type | Notes |
|---|---|---|
| `specialistGroupName` | string | |
| `entityName`, `uniqueId` | string | |
| `specialistsInSpecialistGroup[]` | `{specialistId, providerIds[]}` | → specialists, providers |
| `pcpId[]` | ObjectId[] | → pcps connected |
| `allowedFeatures[]` | string[] | same set as specialists, plus EFAX |
| `isDeleted` | bool | 4 deleted |
| `isBlocked`, `isAdminVerified`, `isInsuranceVerified`, `isFeatured`, `isEFaxApt`, `isBulkAptEnabled` | bool | |
| metrics | numbers | same stale metric fields as specialists |
| `faxNumber` (bool\|string!), `eFax`, `suiteNumber`, `mobileNumber`, `SEOSlug`, `timeZoneId` | | |

---

## providers (982): individual doctors

| Field | Type | Notes |
|---|---|---|
| `fullName`, `firstName`, `lastName` | string | |
| `uniqueId`, `npiNumber` | string | |
| `specialistId[]` | ObjectId[] | → specialists (offices they work at) |
| `specialty[]` | ObjectId[] | → specialties (`specialtyName`) |
| `degree` | ObjectId\|null | → degrees |
| `language[]`, `disease[]`, `insurance[]` | ObjectId[] | → languages, diseases, insuranceplans |
| `specialistInsurances[]` | `{specialistId, insuranceTypeIds[], insuranceIds[]}` | insurance per office |
| `specialistScheduledHoursLimit[]` | `{specialistId, scheduledHoursLimit}` | |
| `scheduledHoursLimit` | number | |
| `examType`, `examConfig[{examType, price}]`, `consultationConfig[{consultationId, price, duration, visitType, url}]` | | imaging / consult pricing |
| `price` | number\|null | 8% |
| `rank`, `total_rating` | number | mostly 0 |
| `type` | string | PROMOTOR 943, DETRACTOR 4, NEUTRAL 1 (NPS bucket) |
| `isTeleDoctor` | bool | 61 true |
| `isDeleted` | bool | 17 deleted |
| `isBlocked` | bool | 22 blocked |
| `contact{countryCode, mobileNumber, iso}`, `notificationEmailRecipient`, `SEOSlug` | | |

---

## Report query starters

Written in the agent's tool format: `aggregate(collection, pipeline)` with Extended JSON (`{"$oid"}`, `{"$date"}`).

```js
// Referrals received per specialist group since a date
aggregate("appointments", [
  { "$match": { "createdAt": { "$gte": { "$date": "2026-09-09T00:00:00Z" } } } },
  { "$unwind": "$specialistGroupId" },
  { "$group": { "_id": "$specialistGroupId", "total": { "$sum": 1 } } },
  { "$lookup": { "from": "specialistgroups", "localField": "_id", "foreignField": "_id", "as": "g" } },
  { "$project": { "name": { "$first": "$g.specialistGroupName" }, "total": 1 } },
  { "$sort": { "total": -1 } }
])

// Active vs deleted PCP offices in one city (city lives in address[])
aggregate("pcps", [
  { "$match": { "address.city": { "$regex": "^miami$", "$options": "i" } } },
  { "$group": { "_id": "$isDeleted", "n": { "$sum": 1 } } }
])

// Unscheduled SUBMITTED referrals older than a date
aggregate("appointments", [
  { "$match": { "appointmentStartDateTime": null, "currentStatus": "SUBMITTED", "createdAt": { "$lt": { "$date": "2026-10-02T00:00:00Z" } } } },
  { "$count": "n" }
])

// Metric | This period | Previous period | Change %: month to date vs the same days of last month, % change computed here
aggregate("appointments", [
  { "$match": { "isDeveloperAppointment": { "$ne": true }, "currentStatus": { "$ne": "MOBILE_UNVERIFIED" } } },
  { "$set": { "day": { "$dateToString": { "format": "%Y-%m-%d", "date": "$createdAt", "timezone": "America/New_York" } } } },
  { "$set": { "period": { "$switch": { "branches": [
    { "case": { "$and": [{ "$gte": ["$day", "2026-10-01"] }, { "$lte": ["$day", "2026-10-27"] }] }, "then": "this" },
    { "case": { "$and": [{ "$gte": ["$day", "2026-09-01"] }, { "$lte": ["$day", "2026-09-27"] }] }, "then": "last" }
  ], "default": null } } } },
  { "$match": { "period": { "$ne": null } } },
  { "$set": { "m": [
    { "k": "Requests", "o": 1, "v": 1 },
    { "k": "Confirmed", "o": 2, "v": { "$cond": [{ "$in": ["$currentStatus", ["DATE_ADDED", "SCHEDULED", "RESCHEDULED", "COMPLETED", "NOSHOW", "RESCHEDULE_NOSHOW"]] }, 1, 0] } },
    { "k": "Cancelled", "o": 3, "v": { "$cond": [{ "$eq": ["$currentStatus", "CANCELED"] }, 1, 0] } },
    { "k": "Completed", "o": 4, "v": { "$cond": [{ "$eq": ["$currentStatus", "COMPLETED"] }, 1, 0] } },
    { "k": "No-shows", "o": 5, "v": { "$cond": [{ "$in": ["$currentStatus", ["NOSHOW", "RESCHEDULE_NOSHOW"]] }, 1, 0] } }
  ] } },
  { "$unwind": "$m" },
  { "$group": { "_id": { "k": "$m.k", "o": "$m.o" },
    "cur": { "$sum": { "$cond": [{ "$eq": ["$period", "this"] }, "$m.v", 0] } },
    "prev": { "$sum": { "$cond": [{ "$eq": ["$period", "last"] }, "$m.v", 0] } } } },
  { "$sort": { "_id.o": 1 } },
  { "$project": { "_id": 0, "Metric": "$_id.k", "This period": "$cur", "Previous period": "$prev",
    "Change %": { "$cond": [{ "$eq": ["$prev", 0] }, null, { "$round": [{ "$multiply": [{ "$divide": [{ "$subtract": ["$cur", "$prev"] }, "$prev"] }, 100] }, 1] }] } } }
])
```
