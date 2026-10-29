# DoctorFare Office Portal: Business Workflows

*Business-process knowledge layer for the `office` web panel (Angular 14). It describes **what the business does through this app**, who does it, in what order, under which rules, and which code and API implements each step. For the feature inventory see [feature-list.md](feature-list.md). For component internals see [appointments/DOCUMENTATION.md](src/app/layout/appointments/DOCUMENTATION.md) and [bulk-appointment/DOCUMENTATION.md](src/app/layout/bulk-appointment/DOCUMENTATION.md).*

**Scope and trust level.** This file is derived from the front-end code only. The backend (`apiBaseUrl`), the ride service (`lyftApiUrl`) and the patient portal (`patient.doctorfare.com`) are separate systems. Anything they do after a request leaves the browser is marked **(inferred)**. Section 15 lists known gaps.

---

## 1. Purpose in one paragraph

The portal is a care-coordination hub. A **PCP** (primary care office) refers a patient to a **Specialist** office. Both sides then track that referral through scheduling, patient contact, visit outcome, documents and optional transportation. Specialists also run patient-intake channels (eFax leads, SMS booking links, document requests). Everything is organised around one record, the **Appointment**, whose status and sub-status drive which tab it shows in and which actions are allowed.

---

## 2. Actors and roles

| Entity category (`profileData.entity.entityCategory`) | Roles (from `constant.entityRoles`) | What they do here |
|---|---|---|
| `Pcp` / `PcpGroup` | `pcpAdmin`, `pcpManager`, `pcpMember` | Refer patients, book slots, upload referrals, request follow-ups, book rides, bulk upload |
| `Specialist` | `specialistAdmin/Manager/Member` | Receive referrals, set availability, contact patients, confirm/complete/no-show, send eFax/SMS, manage leads |
| `SpecialistGroup` | `specialistGroupAdmin/Manager/Member` | Same as Specialist, across several offices in the group |
| `tele` (Telehealth) | `teleAdmin`, `teleManager`, `teleHealthPsr`, `teleHealthCareManager`, `teleHealthCallCenter`, `teleHealthSpecialistProvider`, `teleHealthMedicalAssistant` | Care-manager and call-centre style work on appointments |
| Transportation | any role containing `transportation` | Sidebar is reduced to Rides, Profile, Support (`side-bar.component.ts`) |
| Patient (no login) | n/a | Uses public links: booking confirmation, document upload, unsubscribe |
| Out-of-network specialist office (no login) | n/a | Uses tokenised Tier 3 links and a secure code |

**Role derivation rules the code relies on**
- `role.includes('pcp')`, `role.includes('specialist')`, `role.includes('Admin'|'Manager')` are string matches used for menus, columns and actions.
- Admin or Manager roles see **Users** and **API Key** in the sidebar.
- Specialist admin/manager roles also see **Insurances**.
- PCP roles see **Bulk Csv Upload**. Specialist roles see **Refer Patient**.

**Feature flags** live in `profileData.entity.allowedFeatures`. They are enforced by `LayoutGuard.canLoad` for non-PCP entities (PCP entities bypass the check) and by sidebar visibility.

| Flag | Unlocks |
|---|---|
| `CHAT` | Support / Chat |
| `REQUEST_DOCUMENT` | Request Documents |
| `BOOK_APPOINTMENT` | Appointment Booking Links |
| `EXAM_PREPARATIONS` | Appointment Instructions (exam prep) |
| `SMS_METRICS` | SMS Outreach Metrics |
| `WORKFLOW_MANAGER` | eFax Workflow Manager Leads |

Other entity-level switches: `isHighRiskEnabled`, `isMedicalCenterEnabled`, `isInsuranceVerified`, `SEOSlug` (required to build patient-facing links).

---

## 3. Core domain objects

| Object | Meaning | Key fields seen in code |
|---|---|---|
| **Appointment** | A referral and visit request between a PCP and a Specialist office | `appointmentId`, `appointmentTypeId.type`, `currentStatus`, `appointmentSubStatus`, `appointmentDate`, `appointmentStartDateTime`, `callOwnership` (`PCP`/`SPECIALIST`), `isPatientSpokenTo` (`YES`/`NOT_ABLE_TO_CONNECT`), `isUrgentAppointment`, `isHighRiskPatient`, `handledStatus`, `linkedAppointmentId`, `referralAttachments`, `providerNotes`, `examReports` |
| **Patient** | Person receiving care | name, `dob`, `contact{countryCode, mobileNumber}`, address, insurance, `documentsByFolder` |
| **Specialist office / Specialist group** | Receiving organisation | providers (exams), availability, insurances, eFax, `SEOSlug` |
| **Provider (exam)** | A bookable exam or doctor under a specialist office | specialty, checklist, insurance list |
| **Slot** | Availability unit | `slotId`, start/end, `isGeneratedOnRunTime` |
| **Request Info** | Question raised on an appointment | `requestType`, description; opened, then resolved or closed |
| **Ride** | Transportation booking in the ride service | `rideExternalId`, `status`, `confirmationStatus`, `rideCreationType` (Manual/Auto/Return) |
| **eFax Lead** | Inbound fax turned into a work item | `leadId`, tag (work type), status, patient info, `isMarkCompleted` |
| **Requested Document** | SMS-triggered patient upload request | `requestId`, status `PENDING`/`SUBMITTED`/`REVIEWED` |
| **Draft** | Saved bulk-appointment form | max 3 per group |

### Appointment types (`APT_STATUSES.APT_TYPES`)
`PCP_INITIATED`, `SPECIALIST_INITIATED`, `FOLLOW_UP`, `FOLLOW_UP_PROCEDURE`, `FULL_SERVICE`, `ORDER`, `TIER_3`.

### Status model (`constant.BookingStatus`, `APT_STATUSES`)
- **Main statuses:** `SUBMITTED`, `REVIEWED` ("Reviewed/Scheduled"), `WORK_IN_PROGRESS`, `RESCHEDULED`, `RESCHEDULE_NOSHOW`, `NOSHOW`, `COMPLETED`, `CANCELED`, `EXPIRED`, `MOBILE_UNVERIFIED`.
- **Sub-statuses:** `CALLING`, `INFO_REQUESTED`, `DATE_ADDED`, `REFERRAL_UPLOADED`, `REFERRAL_REQUESTED`, `FOLLOW_UP_REFERRAL_UPLOADED`, `PROVIDER_NOTES_UPLOADED`, `PROVIDER_NOTES_DOWNLOADED`.
- Actor-suffixed variants exist for display (`RESCHEDULED_BY_PCP`, `CANCELED_BY_SPECIALIST`, `RESCHEDULE_NOSHOW_BY_SP`, and so on). `CANCELED` and `CANCELLED` spellings both occur.

### Appointments list tabs
`All`, `New`, `Changes` (Cancel, Reschedule, Reschedule-NoShow, NoShow), `Request Info`, `Closed Request Info`, `Follow Up`, `Doctor Notes`, `Full Service`, `High Risk Patients` (flagged). Source: `appointments/DOCUMENTATION.md`; tab numbering is in `appointments.component.ts`. The code confirms `Changes` is tab-driven (`setAppointmentStatusFilter`) and High Risk is tab 9.

---

## 4. Workflow index

| ID | Workflow | Primary actors |
|---|---|---|
| WF-01 | Sign-in, 2FA, session and access control | All staff |
| WF-02 | Find a specialist and book (PCP-initiated referral) | PCP |
| WF-03 | Full Service referral | PCP, Specialist |
| WF-04 | Specialist-initiated referral ("Refer Patient") | Specialist |
| WF-05 | Tier 3 referral to an out-of-network specialist | PCP, external specialist office |
| WF-06 | Appointment lifecycle and daily work queue | Specialist, PCP |
| WF-07 | Reschedule, cancel, no-show | Specialist, PCP |
| WF-08 | Info request (clarification loop) | Specialist, PCP |
| WF-09 | Follow-up referral and doctor notes | PCP, Specialist |
| WF-10 | Referral, exam report and document handling | PCP, Specialist |
| WF-11 | Bulk appointment creation (manual and CSV) | PCP |
| WF-12 | Patient transportation (rides) | PCP, Transportation |
| WF-13 | eFax lead intake (Workflow Manager) | Specialist |
| WF-14 | Patient engagement: document requests, booking links, SMS booking, exam prep | Specialist |
| WF-15 | Patient registry and documents | Specialist |
| WF-16 | Availability and calendar management | Specialist |
| WF-17 | Chat and support | PCP, Specialist, Support |
| WF-18 | Dashboard, performance and high-risk follow-through | All, Specialist |
| WF-19 | Users, API keys and account security | Admin, Manager |

---

## 5. WF-01: Sign-in, 2FA, session and access control

**Trigger:** user opens the app. `/` redirects to `/login`. `AuthGuard` sends already-signed-in users to `/dashboard`.

**Steps**
1. User submits email and password. The portal creates a device `uuid` (a timestamp kept in `localStorage`) if none exists, then calls `POST users/login` with `role: 'user'`.
2. Branch on the response (in this order, `login.component.ts`):
   - Message "already logged in on another device" → go to `/active-sessions` with the session data encoded in the query string. The user can end other sessions (`PUT users/logoutOtherDevices/{id}`) and retry.
   - `tempPasswordResetToken` present (admin-issued temp password) → go to `/reset-password?...type=adminreset`.
   - `isPasswordToBeChanged` → modal `PasswordExpired`. Login does not complete until the password is changed.
   - `twoFactorAuthRequired` and `verifyToken` → go to `/step-verify/:id/:phone`. User enters a 4-digit OTP (`PUT users/verify`). Resend uses `PUT users/resendTwoFactorCode`.
   - Otherwise `setTokenData` stores the token, role and profile, then navigates to `dashboard`.
3. After OTP success, saved appointment-list and calendar preferences from the profile are cached locally.

**Every page load after login:** `TokenGuard.canLoad` calls `GET users/token` to refresh the profile. 401 or 403 means toast, then logout (clears `localStorage` but keeps `uuid` and the two "popup seen" flags). Any other non-200 returns `false` without logging out (the user stays on the current page, no navigation).

**Cross-cutting HTTP rules**
- `JwtInterceptor` adds `Authorization: Bearer`, `businessName` (white-label brand from domain), `timestamp` and `utcoffset`.
- `ErrorInterceptor`: 401 → toast and logout; 403 → raises the "user session" event (`handleUserSession`) instead of a toast; 417 → silent (callers handle it); 0 → "check internet connection"; others → toast. High-risk-patient popup calls are exempt.
- `VersionInterceptor` (production only): if the server's `versions.officePortal` differs from `constant.version` (currently 730), the page hard-reloads. **Bump `constant.version` on every release that must force clients to refresh.**

**Account blocks** (`USER_BLOCK_TYPES`): manual block by Admin, PCP Admin or Specialist Admin; 30 days inactivity; 10 consecutive wrong passwords.

**Post-login popups on the dashboard** (in order of the code paths): product tour (first time), insurance-verification prompt (specialist entities with `isInsuranceVerified` false), mobile-verification prompt (dismissal lasts for the login session), "What's New" info-request notice (one time), high-risk-patient confirmation (WF-18).

---

## 6. WF-02: PCP-initiated referral (the standard booking)

**Actor:** PCP user. **Entry:** sidebar "Calendar/Provider" → `/specialist-listing/...`.

**Steps**
1. Browse or search specialist offices (`specialist-listing/lists|list`). Optionally filter with advanced filters. Open an office (`offices/:id`), then its calendar (`calendar/:id[/:groupId]`).
2. Pick a provider (exam) and a date and time slot. The choice is held in `localStorage` (`selectedOfficeFromCalender`, `selectedDocFromCalendar`, `selectedSlotsDetails`).
3. Open `create-appointment/:officeId/:providerId`. The route query `type` selects the mode: `FULL_SERVICE`, `SPECIALIST_INITIATED`, otherwise `PCP_INITIATED`.
4. Fill the form:
   - **Patient:** search existing patients (`GET patients/{entityId}/{role}`) or enter new: first name, last name, language, mobile (10–14 chars), date of birth, all required.
   - **Insurance** (required; list comes from the chosen provider).
   - **Appointment type** (required, loaded per office) and **visit type** (required).
   - Optional: external ID, policy number (becomes required once an insurance is chosen), comments, address, apartment, referral attachments (uploaded via `common/uploadFile`).
   - Flags: follow-up, transportation, wheelchair, new patient, procedure.
   - If `isHighRiskEnabled`: a high-risk yes/no is required. If the answer is yes, **Medical Center Facility** becomes required.
   - `PcpGroup` users must also choose the PCP (`pcpId`, `pcpGroupId`).
   - If transportation is on: address and "transportation provided by" become required.
5. Submit `POST appointment/create`.

**System rules at submit (`createAppointmentPayload`)**
- `appointmentDate` is sent only for `PCP_INITIATED`; slot id is sent if the slot was predefined.
- For non-Full-Service types, `isPatientSpokenTo` defaults to `YES`.
- Mobile validation by Twilio is **commented out**; `isMobileValid` is always true in the UI path, so `MOBILE_UNVERIFIED` is set by the backend or the verify-mobile modal, not by this form.
- HTTP **420** means probable duplicate patient. The form switches to a tab listing matching patients to pick from.

**Outcome:** toast, calendar caches cleared, user goes to `/appointments`. New appointment appears with status `SUBMITTED` (naming from `BookingStatus`; actual initial status is set by backend, inferred).

**Ride auto-processing at creation:** see WF-12.

---

## 7. WF-03: Full Service referral

A Full Service appointment is one where the **specialist office does the patient outreach and scheduling**, so the appointment may exist **without a date** and carries `callOwnership`.

**Differences from WF-02**
- Created with query `type=FULL_SERVICE`. `isPatientSpokenTo` is not preset.
- Has its own tab. The `withWithoutDate` filter finds those with or without a date.
- **Call tracking (`ProgressModalComponent`, `POST appointment/{id}/wip`):**
  - Only the call owner can open it (`stateProgress`). A PCP cannot act on a Specialist-owned call and vice versa; for **non**-Full-Service the other side instead gets the "Was patient spoken to?" dialog.
  - Sub-status `CALLING` with call count (first call, second call), or "unreachable" which stores `isPatientSpokenTo = NOT_ABLE_TO_CONNECT`.
  - Notes are stored as text lines in `appointmentNotes.notes`, formatted `**WIP - First Call|Second Call - {timestamp} - {note}**`. General notes use `{note} - Specialist Added|PCP Added - {timestamp}`. Anyone editing the parser must keep these formats.
  - Adding a date from the modal chains into the date modal (`dateAdded`).
- Cancel rule: a date-less Full Service appointment can be cancelled directly with a reason when the user is a non-PCP; otherwise the "needs a date first" gate applies (WF-07).
- eFax-created appointments (WF-13) are always `FULL_SERVICE` with visit type `IN_PERSON`.

---

## 8. WF-04: Specialist-initiated referral ("Refer Patient")

**Actor:** Specialist user (sidebar "Refer Patient" or dashboard "Book an Appointment").

Two routes exist.
1. **Full form:** `specialist-listing/lists?fromReferPatient` → create-appointment with `type=SPECIALIST_INITIATED`. Submits to `POST appointment/specialist-office`.
2. **Dashboard modal (`SpecialistCreateApptModal`)** with three `bookingType` values:
   | Type | Title | Required input | API |
   |---|---|---|---|
   | 1 | Book An Appointment | name, DOB, mobile, language, specialist office, provider | `POST appointment/specialistInitiated` |
   | 3 | Book Appointment via SMS | mobile and language only | `POST appointment/guestPatient` |
   | 4 | Request Document | name, DOB, mobile, language; office and provider optional | `POST appointment/requestDocument` |

   A specialist **group** user must choose the office. Types 1 and 4 take a full name; a last name is mandatory for new patients.

**Patient step (inferred):** types 1 and 3 send the patient an SMS link. The patient opens `/specialist-booking-confirmation?token&id`, completes first name, last name, DOB, language and insurance, and confirms. That page reads `appointment/tier3Details/{id}` and confirms through `PUT appointment/{id}/confirmTier3` using the token as bearer.

---

## 9. WF-05: Tier 3 referral (out-of-network specialist)

**Purpose:** refer a patient to a specialist who has no portal account.

**PCP side**
1. From the specialist list, choose the Tier 3 option (`specialist-listing/tier3-appointment/:id/:pid`, component `tier3-create-appointment`).
2. Enter the provider (full name required), specialty, office name, address, office phone, contact name and **eFax**, plus the usual patient, insurance and visit details.
3. Submit `POST appointment/createTier3`. All four sub-forms (patient, appointment, provider, specialist) must be valid. Addresses must be Google-validated when transportation is on or when manually typed.

**Specialist office side (public, no login)** *(delivery by fax/short link is inferred)*
1. The office reaches the portal by either:
   - a short link `/tier3/:token`, which resolves through `common/getCompleteUrl` and redirects; or
   - `/tier3-appointment`, where they enter their **eFax number and secure code** (`POST appointment/verifySecureCode`) to receive the appointment link.
2. The confirmation page `/tier3-confirmation?token&id` loads `appointment/tier3Details/{id}`.
3. The office picks duration (default 15 minutes), date and a time, optionally ticks "patient could not be reached", and confirms (`PUT appointment/{id}/confirmTier3`), or cancels with a reason (`PUT appointment/{id}/cancelTier3`).
4. A **"last 4 characters of the secure code"** check exists (`verify-npi` modal, `POST appointment/{id}/confirmSecureCode`), but the call that opens it is **commented out** in `tier3-appt-confirmation.component.ts`, so it is not active in the current build. The secure code is still checked at `/tier3-appointment`.
5. A 417 response shows "session timeout".
6. If `appointmentSubStatus != 'SUBMITTED'` the page shows the appointment as already handled.

---

## 10. WF-06: Daily appointment work queue

**Entry:** `/appointments` (the hub). Filters persist per entity in `localStorage` and can be saved server-side as the user's default (`setUserPreferences`, then a token refresh).

**Typical specialist day**
1. Open **New** or **Submitted**. Review referral and patient data (green eye icon → full detail dialog).
2. Mark **Reviewed** (`PUT appointment/{id}/review`). If the appointment has no date, add one first (WF-07 gateway).
3. Contact the patient: call, SMS, or eFax. Record the call result (Full Service: progress modal; others: "spoken to" dialog `PUT .../patientSpokenTo`).
4. Log blockers as an **info request** (WF-08) or **notes**.
5. After the visit mark **Complete** or **No-Show**; upload **doctor notes** and **exam report** (WF-09/10).

**Typical PCP day**
- Watch **Changes** for cancels, reschedules and no-shows. The circle toggles Handled/Unhandled (`PUT appointment/{id}/hanldeUnhandle`). Comment rows are marked read first, then the comment modal opens.
- Answer **Request Info**.
- Download **Doctor Notes** (this changes status to *Doctor Notes Downloaded*).
- Create **Follow Up**s.

**Business rules baked into the list**
- Date filter range: last 45 days to today; default last 45 days.
- Documents expire: when `isDocumentExpired` is true, downloads are replaced by an alert that documents are not available beyond **120 days**.
- Urgent appointments (rocket icon): specialist clicks **Approve Request** (`POST appointments/{id}/approveUrgentRequest`) or **Reschedule** (opens reschedule flow).
- Adding a date on an appointment offers (if `EXAM_PREPARATIONS` is on) to **send appointment instructions** next (WF-14).
- Tab counts come from `GET appointments/tabCount`; the list from `GET appointments`.

---

## 11. WF-07: Reschedule, cancel, no-show

**The date gateway.** Cancel, no-show, complete and reschedule need an appointment date. If a non-PCP user acts on a date-less appointment, `showConfrimationPopup` → `onAddingDate(data, type)` opens the date modal (`PUT appointment/{id}/dateTime`), then resumes the original action (`cancel` | `noShow` | `complete` | `reschedule`). With no `type` it offers the exam-prep message instead.

**Reschedule**
1. `RescheduleModal` shows the provider's slots (date-time scroller). User may flag **early/urgent request**.
2. Output `{appointmentDate, slot or start/end, durationForReschedule, isUrgentAppointment, heading, rescheduleNoShow}` goes to the `confirmReschedule` dialog, which sends `PUT appointment/{id}/reschedule`.
3. For a specialist rescheduling an originally urgent appointment, the new appointment stays urgent only if the chosen slot is within the entity's scheduling limit (hours converted to days, from the next available date).

**Cancel**
- If the user is not rescheduling, the confirm dialog asks "cancel rather than reschedule?". Choosing reschedule diverts to WF reschedule above. Cancel requires a **reason** (one of a list or free text if "Others"), sent as `PUT appointment/{id}/cancel`.
- Direct cancel without the nudge: Follow-Up with no date; Full Service with no date for non-PCP.

**No-show**
- If the appointment date has already passed, the user is asked "Do you want to Reschedule a No Show?". Yes → reschedule flow with `rescheduleNoShow` (status `RESCHEDULE_NOSHOW`); No → `PUT appointment/{id}/noShow`.
- For other cases `noShow` calls the same endpoint, after the date gateway when needed.

**Special flow:** specialist `652e64d2a34081e2b7c24777` ("MESSGONE"). When its appointment time has passed today and it is still active, the user must answer "Patient is in your office" (→ `complete`) or "Patient did not show" (→ `noShow`) **before** downloading referral or doctor-note documents.

**Hard-coded filter:** `getAppointments()` removes certain records for entity `645606791d616af5e23b77b1` (temporary rule noted in `appointments/DOCUMENTATION.md`).

---

## 12. WF-08: Info request loop

1. Either side opens **Request Info** on an appointment, picks a request type and writes a description. `POST appointment/{id}/requestInfo`. Sub-status becomes `INFO_REQUESTED`; per the release notice shown to users, this also puts the appointment in **Work In Progress** for traceability.
2. The other side sees the appointment in **Request Info**, opens the details, and either:
   - **Quick response** with text and attachments (`PUT appointment/{id}/quickResponseToRequestInfo/{requestInfoId}`), or
   - **Reopens** a closed request through a confirm dialog.
3. Resolved requests move to **Closed Request Info**. History is viewable per appointment (`request-history`).

---

## 13. WF-09: Follow-up referral and doctor notes

**Follow-up (PCP / care manager)**
1. Open **Follow Up** on a completed appointment (`FollowUpModal`).
2. Choose reason `FOLLOW_UP` or `FOLLOW_UP_PROCEDURE`. Upload documents (at least one). Pick whether doctor notes are enclosed or already sent.
3. For `FOLLOW_UP_PROCEDURE`: "doctor notes enclosed" and a date and time are mandatory.
4. `POST appointment/create` with `linkedAppointmentId`, `appointmentType`, `providerNotesStatus` (`ENCLOSED`/`ALREADY_SENT`) and optional `followUpCount`. The new appointment links to the original. The Follow Up tab shows an "original creator" column.

**Doctor notes (specialist → PCP)**
1. Specialist uploads notes (`PUT appointment/{id}/providerNotes/upload`). Status sub-state `PROVIDER_NOTES_UPLOADED` ("Doctor Notes Uploaded").
2. PCP opens the Doctor Notes tab and downloads (`PUT .../providerNotes/download`). Sub-state `PROVIDER_NOTES_DOWNLOADED`. A second open skips the status call if the status is already downloaded.

---

## 14. WF-10: Referral and exam-report documents

| Document | Who uploads | Endpoint | Sub-state |
|---|---|---|---|
| Referral | PCP (or at creation) | `PUT appointment/{id}/referral/upload` | `REFERRAL_UPLOADED` / `FOLLOW_UP_REFERRAL_UPLOADED`. `REFERRAL_REQUESTED` means the specialist asked for one |
| Exam report | Specialist | `PUT appointment/{id}/examReports/upload` | n/a |
| Doctor notes | Specialist | see WF-09 | notes uploaded/downloaded |

- All files are first uploaded to `common/uploadFile` and then attached by reference (originalName and link).
- eFax: if the specialist office has `isEFaxApt`, uploading a referral automatically triggers sending the fax (`sendEfax(..., 'upload')` → `pcp/appointment/sendFaxFromAppointment`). Fax status (in progress, success, failed with reason) is polled on demand (`common/getFaxStatusFromMedSender`).
- Add More Exam: `POST appointment/{id}/cloneAppointment` clones an appointment for the same patient with another exam (offered only when the provider's specialty is named `Imaging`, per `hasImagingSpecialty`).

---

## 15. WF-11: Bulk appointment creation

**Actor:** PCP (sidebar "Bulk Csv Upload"). **Limit:** 20 rows per submission, 3 drafts per group.

**Manual:** each row = patient (search or create inline) → specialist office → provider (exam) → insurance → optional transportation, referral files, comments, STAT flag. Rows can be duplicated with "Add Exam" (same patient, another exam).

**CSV:** upload → server parses (`appointment/uploadCSVForBulk`) and returns `previewAppointments` and `invalidRows`. The UI resolves specialists, providers and insurances in parallel (one call per unique specialist and per unique provider) and flags unmatched cells in red (DOB format, language, specialist, provider, insurance). Submission is blocked while any CSV error remains.

**Submit:** `POST appointment/createBulk`. For CSV submissions a socket event `bulk-appointment-progress` drives a progress popup (success and failed counts). The response lists `data` (created) and `failed`. **See Details** reloads the failed rows into the grid, highlighted, for correction and resubmission.

**Draft:** leaving a dirty form auto-saves a draft (`draft/add`). `view-draft` lists drafts. Validation: patient must exist, full name needs first and last, address needed when transportation is on.

Full field-level detail: [bulk-appointment/DOCUMENTATION.md](src/app/layout/bulk-appointment/DOCUMENTATION.md).

---

## 16. WF-12: Patient transportation (rides)

Rides live in a **separate ride service** (`environment.lyftApiUrl`), not the main API. Only PCP-side flows book them.

**A. Auto ride from an appointment**
1. During PCP appointment creation, "transportation" is ticked, with "provided by PCP", an address, and insurance.
2. `rideProcessed = true` is sent only if all hold: the entity is one of a short hard-coded list of PCP IDs; mobile is valid; insurance type is **MEDICARE**; a Google-validated address exists; and transportation is provided by **PCP**.
3. If any condition fails, a **"Ride not processed"** dialog lists exactly which conditions failed (phone, Medicare, address, provider). The same check is available later from the appointments list (`lyftRideConfirmation`).
4. Some rides land in `review` ("Pending for approval"). Staff approve or reject them from the rides list (`PUT approveRide/{id}` / `rejectRide/{id}`); the buttons show only for `review` rides.

**B. Manual ride** (`rides/book-ride`): rider name, mobile, DOB, pickup and drop-off addresses, optional time. Rule: the ride time cannot be in the past. `POST rides` with `rideCreationType: 'Manual'`.

**C. After booking** (`rides/list`)
- Status chips use `LYFT_STATUSES`: Pending, Scheduled, Accepted, Picked Up, Dropped Off, Canceled, Rejected, Failed, Driver Arrived, Pending approval, Not initiated, Initiated, Error.
- **Patient confirmation** column: pending, `manual_confirmed`, `patient_confirmed`, `patient_rejected`. Staff can confirm manually, record "patient will go on their own" (cancels the ride), or deny the confirmation (`PUT updateRideConfirmation/{id}?confirmationStatus=...`).
- The "patient spoken to" flag is stored for both auto rides (via the main API) and manual rides (via the ride service).
- **Return ride:** for a `droppedOff` ride that is not itself a return and has no return booked, staff can **Book** the return (`PUT scheduleReturnRide/{id}?returnInitiatedBy=COORDINATOR`).
- **Rebook** asks for a new date and time.
- Ride map (`pickup-dropoff`) and ride detail (`rides/detail/:id`, `GET rideDetails/{id}`) give live visibility.

**Quirk:** several ride-service calls treat HTTP **200 in the error handler** as success because the endpoint returns an empty body. Keep that handling when refactoring.

---

## 17. WF-13: eFax lead intake (Workflow Manager)

**Actor:** Specialist or Specialist Group (flag `WORKFLOW_MANAGER`). Route `/e-faxes`.

1. Inbound faxes appear as **leads** (`GET specialist/efaxLeads`). Staff can also **Add New Lead** manually (`specialist/efax/addManualEFaxLead`).
2. Leads are organised by **work type** (tab/category, configurable: add and delete) and each work type has configurable **statuses** (`specialist/efax/getStatus|addStatus|deleteStatus`). Default filter window: last day (also last week, last month).
3. Per lead, staff can: edit patient name, mobile, DOB, doctor; change **status** or **tag**; mark completed (`PUT specialist/efaxLead/{id}`); preview the fax; assign by user.
4. Outreach from a lead: **Send SMS** (`specialist/efaxLead/sendSMS`), **Send eFax** (`specialist/efax/sendFaxFromLead`), **Send booking link** (WF-14).
5. **Create appointment** from the lead (`CreateApptModal` → `POST appointment/EFaxAppointment`): select PCP (from the specialist's PCP list), specialist office, provider and insurance. Appointment is created as `FULL_SERVICE` + `IN_PERSON`, carrying the `leadId` (hard-coded appointment type id `645606de633fc987227b63fd`).
6. Rule: lead tag `MEDICAL_RECORD_REQUEST` cannot be set to status `SCHEDULED`.

---

## 18. WF-14: Patient engagement (SMS-driven)

All links are built from the entity's **`SEOSlug`**. If it is empty the send is blocked with "Office setup is incomplete. Contact your administrator." Links point at the patient portal (`patient.doctorfare.com`, or `patient-dev` outside production).

| Process | Staff action | What the patient gets | Status tracking |
|---|---|---|---|
| **Request Documents** (`/document`) | Enter mobile, edit message (EN/ES translate via `chat/textImprovement`), send (`POST specialist/requestDocument`) | SMS with `/upload-documents/{slug}?token=` | `PENDING` → `SUBMITTED` → `REVIEWED` (`PATCH specialist/documentReviewed`; manual change `PATCH specialist/requestDocument/{id}`). **Send reminder** via `PUT specialist/requestDocument/sendReminderForRequestedDocument` |
| **Appointment Booking Links** (`/book-appointment-list`) | Send link (`POST specialist/sendBookAppointmentLink`); can attach to an eFax lead | SMS with `/patient-chat-support/{slug}?phone=&token=` | list from `specialist/bookAppointmentSMSList`; a QR code for the office is available (`specialist/qr-image`) |
| **Appointment Instructions / Exam Prep** (`/exam-preparations`) | Maintain exam types and instruction content (upload PDF/instructions, replace, add notes); send to patient (`POST specialist/sendExamSms`) with the appointment date and time | SMS with prep instructions | list from `specialist/examPrepSMSList`; exams without instructions listed separately |
| **SMS Outreach Metrics** (`/sms-metrics`) | Read-only | n/a | `specialist/smsMetrics` |

Exam-prep send is also offered right after a date is added to an appointment (WF-06).

---

## 19. WF-15: Patient registry and documents

Currently exposed **only** to specialist roles in one hard-coded entity (live "Pediatric Intelligence", `6a82c8dfa6b938b03e685355`), via sidebar **Patients**. A separate **Patient Upload** (CSV import, `patients-upload`) appears for PCP admins of "UniVida Medical Center" and "Messgone PCP".

1. **Add patient:** first name, last name, DOB, phone. `POST patient`. A new record is stored with `isSpecialistOwned: true`. HTTP 420 returns possible duplicates to choose from.
2. **Upload documents** (second step of Add, or **Upload docs** on an existing patient): folders come from `common/offices/{officeId}/patients/{patientId}/folders`; files go to `common/uploadFile`, then are attached with `PUT patient/profile/{patientId}` body `{ documents: [...] }`.
3. **Edit patient:** requires a **reason for edit** chosen from a list (including Date of Birth Adjustment and Duplicate Record Merging, or custom text). Sent with the update.
4. **View documents:** folder view of `documentsByFolder`, newest first.

---

## 20. WF-16: Availability and calendar management

- Specialists define availability as one-time or recurring (`provider/setOneTimeRecurringAvailability`), in bulk (`provider/setOneTimeRecurringBulkAvailability`), single day, or multiple slots (`calendar/*` sub-views). The calendar view shows availability plus booked appointments (`provider/getAvailabilityAndAppointments`) on FullCalendar day, week, month and list views.
- PCPs consume this when picking a slot (WF-02). `isToshowAvailability` controls whether an office exposes availability.
- **PCP preference ranking** of providers: Capitative (1), Preferred (2), Acceptable (3), Don't Use (4), Unset (5).
- **Insurances** (`/insurances`, specialist admin/manager): assign which insurances each provider accepts (`provider/assignInsurancesToProvider`). This directly constrains the insurance list PCPs see in WF-02.

---

## 21. WF-17: Chat and support

Flag `CHAT`; route `/support`. Real-time over a Socket.IO connection (`websocketUrl`), identified by the user's email on connect.

- **Rooms:** one-to-one PCP↔Specialist contact (`chatRoom/add`), or PCP↔**support group** (`supportGroup`). A support-group room can start as a **request** that a member accepts (`PUT chatRoom/{id}/join`).
- **Features:** messages with seen/received receipts, file sharing, unread counts, group create/update, message **templates** (`chatTemplate`, with per-message variants), AI text improvement/translation (`chat/textImprovement`), appointment details beside a conversation, and analytics (`chat/analytics`, downloadable).
- Disconnect happens on logout.
- Transportation users get "Support" with their reduced menu.

---

## 22. WF-18: Dashboard, performance and high-risk follow-through

- **Dashboard** (`appointments/getDashboardData`): KPI tiles (totals, reschedules, no-shows, cancellations, follow-ups) with date filtering; clicking TOTAL goes to the list. Specialist tiles show colour-coded health vs. the last 7 days:

  | Metric | Green | Yellow | Red |
  |---|---|---|---|
  | Reschedule rate | < 10% | 10–20% | > 20% |
  | Acted-on % | > 90% | 70–90% | < 70% |
  | Cancellation rate | < 10% | 10–20% | > 20% |
  | Avg response time | < 2 days | 2–5 days | > 5 days |

  Known defect: in the dashboard code the **green** average-response-time branch assigns the *red* message text (`dashboard.component.ts`).
- **High-risk patients:** PCP-flagged patients with `isHighRiskPatient`. Each login can show a popup (`GET appointments/highRiskPatients`) listing yesterday's high-risk appointments; staff mark **patient seen yes/no** with comments (`POST appointments/highRiskPatients/seen`). Unanswered rows trigger a "remaining appointments" warning.
- **Analytics** (`/analytics`, `/nps-analytics`, `/specialist-performance`, `sms-metrics`): analytics charts initialise with placeholder datasets and are then filled from `appointments/reports`; verify before quoting numbers.
- **Release notes** (`admin/listReleaseNotes`) and **Feedback** (external link) are in the sidebar.

---

## 23. WF-19: Users, API keys, security

- **Users** (Admin or Manager): list, add, edit (`admin/addEntityUser`, `admin/updateEntityUser/{id}`), block or unblock or delete (`admin/blockDeleteFunctionality/{id}`), send a **temporary password** (`users/sendTempPassword/{id}`). The temp-password path forces the user through the reset flow at next login (WF-01).
- **API Keys** (Admin or Manager): list keys per office, **revoke**, **download** (`offices/{entityId}/api-keys/...`). Used by third parties and systems to integrate.
- **Profile / Settings:** update profile (`users/updateProfile`), change password (`users/changePassword`), sessions visibility, and an email **unsubscribe** public page (`unsubscribe-email`, `PUT users/setEmailUnsubscribe`).
- **NPI / secure-code verification** (`public/verify-npi`) is built but currently not wired in (see WF-05).

---

## 24. Cross-cutting rules (apply to every workflow)

1. **Single source of truth is the backend.** The UI refetches the list (`getAppointments()`) after almost every action instead of patching local state (exception: `handled` toggle uses a local update).
2. **Modal chaining is the control flow.** Many actions open a modal, then a second modal on close (date → confirm → action). When changing one step, check its `onClose` handlers.
3. **Local storage carries workflow state:** selected office, provider, slot (`selectedOfficeFromCalender`, `selectedDocFromCalendar`, `selectedSlotsDetails`), list filters/columns/tabs per entity, `uuid`, popup-seen flags. `afterLogout()` wipes all but `uuid` and two popup flags.
4. **Time:** requests send `utcoffset` and `timestamp`; US/Eastern DST handling is custom in `CommonService.getOffset()`; "is time passed" checks use EST.
5. **Phone and address:** US-centric masks and `+1` default; address validation uses Google Places when `USE_GOOGLE_API` or entity-specific override is on, otherwise a default Miami address is substituted (`constant.DEFAULT_ADDRESS`).
6. **White-labelling:** brand is chosen by domain; every API call sends `businessName`.
7. **Language:** patient language is a first-class field (`en`/`es`), used for SMS content and translate buttons.

---

## 25. Hard-coded business rules and risks

| Where | Rule | Risk |
|---|---|---|
| `appointments.component.ts` `updateAppointmentStatus` | Specialist `652e64d2a34081e2b7c24777` gets the in-office/did-not-show prompt | Per-tenant logic in shared code |
| `appointments.component.ts` `getAppointments` | Entity `645606791d616af5e23b77b1` filters out specific records | Temporary rule |
| `create-appointment.component.ts` | Ride auto-processing is gated by a list of PCP entity IDs, and the list differs between payload build and post-create check | Inconsistent; some entities get auto-ride but no failure dialog, or the reverse |
| `create-appointment.component.ts` | Google address enabled for specific PCP IDs by environment | Config in code |
| `specialist-create-appt-modal.component.ts` (type 4, Request Document) | For a specialist **group**, `a \|\| env.production ? X : Y` parses as `(a \|\| env.production) ? X : Y`, so the chosen office is replaced by a fixed ID (production ID in production, dev ID otherwise) whenever either is truthy | Likely bug: the office picked in the form is ignored |
| `efax-leads/create-appt-modal` | Appointment type ID for Full Service is hard-coded | Breaks if IDs differ per environment |
| `side-bar.component.ts` | **Patients** menu visible only for one live specialist ID; **Patient Upload** only for two PCP names | Feature gating by id or name |
| `dashboard.component.ts` | Green avg-response message uses red text | Display defect |
| `constant.ts` | `constant.version` must match the server for production reloads | Release step |
| `constant.ts` | A Google API key is committed in the source | Rotate, restrict, and move to environment config |
| Mobile verification | Twilio check is commented out in create, bulk and ride forms | `isMobileValid` always true client-side |

---

## 26. Integrations and boundaries

| System | How the portal talks to it | Notes |
|---|---|---|
| Main API | `environment.apiBaseUrl` (`/api/v1/`) | Bearer JWT, all workflows |
| Ride service | `environment.lyftApiUrl` | Separate host; rides only |
| Socket server | `environment.websocketUrl` | Chat and bulk-progress events |
| Patient portal | URLs built from `SEOSlug` | Patient uploads, booking, chat support. **Not in this repo** |
| Google Maps/Places/Timezone | Browser | Address validation, distance, time zone |
| Fax provider (MedSender) | Through backend; status via `common/getFaxStatusFromMedSender` | Fax send and status |
| SMS | Through backend (`sendSMS`, `sendExamSms`, links) | Body text is built in the UI |
| PWA | `ngsw-config.json`, `manifest.webmanifest` | Installable app |

---

## 27. Known gaps in this document

- The backend state machine (which transitions are legal, what creates `EXPIRED` or `MOBILE_UNVERIFIED`, SMS/fax delivery timing) is **not visible** from the front end. Items marked *(inferred)* need a backend owner's confirmation.
- `ORDER` appointment type: the constant exists; no dedicated UI flow was found.
- Dashboard `bookAppointment(2)`: the other branch navigates to `/specialist-listing/list`; its exact meaning was not traced.
- Insurance verification popup for specialists (`verifyInsurance`) and the patient-facing flows beyond the three public pages were not traced end-to-end.
- Analytics numbers are not validated against the API.
- The patient document upload endpoint was a placeholder earlier in this project's history; confirm the backend route `PUT patient/profile/{id}` is live before treating WF-15 steps 2–3 as production behaviour.

---

*Maintain this file when a workflow rule changes. Prefer updating the rule here and the code reference together, so the knowledge layer stays trustworthy.*
