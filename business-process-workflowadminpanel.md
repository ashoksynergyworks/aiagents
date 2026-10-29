# Business-Process Knowledge Layer — DoctorFare Admin Portal

Workflow reference for the **Admin - DoctorFare** web app (Angular 14, `src/app`). It describes the business processes the admin portal supports, the entities they act on, and where each lives in code, so a person or an agent can reason about "what happens when…" without reading every component.

> **Scope note.** This app is only the *admin console*. Appointment booking, scheduling and the PCP/specialist/patient experiences live in other DoctorFare apps and in the backend (`environment.apiBaseUrl`, `https://api.doctorfare.com/api/v1/` by default). Everything here is derived from the frontend; backend behavior marked *(inferred)* is not verified from this repo.

---

## 1. Domain Model

DoctorFare connects **referring parties** (PCPs) with **specialist providers** to book referral appointments. The admin portal configures that network.

| Entity | `CONSTANT.enumTypes` | Meaning | Admin screen |
|---|---|---|---|
| PCP | `Pcp` | Primary-care practice that refers patients | `/primary-care` |
| PCP Group | `PcpGroup` | Collection of PCPs | `/pcp-group` |
| Specialist Office (SPO) | `Specialist` | Specialist practice (a location with rules, hours, surcharges) | `/spl-offices` |
| Specialist Group (SPG) | `SpecialistGroup` | Collection of specialist offices | `/spl-groups` |
| Provider | `Provider` | Individual doctor working at one or more offices | `/providers` |
| Medical Center | `MedicalCenter` | Facility under a PCP (used for high-risk patients) | `/medical-centers/:name/:id` |
| User | `Users` | Staff login attached to one entity with a role | `/users` |
| Admin | `Admin` | Portal operator (`superAdmin` or `admin`) | `/admins` |
| Appointment Type | `DefaultAppointmentType` | Template defining what can be booked | `/cms/apt-types` |

### Relationships

```
PcpGroup 1─* Pcp ─*─* Specialist Office (SPO) ─*─* Provider
                 │            │
                 │            └─*─1.. Specialist Group (SPG)
                 └─*─* Specialist Group (SPG)

Pcp ──1─* MedicalCenter ──1─* Facility (address, facilityNumber)
Entity (Pcp | PcpGroup | Specialist | SpecialistGroup | tele) ──1─* User (role)
Specialist / SpecialistGroup ──1─* API key (developer tools)
```

Connections are made from the "assign" screens (see Process 3), and the same relationship can be reached from either side. For example, a PCP's "Specialist Offices" action and an SPO's "PCPs" action are two views of one link.

---

## 2. Actors & Access

| Actor | How they log in | What they can do |
|---|---|---|
| **Super Admin / Admin** (`adminRoles`) | `/login`, role `admin` is always sent | Everything in this portal |
| Entity users (PCP, PCP Group, Tele, Specialist, SPG roles) | *Not* this app. They are **created and managed** here (Process 2) | Work in the other DoctorFare apps |

Entity roles (`CONSTANT.entityRoles`) each come as SuperAdmin / Admin / Manager / Member per entity type: `pcp*`, `pcpGroup*`, `specialist*`, `specialistGroup*`, plus a tele set (`teleHeathPsr`, `teleHealthCareManager`, `teleHealthCallCenter`, `teleHealthSpecialistProvider`, `teleHealthMedicalAssistant`, `teleAdmin`, `teleManager`).

The portal has **no per-feature permission checks**. Access is all-or-nothing through the guards in Process 1. *(Whether `admin` and `superAdmin` differ on the backend is unknown.)*

---

## 3. Workflows

### Process 1 — Authentication & Session

**Trigger:** admin opens the portal. **Code:** `public/login`, `public/step-verify`, `services/guards`, `services/interceptors`, `CommonService`.

```
/login ── POST users/login {email, password, role:'admin', uuid}
   ├─ isPasswordToBeChanged ─▶ Password-Expired modal (token kept in localStorage 'changePasswordLogin')
   ├─ twoFactorAuthRequired + verifyToken ─▶ /step-verify/:_id/:code
   │        ├─ PUT users/verify {verifyToken, otp, uuid} ─▶ session
   │        └─ PUT users/resendTwoFactorCode {verifyToken}   (resend OTP)
   └─ otherwise ─▶ setTokenData ─▶ /bi
Forgot password: modal ─▶ users/forgotPassword ─▶ emailed link ─▶ /reset-password ─▶ users/resetPassword
```

- **Session** = `df_admin_token` in `localStorage` (plus `role`, `fullName`, `profilePic`). `uuid` is a per-browser device id (a timestamp) that survives logout.
- **Guards:** `AuthGuard` blocks `/login` when a token exists and sends the admin to `/bi`. `LayoutGuard` blocks every page under the layout without a token, clears storage and redirects to `/login`.
- **Interceptors:** `JwtInterceptor` adds `Authorization: Bearer <token>`. `ErrorInterceptor` shows a toast for every failed request, and on **401/403 it forces logout** (`afterLogout`). `LoaderInterceptor` shows the global spinner unless a call is flagged as background.
- **Rules:** MFA is decided by the backend response, not the client. Default landing page is `CONSTANT.initialRoute = 'bi'`.

### Process 2 — User & Admin Lifecycle

**Code:** `layout/users`, `layout/admins`. **APIs:** `admin/addEntityUser`, `admin/updateEntityUser`, `admin/addAdmin`, `admin/updateAdmin`, `users/getAllUsersList`, `admin/blockDeleteFunctionality/:id`.

1. **Create user** — pick *entity type* (Specialist Office / Specialist Group, or fixed when arriving from an entity's "Users" action), pick the entity, pick a **role** (filtered to that entity type), enter name, email, optional phone.
   - Arriving from a PCP or PCP Group restricts roles to any `Pcp*` role, which covers both `Pcp` and `PcpGroup` types.
2. **Edit user** — same form, prefilled. Role change is tracked via `previousRole`.
3. **Change user type** — `PUT users/:id/changeUserType` from the user list.
4. **Manage offices for a user** — `users/manage-specialist-offices/:id` and `users/add-spl-office-to-user/:id` attach a user to specific specialist offices. SPG users get their offices through `assignSpgSpecialists`.
5. **Block / unblock / delete** — one endpoint (`blockDeleteFunctionality/:id`) with a flag in the body. Blocked entities show a success toast and flip `isBlocked` locally.
6. **User settings** — `admin/updateUserSettings`.
7. **Admins** — same pattern at `/admins`, with role `Super Admin` or `Admin`.

### Process 3 — Network Setup (who can refer to whom)

**Code:** `layout/pcp`, `pcp-groups`, `spl-offices`, `spl-groups`, `providers`, `shared/modals`.

```
Create PCP Group ─▶ add PCPs to group           (pcpGroup/assignPcpsToPcpGroup)
Create PCP ───────▶ assign Specialist Offices   (pcp/assignSpecialistsToPcp)
                 └▶ assign Specialist Groups    (pcp/assignSpecialistGroupToPcp)
Create SPG ───────▶ add Specialist Offices      (specialistGroup/assignSpecialistsToSpecialistGroup)
Create SPO ───────▶ add Providers               (specialist/assignProvidersToSpecialist, assignDoctorsToSpecialist)
Provider ─────────▶ assign Insurances           (provider/assignInsurancesToProvider)
```

- **Create SPO** (`AddSplOfficeComponent`): name (auto-generates a slug after 400 ms debounce), address through Google Places (auto-fills lat/long, city/state, time zone), phone, e-fax, and the default appointment types. When `CONSTANT.USE_GOOGLE_MAP_API` is off, a manual-address fallback applies (time zone defaults to `America/New_York`, country `US`).
- **Cross-navigation:** list pages are reachable filtered by a parent via query params (`pcpId`, `specialistId`, `specialistGroupId`, `providerId`, `pcpGroupId`). Example: PCP list → "Specialist Offices" opens `/spl-offices?pcpId=…`.
- **Featured:** SPOs and SPGs can be flagged featured, `PUT /specialist/:id/makeFeatured {isFeatured}`.
- **Medical centers:** added per PCP (`pcp/medicalCenter`), each with facilities (address + facility number). Delete goes through `blockDeleteFunctionality`.

### Process 4 — Referral Rules for an Office or Group (core business configuration)

**Entry:** SPO list or SPG list → "Rules". **Route:** `/rules/*` with query params `splOfficeId`, `splOfficeName`, `tabSelected` (`'group'` for SPGs). Navigating without an id bounces to `/spl-offices`.

| Tab | Route | Purpose | Key API |
|---|---|---|---|
| 1 | `rules-pages` | Which **appointment types** the office accepts, plus slot durations | `rules/getRulesData`, `rules/saveSplOfficeRules`, `rules/saveSplOfficeRulesForSpecialistGroup` |
| 2 | `insurance-plan` / `doctors-rules` | Accepted insurance plans (office) or per-provider insurance | `provider/getProvidersInsurances` |
| 3 | `duration` | In-person and tele slot length | `inPersonSlotDuration`, `teleSlotDuration` |
| 4 | `eFax-appt` | Appointments created via e-fax | `eFax`, `appointmentCreationType` |
| 5 | `scheduling` | **Scheduling horizon** — how far ahead patients can book | `admin/addEditProviderAvailabilities`, `admin/listProviderAvailabilities` |
| 6 | `body-parts` | Body parts the specialist handles | `rules/*` |
| 7 | `equipments` | Equipment the office has | `rules/*` |
| 8 | `surcharges` | Per-office surcharge pricing | `admin/specialists/:id/surcharges` |

**Appointment-type selection rules** (`RulesPageComponent`, validated client-side on save):
- Types are grouped by `appointmentOrigin`: `PCP_INITIATED` (shown as the *Referral* list), `SPECIALIST_INITIATED`, `DEVELOPER_PCP`, `DEVELOPER_SPECIALIST`.
- At least **one referral (PCP-initiated) type** is required.
- Unless the selected referral type is `ORDER`, and for offices (not groups), at least **one specialist-initiated type** is also required. For an `ORDER` referral, specialist-initiated types are not sent.
- Referral types are effectively single-select. The one allowed pairing is **Calendar + Bulk** (hard-coded Mongo ids `645606de633fc987227b63f7` and `64b8c3880624e5212bc97adc`). Any other second selection resets the selection.
- Groups additionally save slot durations and `allowProviderSlotsVisibleToPatient`.
- Save sends a `flag` parameter *(its meaning is defined by the backend)*.

**Scheduling-limit rules:**
- Stored in **hours**, edited in **days** (×24 / ÷24). Maximum **120 days**; default shown is 48 hours.
- Mode `ALL` sets one limit for the whole office. Mode `SEPARATE` sets a limit for one provider.

**Surcharges:** the admin picks from the CMS catalogue of surcharges (`defaultPrice`); each office can enable one and override its price. Providers have their own surcharge endpoints (`admin/specialist/:id/providers/surcharges`).

### Process 5 — Referral Preferences & Feature Flags (per PCP × office/group)

**Code:** `spo-settings`, `spg-settings`, `pcp-settings`.

- **Booking preference:** for each PCP linked to an SPO or SPG, set **Bulk** or **Calendar**, or switch on a `toggleEnabled` override. Enabling the toggle clears and disables the preference selector.
  - SPO: `PUT pcp/appointment/preference/:pcpId {specialistId, toggleEnabled, appPreference}`
  - SPG: `PUT pcp/appointment/spgPreference/:pcpId {specialistGroupId, toggleEnabled, appPreference?}`
- **Sidebar features (`allowedFeatures`):** per SPO/SPG, toggle which modules its users see: `CHAT`, `EXAM_PREPARATIONS`, `BOOK_APPOINTMENT`, `REQUEST_DOCUMENT`, `SMS_METRICS`, `WORKFLOW_MANAGER`. The SPG screen labels `EXAM_PREPARATIONS` "Appointment Instructions". Read through `users/getAllowedFeatures?id&entity`, saved on `updateSpecialist` / `updateSpecialistGroup`.
- **PCP settings:** `isHighRiskEnabled` and `isMedicalCenterEnabled`. **Business rule: High-Risk Patient = Yes forces Medical Center = Yes.** Saving with high-risk on and medical center off is rejected.

### Process 6 — Clinical Catalogue (CMS)

**Code:** `layout/cms/*`. Master data consumed by every other process, all through `admin/add*` / `admin/update*` plus `admin/getCmsDataList?entity=…`.

| Catalogue | Notes |
|---|---|
| Specialties, Diseases, Degrees, Languages | Plain reference data |
| Insurances → Insurance Plans | Two levels (insurance, then plan) |
| Body Parts, Equipments | Linked to offices in Process 4 |
| **Exam Types** | Can have **exam-preparation instructions** attached per Specialist Office/Group (`attach-exam-instructions`), reachable from SPO/SPG lists |
| **Appointment Types** | Template for bookable types — see below |
| Consultation Types | Consultation kinds |
| Surcharges | Title, description, `defaultPrice`. Priced per office in Process 4 |
| Contact Us | Contact information |

**Appointment Type definition:** name, icon (two images), `duration`, `type` (enum `aptTypes`: `PCP_INITIATED`, `SPECIALIST_INITIATED`, `FOLLOW_UP`, `FOLLOW_UP_PROCEDURE`, `FULL_SERVICE`, `REQUEST_DOCUMENT`, `ORDER`, `MRI_349`, `TIER_3`, `ONLINE`), `appointmentOrigin`, and `isTopUpAppointment`. Types flagged top-up are listed as specialist-initiated when creating an office.

CMS rows can be blocked or soft-deleted rather than hard-deleted. The exam-type picker passes `isBlocked: true` to include blocked entries.

### Process 7 — Provider Checklists & Instructions

**Code:** `providers/assign-instructions`. For each provider the admin manages:
- an **appointment-instruction file** (upload via `common/uploadFile`, stored on the provider) and
- **checklist items** (`ProviderChecklist`), saved by writing the whole `checklistItem` array back with `provider/updateProvider/:id`. Deleting an item removes it from the array and PUTs the remainder.

### Process 8 — Notifications

**Code:** `layout/notifications`. Event-driven templates sent to recipients by Email or SMS.

1. Choose or create an **event type** (`notifications/eventTypes`). Each type exposes **tags** (merge fields) via `notifications/eventTypesTags`.
2. Add one or more **recipients**: Patient, PCP, Tele, PCP Group, Specialist, Super Admin, or any entity role.
3. For each recipient write a **template** in **English and Spanish** (`en` / `es`). Email has subject and body in a rich-text editor (CKEditor), SMS has body only.
4. Save to `notifications/event` (create or edit, `notifications/events/:id` to load).

### Process 9 — Monitoring & Analytics

- **Business Intelligence** (`/bi`, default landing). Pulls `admin/stats` for modules 0–3 in the background, with date filters and entity filters (PCPs, offices, providers, types):
  - *Entities:* PCP, PCP Group, SPG, SPO, Specialist Group Offices, Providers.
  - *Users:* total, blocked, unblocked, currently logged in (total / SPG / SPO / PCP).
  - *Bookings:* total, scheduled today, referral, full service, follow-up, orders, plus status buckets (submitted, reviewed, cancel, no-show, reschedule, completed …).
  - Charts via Chart.js and ApexCharts.
- **Specialist Performance** (`/specialist-performance`, `admin/getSpecialistPerformance`, `getSpgPerformance`). Per-office/group KPIs: % acted-on, avg response time, % canceled, no-show, rescheduled, completed, reviewed, work-in-progress, open vs closed information requests, and appointment-type breakdowns.
- **Dashboard** (`admin/getDashboard`) exists as a module but is commented out of the sidebar.

### Process 10 — Developer API Access

**Code:** `layout/developer-tools`. Lets external systems integrate with an office, PCP or group.

```
List keys by owner (filter: Pcp | Specialist | SpecialistGroup)
  └─ View entity ─▶ keys for that owner (offices/:id/keys)
        ├─ Generate  (name + expiry: never | 30d | 90d | 1y | custom) ─▶ shows clientId + clientSecret ONCE
        ├─ Renew     (update expiry)      PUT offices/:id/api-keys/:clientId/renew
        ├─ Deactivate/revoke              PUT offices/:id/api-keys/:clientId/revoke
        └─ Download credentials as CSV    GET offices/:id/api-keys/:clientId/download
Upload / download API documentation       admin/developerApiDocumentation[/download]
```
Deactivation requires a confirm dialog. Every key call carries `ownerType`.

### Process 11 — Content & Support

- **Release Notes** (`admin/addEditReleaseNotes`, `admin/listReleaseNotes`) — add/edit/view announcements.
- **FAQ** — maintained with an add-FAQ form.
- **Profile** (`admin/getProfile`, `admin/profile`) and **Change Password** (`user/changePassword`); `setEmailUnsubscribe` / `setEmailResubscribe` for email preference.
- **QR code** — `admin/qr-image` generates a QR image for an entity (`shared/modals/qr-code-modal`).

---

## 4. Appointment Lifecycle (reference data only)

The admin app doesn't move appointments through states. It only **displays and counts** them, using `APT_STATUSES` and `CONSTANT.BookingStatus`.

```
Submitted(0) ─▶ Reviewed(1) ─▶ Scheduled ─▶ Completed(5)
     │                              │
     │                              ├─▶ Rescheduled(3)   (by SP, hospital, customer, PCP, admin, tele, SPG, medical center, specialist doctor)
     │                              ├─▶ Canceled(2)      (by customer, admin, SPG, PCP, medical center, hospital, service provider)
     │                              └─▶ No Show(4)
     └─▶ Expired(6)
```
Colors: green = reviewed/scheduled, yellow-green = rescheduled, red = canceled, grey = completed / no-show / expired, blue = submitted. The "who acted" suffix is useful for audit questions such as "who rescheduled this".

---

## 5. Cross-Cutting Rules

| Topic | Rule |
|---|---|
| API base | `environment.apiBaseUrl`. `environment.ts` is `https://api.doctorfare.com/api/v1/`, with `.dev`, `.test`, `.prod` variants |
| Errors | Global toast. 401/403 logs out |
| Pagination | `PaginationControls` (`skip`, `limit`, `pageNo`, `count`). Lists default to 10 per page |
| Search persistence | List search text is kept in `localStorage` (`pcpSearch`, `userSearch`, `providerSearch`, `adminSearch`, …), cleared by `CommonService.resetSearchKey()` |
| Soft block / delete | `admin/blockDeleteFunctionality/:id` for users, admins, medical centers, and CMS rows |
| Time | Requests compute a UTC offset with US DST handling (`getOffset`). Office time zone comes from Google Places |
| Phones | US mask `(XXX) XXX-XXXX` plus `ngx-intl-tel-input` for country codes |
| Uploads | `common/uploadFile` with a `type` from `fileUploadTypes` (`pcp-documents`, `specialist-documents`, `users`, `entity-logos`, …) |
| Lazy modules | Every feature is a lazy-loaded NgModule under `layout.routing.ts` |
| Build / deploy | `npm start` (port 1234), `npm run build[-dev|-test]`. `dist/` is committed. Branches: `dev`, `master`, `production-branch` |

---

## 6. Gaps, Risks & Open Questions

Found while mapping the code; worth confirming before relying on this document for business decisions.

1. **Hard-coded appointment-type ids** in `rules-page.component.ts` (Calendar `645606de…`, Bulk `64b8c388…`) tie referral logic to specific database rows. A different environment's data would break the Calendar + Bulk rule.
2. **Google Maps API key** is committed in `core/constant.ts`. It should be restricted or moved to environment config.
3. **No role-based UI**: any logged-in admin sees every module, including API key generation. Confirm that matches policy.
4. **`flag` on rule save** has no client-side meaning. Document it from the backend.
5. **E-fax, Dashboard, and Appointment Instructions (CMS)** are partially wired or hidden, so confirm whether they are live.
6. **`dist/` and `debug.log` are tracked** in git, which makes builds noisy.
7. Several `console.log` calls remain in business-critical components.
8. **Node 14** is pinned (`npm run node-version`) with Angular 14, which is an old toolchain.

---

## 7. Where to Look (quick index)

| Question | Start here |
|---|---|
| What can an office accept? | `layout/rules/rules-page` + `rules/getRulesData` |
| Why can't this PCP see this office? | Process 3 assignments, `pcp/add-spl-to-pcp` |
| Bulk or Calendar for a PCP? | `spo-settings` / `spg-settings` |
| Which features does an office have? | `allowedFeatures` via `users/getAllowedFeatures` |
| How far ahead can patients book? | `rules/scheduling-limit` |
| Who can sign in, and as what? | `core/constant.ts` → `entityRoles`, `layout/users` |
| What does a status color mean? | `core/constant.ts` → `APT_STATUSES` |
| All API paths | `core/apiUrl.ts` |
| Routes & sidebar | `layout/layout.routing.ts`, `core/constant.ts` → `SIDEBAR` |
