# df-dev schema (reporting subset)

MongoDB database `df-dev` (local Docker, `mongodb://localhost:27017/df-dev`). It backs a **referral platform**: a primary care office (PCP) refers a patient to a specialist office, which assigns a provider (the doctor) and schedules the visit. Each referral is an `appointments` document.

This file covers the 9 collections the AI agent reads. **The agent loads this whole file as its system prompt** (`app/api/chat/route.ts`), so a field missing here is a field it can't find. Counts, field coverage and enum values come from a full scan on 2026-10-09. Coverage % = share of documents that have the field.

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
             ── appointmentTypeId ──▶ defaultappointmenttypes (type name, booking channel)
             ── patientId ──────────▶ patients        (NOT users; 76k docs, not in this subset)
             ── createdBy / lastChangedBy / updatedBy ▶ users

specialistgroups ── specialistsInSpecialistGroup[{specialistId, providerIds[]}] ──▶ specialists, providers
                 ── pcpId[] ──▶ pcps
specialists ── providersInSpecialist[] ──▶ providers
            ── specialistGroupId[] ──▶ specialistgroups,  pcpId[] ──▶ pcps
providers   ── specialistId[] ──▶ specialists,  specialty[] ──▶ specialties

users (staff logins) ── pcpId / pcpGroupId / specialistId / specialistGroupId ──▶ the org they work for
```

Reference integrity: every `appointments.pcpId`, `specialistId`, `specialistGroupId`, `providerId` resolves (100%). 4 of 2,503 `patientId`s are orphans. 80% of `appointments.createdBy` resolve to users.

## Conventions (read before querying)

- **All ids are `ObjectId`**, never strings. Filter with `{"pcpId": {"$oid": "…"}}` (Extended JSON). Each entity also has a human-readable code: `uniqueId` (e.g. `PC…`, `SP…`, `SG…`), or `appointmentId` (`A…`) on appointments.
- **Dates are BSON `Date` in UTC.** Most orgs are in `America/New_York`, so pass `timezone: "America/New_York"` to `$dateToString` / `$dateTrunc` when bucketing by day.
- **Soft delete:** org and user collections have `isDeleted` and `isBlocked`. Exclude deleted rows unless asked: `{"isDeleted": false}`.
- **Org names live in different fields:** `pcps.pcpName`, `pcpgroups.pcpGroupName`, `specialists.specialistName`, `specialistgroups.specialistGroupName`, `providers.fullName`, `users.fullName`. Each org also has `entityName` (legal/display entity).
- Every collection has `createdAt`, `updatedAt`, `createdBy`, `updatedBy` (→ users), and `__v`. Every org has `address[]` with `{address, city, state, zipCode, country, timeZone, locationLongLat (GeoJSON Point, 2dsphere-indexed)}`, plus `profilePic` and `profileLogo`. These are omitted from the tables below.
- **Patient data is hidden by the server** before your pipeline runs, also inside `$lookup` and `$unionWith`: patient names, contact details, addresses, notes, comments, documents, insurance numbers and patient logins. For `appointments` and `users`, only the fields listed below exist. Refer to a patient by `patientId`.

## Metric definitions (use in every report)

Booking status is `appointments.currentStatus`, the **latest** status: a referral that was scheduled and later completed reads COMPLETED. Group it into buckets:

| Bucket | `currentStatus` |
|---|---|
| Pending | SUBMITTED, HOLD, WORK_IN_PROGRESS, and REVIEWED **without** an `appointmentStartDateTime` |
| Confirmed (patient was given a date) | REVIEWED **with** an `appointmentStartDateTime`, DATE_ADDED, SCHEDULED, RESCHEDULED, COMPLETED, NOSHOW, RESCHEDULE_NOSHOW |
| Lost | CANCELED, EXPIRED |
| Ignored (left out of every count) | MOBILE_UNVERIFIED |

What the statuses mean (backend code, checked 2026-10-29):
- SUBMITTED: no office action yet. It can already have a date: a PCP picked a calendar slot, or the patient chose one.
- REVIEWED: the office accepted the referral or added a date (adding a date sets REVIEWED). There is no separate "scheduled" status; the office portal shows REVIEWED as "Reviewed/Scheduled". 191 of 197 REVIEWED rows have a date.
- WORK_IN_PROGRESS: an info request or a call was logged while the referral was SUBMITTED.
- SCHEDULED: only tele appointments accepted automatically at creation. DATE_ADDED is normally a sub-status.
- HOLD, MOBILE_UNVERIFIED and EXPIRED: current code never sets them, so only old rows have them. Sub-statuses CALLING, NOTCONTACTED and RESEARCH also come from older code.

| Metric | Definition (always exclude `isDeveloperAppointment: true` and MOBILE_UNVERIFIED) |
|---|---|
| Requests (referrals received) | appointments by `createdAt` in the period |
| Confirmed | Confirmed bucket |
| Acted on | `currentStatus` is not SUBMITTED (the office dashboard's "acted on") |
| Completed / Cancelled / Expired / Rescheduled | COMPLETED / CANCELED / EXPIRED / RESCHEDULED |
| No-shows | NOSHOW + RESCHEDULE_NOSHOW |
| Open backlog | Pending bucket |
| Scheduling rate / acted-on rate / cancellation rate | Confirmed ÷ Requests / Acted on ÷ Requests / Cancelled ÷ Requests |

- These are cohort counts: the current status of referrals **created** in the period, not status changes during it. Say so. A referral scheduled and then cancelled reads CANCELED, so it is not counted as Confirmed.
- Recent referrals have had less time to complete, so a lower completion rate for a recent period is not by itself a decline.
- An "imaging centre" or "centre" is a specialist office (`specialists`). Imaging referrals have `appointmentType` MRI_349 or `examType`/`bodyPart` set.

When a figure differs from a DoctorFare screen, keep these definitions and explain the difference:
- Office and group dashboards count referrals by `createdAt` with no status filter and divide each tile by that total. Their Reviewed tile is REVIEWED now (not "ever reviewed"); their No-show tile is NOSHOW only. On a PCP's dashboard, Rescheduled and Cancelled count only changes made by the specialist side.
- A group's dashboard counts appointments that carry its id in `specialistGroupId`. An office in two groups puts both ids on its appointments, so both groups count them (190 appointments in df-dev).
- Average response time and the stored performance numbers come from a weekly job over the last 7 days, and in df-dev they stop in 2025-06. Compute from appointments instead.
- The office appointment list shows referrals created in the last 90 days by default; the portal text says 45.

Flags from kpis, using the office dashboard thresholds: cancellation and reschedule rates under 10% ok, 10–20% watch, over 20% high; acted-on over 90% ok, 70–90% watch, under 70% low; median days to first action under 2 ok, 2–5 watch, over 5 slow. The dashboard has no thresholds for no-show or scheduling rates, so those are flagged against the median of the other rows ("No-show above median", "Scheduling below median"). Rows with fewer than 20 referrals get no flags.

## Levers for recommendations

The data shows a problem; these are the DoctorFare settings and routines that can address it. In Recommended action, name one in plain words as something to try, and say which figure to watch afterwards. "Admin" means the DoctorFare admin team changes it.

| Signal in the data | Lever |
|---|---|
| High no-show rate at an office | Turn on appointment instructions (exam-prep SMS) for the office (admin: `allowedFeatures` EXAM_PREPARATIONS) |
| Pending referrals with no date, patients hard to reach (`isPatientSpokenTo` NOT_ABLE_TO_CONNECT) | Text patients a booking link (admin: `allowedFeatures` BOOK_APPOINTMENT) |
| Low acted-on rate, old Pending backlog | Office staff work the New tab daily; check the office has staff who log in |
| Info requests of type REFERRAL_MISSING or WRONG_REFERRAL | Ask the referring PCP to attach the referral when booking |
| Cancellations and reschedules the PCP never acknowledges (`handledStatus` UNHANDLED or COMMENT_UNHANDLED) | PCP staff follow up the Changes tab; email/SMS notifications for those events (admin) |
| A PCP linked to offices sends few referrals | Account outreach; check its booking preference for those offices, Calendar or Bulk (`pcps.pcpPreference`) |
| A new office gets little volume | Check its setup: appointment types offered (`aptTypes`), insurance accepted per provider, how far ahead patients can book (`scheduledHoursLimit`) |
| One patient self-booking channel grows (IVR, QR, Link, Web, Online) | Offer that channel at other offices |
| Doctor notes uploaded but not downloaded (`isProviderNotesDownloaded` false) | Remind the PCP to download them |
| High cancellation rate | First see why ("Cancellations by who and why"). Insurance not taken: check the plans the office's providers accept against what its PCPs send (admin: provider insurance). Patient went elsewhere or asked for another provider: schedule sooner (acted-on rate, days to first action). Otherwise: staff offer a reschedule before cancelling |

## Playbooks

What admins want to grow, how to measure it, and what to change.

| Goal | Measure | Lever | Watch |
|---|---|---|---|
| Speed | kpis by office or group: Acted-on %, median days to first action, Pending | Office works the New tab daily; booking links for patients who can't be reached | Acted-on %, days to first action |
| Scheduling | kpis by office, channel or specialty: Scheduling % | Booking links; check the office's appointment types and how far ahead patients can book | Scheduling % |
| Lost referrals | kpis by office, channel or specialty: Cancellation %, No-show %; "Cancellations by who and why" starter | Exam-prep SMS for no-shows; reschedule instead of cancel; insurance setup | Cancellation %, No-show % |
| Network growth | "Dormant PCPs" and "New office activation" starters; kpis by pcp for the share of referrals from the top PCPs | Outreach to dormant PCPs; check new offices' setup | Active PCPs, offices active within 60 days |
| Channels | kpis by channel | Offer the patient self-booking routes that work (IVR, QR, Link, Web) at more offices | Self-booked share |
| Backlog | "Pending by age" starter | Office clears referrals waiting over 14 days first | Pending over 14 days |
| PCP relationship | `handledStatus`, info requests by `requestType`, doctor notes not downloaded | PCP follows up the Changes tab; referral attached at booking | Handled share, info requests per 100 referrals |
| Specialty mix | kpis by specialty | Recruit offices where scheduling lags demand | Scheduling % by specialty |

Attention briefing (for "what needs my attention?"). Use the last 30 days compared with the 30 days before, unless the user gives a period. If that period has no referrals, say so and use the latest full month that has data. Check:
1. kpis by none: total referrals and rates against the previous period.
2. kpis by office, sorted by "Pending": offices with the most open referrals, and their flags.
3. kpis by office: offices with 20+ referrals flagged high, low or slow.
4. "Dormant PCPs" starter: PCPs that stopped referring.
5. "Pending by age" starter: referrals waiting over 14 days.
Reply with an answer line, then up to 5 items as | Priority | What | Referrals affected | Recommended action | Watch |, most referrals affected first, then the Based on line, Recommendation and Follow-up questions.

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
| `appointmentTypeId` | ObjectId\|null | 99% | → defaultappointmenttypes: type name (Calendar, Bulk, IVR, QR…) and booking channel |
| `insuranceId` | ObjectId\|null | | → insuranceplans (not readable) |
| `bodyPart`, `examType` | ObjectId\|null | | → bodyparts, examtypes (imaging referrals) |
| `medicalCenterId` | ObjectId\|null | 11% | → medicalcenters (not readable) |
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
| `cancelReason` | Set by the server from the reason staff picked: Patient requested another provider 27, Patient already had the exam done at other facilities 8, We do not take the insurance selected 5, Others 15 (typed by staff; the text is hidden), null when none |

**Type and dates**

| Field | Type | Notes |
|---|---|---|
| `appointmentType` | string | FULL_SERVICE 1465, SPECIALIST_INITIATED 477, PCP_INITIATED 293, MRI_349 202, REQUEST_DOCUMENT 34, ONLINE 21, FOLLOW_UP 6, TIER_3 3, ORDER 1, BULK 1. A category, not the channel: SPECIALIST_INITIATED includes 230 patient self-bookings (`isPatientSubmittedAppointment`). For channels use kpis by channel |
| `visitType` | string | always IN_PERSON |
| `createdAt` | Date | **Always set; use for "referrals received" reports** |
| `appointmentStartDateTime` / `appointmentEndDateTime` | Date\|null | Scheduled slot. **Null on 1,749 rows (not yet scheduled)** |
| `appointmentDate` | Date\|string\|null | Legacy, mixed types. Avoid; use `appointmentStartDateTime` |
| `appointmentDuration` | number | minutes (0, 15, 30) |
| `timeZone` | string | America/New_York mostly |
| `providerNotesUploadDate`, `lastDocumentDownloadedTime`, `secureCodeCreatedAt` | Date | |

**Flags (boolean):** `isReferralRequired`, `isReferralUploaded`, `isReferralUploadLater`, `isProviderNotesRequired`, `isProviderNotesIncluded`, `isProviderNotesDownloaded`, `isInfoRequested`, `isRequestInfoClosed`, `isRequestInfoShownToPCPs`, `isRequestInfoShownToSpecialists`, `isHighRiskPatient` (134 true), `isUrgentAppointment` (18), `isImmediateAppointment`, `isNewPatient`, `isFollowUp`, `isTransportation` (32) + `transportationProvideBy` PCP/SPECIALIST, `isWheelChairRequired`, `isProcedure`, `isPatientSeen`, `isPaymentCompleted`, `isRatingGiven`, `isUploadedFromCSV`, `isPatientSubmittedAppointment`, `isMriSaturdayAppointment`, `isMriExpediteAppointment`, `isDeveloperAppointment` (test data, exclude when true). Always false here: `isTeleHealth`, `isTeleAppointment`, `rideProcessed`, `reminderSent`, `isOtherInsurance`.

**Counters / money:** `price`, `discount` (7% of rows), `followUpCount`, `faxSentCount`, `smsSentCount`, `callCount`, `patientCallCount`.

**Other:** `businessName` (brand), `patientLanguageSelected` (es 1525, en 975, ht 3).

**Embedded arrays**

- `appointmentHistory[]` (65%): `{updatedBy → users, updatedAt, updatedEntity[{entityName}]}`; event names outside the known list read "Other". This is the audit trail, used for status-change timing. Status changes have `updatedEntity.entityName` Reviewed, DATE_ADDED, REVIEWED_AND_DATE_ADDED, workInProgress, Canceled, NoShow, Complete, or a name starting with "Rescheduled" (several variants); the entry's `updatedAt` is when it happened. Time to first office action = earliest such `updatedAt` − `createdAt` (256 appointments have a Reviewed or DATE_ADDED entry). Most other entries are comments, notes and fax events.
- `handledHistory[]` (43%): `{handledStatus, handledBy → users, handledAt}`
- `subStatusForRequestInfo[]` (3%): info requests. `{requestType (PATIENT_INFO|REFERRAL_MISSING|PATIENT_DENIED|WRONG_REFERRAL|OTHERS), requestStatus (OPEN|CLOSED|RESOLVED), requestedBy → users, requestedAt}`
- `eFaxLeadId[]` → efaxleads (not readable)
- Documents: use the flags `isReferralUploaded`, `isProviderNotesIncluded`, `isProviderNotesDownloaded` and `providerNotesUploadDate`; the files themselves are hidden.

Indexed for reporting: `currentStatus+createdAt`, `specialistGroupId+createdAt`, `pcpId+createdAt+providerId`, `specialistId+appointmentDate+patientId`, `appointmentType+createdAt`, `appointmentStartDateTime`, `appointmentId`.

---

## users (2,274 visible)

Staff and admin logins for every org type. The server hides 185 patient logins (182 chat-patient accounts with no role and 3 with `role` patient); the counts below were taken before hiding, so some include them.

| Field | Type | Cov. | Notes |
|---|---|---|---|
| `fullName`, `firstName`, `lastName` | string | 100% | |
| `uniqueId` | string | 100% | |
| `role` | string\|null | 93% | see below |
| `userType` | string | 100% | PARTICIPANT 2378, NON_PARTICIPANT 80, superAdmin 1 |
| `pcpId` | ObjectId\|null | | → pcps (436 users) |
| `pcpGroupId` | ObjectId\|null | | → pcpgroups (27) |
| `specialistId` | ObjectId\|null | | → specialists (1236) |
| `specialistGroupId` | ObjectId\|null | | → specialistgroups (547) |
| `specialistsInSpecialistGroupUsers[]` | ObjectId[] or `{specialistId, providerIds[]}` | 21% | offices this group user can see |
| `pcpsInPcpGroupUsers[]` | array | | |
| `isDeleted` | bool | | true 65 |
| `isBlocked` | bool | | true 2393 (dev data: most accounts blocked) |
| `blockType` | string | 21% | MANUAL_BLOCK, INACTIVITY_BLOCK, WRONG_PASSWORD_ATTEMPTS, MANUAL_BLOCK_SP_ADMIN, MANUAL_BLOCK_SPG_ADMIN, MANUAL_BLOCK_PCP_ADMIN |
| `isActive`, `isAdminVerified`, `isEmailVerified`, `isTwoFactorAuthEnabled`, `isPasswordSet`, `isTempPassword`, `isUnsubscribed` | bool | | |
| `lastLoginAt` | Date | 11% | |
| `invalidAttempts` | number | | failed logins |
| `timeZoneId` | string | | America/New_York 2442 |
| `chatStatus` | string | 10% | Grey, Green, Red |

`role` counts: specialistManager 1038, specialistGroupManager 380, pcpMember 223, specialistMember 165, pcpAdmin 151, pcpManager 57, specialistGroupAdmin 47, specialistAdmin 33, teleHealthPsr 27, teleHealthMedicalAssistant 24, admin 18, pcpGroupAdmin 16, teleHealthCareManager 16, specialistGroupMember 15, teleManager 12, superAdmin 9, pcpGroupManager 7, teleAdmin 7, teleHealthSpecialistProvider 6, teleHealthCallCenter 5, specialistSuperAdmin 4, transportation 3, specialistGroupSuperAdmin 2, pcpSuperAdmin 2, teleHeathPsr 2 (typo variant), pcpGroupSuperAdmin 2, pcpGroupMember 2, pa 1.

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

## specialties (63)

| Field | Type | Notes |
|---|---|---|
| `specialtyName` | string | Free text with inconsistent case and spacing ("cardiologist", "Cardiologist", "Cardiothoracic "). Group by the trimmed, lowercased name |
| `inSpanish` | string | Spanish name |
| `isDeleted`, `isBlocked` | bool | |

Specialty is not on appointments: `appointments.providerId` → `providers.specialty[]` → `specialties`. A provider can have several specialties, so counts per specialty can add up to more than the total; say so.

## defaultappointmenttypes (21): appointment type catalog

| Field | Type | Notes |
|---|---|---|
| `appointmentType` | string | Display name: Calendar, Bulk, Full Service, Cash MRI, Order, Tier 3, Online, Request Document, Specialist Initiated, Follow Up, Follow Up Procedure, IVR, Web, QR, Link, PCP Developer, SP Developer |
| `type` | string | Category, matches `appointments.appointmentType` |
| `appointmentOrigin` | string | PCP_INITIATED, SPECIALIST_INITIATED, DEVELOPER_PCP, DEVELOPER_SPECIALIST |
| `isDeleted` | bool | Deleted types still name old appointments; don't filter them out of a lookup |

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

// Dormant PCPs: linked to specialist offices, but no referral since a cutoff (here 60 days before 2026-10-29). Never-referred PCPs have no last date
aggregate("pcps", [
  { "$match": { "isDeleted": false, "$or": [{ "specialistsInPcp.0": { "$exists": true } }, { "specialistGroupsInPcp.0": { "$exists": true } }] } },
  { "$lookup": { "from": "appointments", "localField": "_id", "foreignField": "pcpId", "pipeline": [{ "$group": { "_id": null, "last": { "$max": "$createdAt" }, "n": { "$sum": 1 } } }], "as": "a" } },
  { "$set": { "last": { "$first": "$a.last" }, "referrals": { "$ifNull": [{ "$first": "$a.n" }, 0] } } },
  { "$match": { "$or": [{ "last": null }, { "last": { "$lt": { "$date": "2026-08-30T00:00:00Z" } } }] } },
  { "$sort": { "referrals": -1 } },
  { "$project": { "_id": 0, "PCP": "$pcpName", "Referrals ever": "$referrals", "Last referral": { "$dateToString": { "format": "%Y-%m-%d", "date": "$last", "timezone": "America/New_York" } } } }
])

// Pending by age: open referrals (no office action, or reviewed without a date) by days waiting. Add specialistId to the group for a per-office split
aggregate("appointments", [
  { "$match": { "isDeveloperAppointment": { "$ne": true }, "$or": [{ "currentStatus": { "$in": ["SUBMITTED", "HOLD", "WORK_IN_PROGRESS"] } }, { "currentStatus": "REVIEWED", "appointmentStartDateTime": null }] } },
  { "$set": { "days": { "$dateDiff": { "startDate": "$createdAt", "endDate": "$$NOW", "unit": "day" } } } },
  { "$group": { "_id": { "$switch": { "branches": [
    { "case": { "$lte": ["$days", 7] }, "then": "1 0-7 days" },
    { "case": { "$lte": ["$days", 14] }, "then": "2 8-14 days" },
    { "case": { "$lte": ["$days", 30] }, "then": "3 15-30 days" },
    { "case": { "$lte": ["$days", 90] }, "then": "4 31-90 days" }
  ], "default": "5 over 90 days" } }, "Referrals": { "$sum": 1 } } },
  { "$sort": { "_id": 1 } },
  { "$project": { "_id": 0, "Waiting": { "$substrCP": ["$_id", 2, 20] }, "Referrals": 1 } }
])

// Cancellations by who cancelled and why (cancelReason is the reason staff picked, or "Others")
aggregate("appointments", [
  { "$match": { "currentStatus": "CANCELED", "isDeveloperAppointment": { "$ne": true } } },
  { "$group": { "_id": { "by": { "$cond": [{ "$gt": ["$appointmentStatusAuthor", ""] }, "$appointmentStatusAuthor", "Not recorded"] }, "reason": { "$ifNull": ["$cancelReason", "No reason given"] } }, "n": { "$sum": 1 } } },
  { "$sort": { "n": -1 } },
  { "$project": { "_id": 0, "Cancelled by": "$_id.by", "Reason": "$_id.reason", "Referrals": "$n" } }
])

// New office activation: specialist offices created per month, and how many got their first referral within 60 days
aggregate("specialists", [
  { "$match": { "isDeleted": false, "createdAt": { "$gte": { "$date": "2025-01-01T00:00:00Z" } } } },
  { "$lookup": { "from": "appointments", "localField": "_id", "foreignField": "specialistId", "pipeline": [{ "$group": { "_id": null, "first": { "$min": "$createdAt" } } }], "as": "a" } },
  { "$set": { "first": { "$first": "$a.first" } } },
  { "$group": { "_id": { "$dateToString": { "format": "%Y-%m", "date": "$createdAt", "timezone": "America/New_York" } }, "New offices": { "$sum": 1 },
    "Active within 60 days": { "$sum": { "$cond": [{ "$and": [{ "$ne": [{ "$ifNull": ["$first", null] }, null] }, { "$lte": [{ "$subtract": ["$first", "$createdAt"] }, 5184000000] }] }, 1, 0] } } } },
  { "$sort": { "_id": 1 } },
  { "$project": { "_id": 0, "Month": "$_id", "New offices": 1, "Active within 60 days": 1 } }
])

// Referrals by booking channel per month: add the month to the group. For channel rates use kpis by channel. The channel is the appointment type's catalog name;
// CSV imports, eFax leads and patient self-bookings override it, first match wins. Patient self-bookings show their route, e.g. "Patient self-booked: IVR"
aggregate("appointments", [
  { "$match": { "isDeveloperAppointment": { "$ne": true }, "currentStatus": { "$ne": "MOBILE_UNVERIFIED" } } },
  { "$lookup": { "from": "defaultappointmenttypes", "localField": "appointmentTypeId", "foreignField": "_id", "pipeline": [{ "$project": { "_id": 0, "appointmentType": 1 } }], "as": "t" } },
  { "$set": { "label": { "$ifNull": [{ "$first": "$t.appointmentType" }, "$appointmentType"] } } },
  { "$group": { "_id": { "$switch": { "branches": [
    { "case": { "$eq": ["$isUploadedFromCSV", true] }, "then": "CSV import" },
    { "case": { "$gt": [{ "$size": { "$ifNull": ["$eFaxLeadId", []] } }, 0] }, "then": "eFax lead" },
    { "case": { "$or": [{ "$eq": ["$isPatientSubmittedAppointment", true] }, { "$ne": [{ "$ifNull": ["$createdByPatient", null] }, null] }] }, "then": { "$concat": ["Patient self-booked: ", "$label"] } }
  ], "default": "$label" } }, "Referrals": { "$sum": 1 } } },
  { "$sort": { "Referrals": -1 } },
  { "$project": { "_id": 0, "Channel": "$_id", "Referrals": 1 } }
])
```
