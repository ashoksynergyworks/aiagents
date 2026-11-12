# Workspaces plan

Goal: let invited users upload their own Excel data into a private workspace and ask an AI questions about it. The df-dev chat stays for super admins only.

**Status (2026-11-12):** Phase 0 is done. Phase 1 is partly done: super admins can add users from `/users`. A new user is always an `admin`. `addUser()` refuses `super_admin`, so super admins exist only in code. Other roles come later. Still to do in Phase 1: the first-sign-in password change and disabling a user.
Phase 2 is done: create workspaces (max 2), upload, AI format plan with rule fallback, preview with the column ledger, store. Not built from Phase 2: renaming a column or changing its type in the preview.

---

## 1. What the user asked for

1. Only super admins see the df-dev chat.
2. Admins can add other users.
3. A user can create a workspace and upload Excel files to it.
4. The server standardises the data. The user sees a preview and confirms it before it is stored.
5. If the file is already clean, the preview shows "no changes" and asks for the same confirmation.
6. The data goes into a database with the same name as the workspace.
7. After the store, the app asks the user for context about the data and for the user's goals. The app stores the answers.
8. The user can then chat with the AI about that workspace's data.
9. Later, the user can add more data with another Excel file.
10. Caching comes later.

## 2. Where we are today

| Need | Today | Where |
|---|---|---|
| Users | Two super admins, hard-coded with scrypt hashes | [auth.ts:8](../app/auth.ts#L8) |
| Roles | `super_admin`, `admin`, `member` exist as types only | [auth.ts:3](../app/auth.ts#L3) |
| Users page | Read-only list, super admins only | [users/page.tsx](../app/users/page.tsx) |
| Sign-in gate | Every page needs a session. There is no role check | [proxy.ts](../proxy.ts) |
| Chat agent | Model loop, fallback models, NDJSON stream, CSV export | [route.ts](../app/api/chat/route.ts), [model.ts](../app/api/chat/model.ts) |
| Query guard | Read-only check, no cross-database lookups, per-collection scopes | [guard.ts](../app/api/chat/guard.ts) |
| Database | `df-dev` is pinned in code | [route.ts:15](../app/api/chat/route.ts#L15) |
| Excel parser | None installed | |

Most of the chat can be used again. The main new work is users in the database, the upload and standardise step, and a chat that points at a workspace database.

## 3. Design decisions

### 3.1 Where data lives

| Data | Location |
|---|---|
| App data (users, workspaces, uploads) | One app database, `APP_DB` env var, default `prompt-kpi` |
| Workspace rows | One database per workspace, named `ws_<slug>` (for example `ws_sales_2026`) |
| One Excel sheet | One collection in the workspace database (for example `orders`) |

- The `ws_` prefix stops a workspace name from colliding with `df-dev`, `admin`, `local` or `config`.
- A slug keeps the name valid for MongoDB: lowercase, `a-z0-9_`, max 40 characters, unique.
- The guard already blocks `"db":` in pipelines. A workspace chat therefore cannot read another workspace or `df-dev`.
- **Limit (decided 2026-11-12):** each user can own at most 2 workspaces. The create action counts the user's workspaces and refuses a third with "You can have 2 workspaces. Delete one to create another." Super admins have the same limit. The limit is one constant, `MAX_WORKSPACES = 2`.
- Atlas M0/M2/M5 tiers allow 100 databases and 500 collections. With 2 workspaces per user, this supports about 50 users. After that, change to one shared database with a collection per workspace. Only `dbName` on the workspace record changes.

### 3.2 Users move into the database

- The two super admins stay in code as a bootstrap list. Nobody can lock them out, and no seed script is needed.
- All other users live in an `users` collection in the app database.
- `checkPassword` and `currentUser` look in code first, then in the database.
- `proxy.ts` checks only the token signature and expiry. It does not call the database on each request.
- `currentUser()` reads the database. A disabled or removed user loses access at the next page or API call.
- An admin adds a user with a temporary password. The app shows it once. The user must set a new password at first sign-in.
- There is no email service, so the admin gives the password to the user directly.

### 3.3 Roles

| Role | df-dev chat | Add users | Workspaces |
|---|---|---|---|
| `super_admin` | Yes | Add any role | Own workspaces, and can open all workspaces |
| `admin` | No | Add `member` only | Own workspaces |
| `member` | No | No | Own workspaces |

Workspace sharing between users is not in scope. Add a `members` array to the workspace record when it is needed.

### 3.4 Excel parsing

- Use SheetJS, installed from its own CDN tarball: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- Do not use the `xlsx` package on npm. That version is old and has known security issues.
- SheetJS reads `.xlsx`, `.xls` and `.csv` with one call.
- Parse on the server. The server must check the data anyway, so a second parser in the browser adds nothing.
- Limits: 10 MB per file, 50,000 rows per sheet, 200 columns. Reject larger files with a clear message.

### 3.5 Standardise: the AI plans, the code applies (updated 2026-11-12)

The AI does not rewrite the rows. It looks at sample rows and returns a short **format plan**. Code then applies the plan to every row. This design gives us:

1. **Judgement from the AI:** where the header is, which rows are totals or notes, which columns are dates, codes or money, and clear column names.
2. **Exact conversion from code:** the same plan always gives the same rows, and a 50,000-row file costs one small AI call.
3. **Safety:** the AI sees at most 40 rows, never the full file.

Steps:

1. Code reads the sheet (SheetJS) and drops fully empty rows and columns.
2. Code sends the format model the first 30 rows and the last 10 rows, each with its row index.
3. The model returns the plan, constrained by a JSON schema (`response_format: json_schema`):
   ```json
   { "headerRow": 2, "dropRows": [6, 10],
     "columns": [{ "index": 3, "label": "Visit date", "type": "date", "dateOrder": "MDY", "unit": "", "description": "Date of the patient visit." }] }
   ```
4. Code validates the plan: the indexes are in range, the types are known, and each header column appears once.
5. Code checks each column type against **all** rows. If fewer than 95% of the non-empty values convert, the column stays text, and the change list says so.
6. Code applies the plan with the rules in the table below. The code also drops any row whose first cell starts with `Total`, `Subtotal` or `Grand total`, so totals after row 30 are also removed.
7. If the format model fails, times out (20 s), or returns an invalid plan, code builds the plan with the rules only. An upload never waits on the AI.

The column descriptions from the plan go into the workspace schema. The Context step shows them, so the user can correct a wrong guess. The model is chosen in section 3.12.

Rules applied by code, in order:

| # | Rule | Example |
|---|---|---|
| 1 | Find the header row: the first row with the most filled cells | Title rows and blank rows above the table are dropped |
| 2 | Drop rows and columns that are fully empty | |
| 3 | Clean header names: trim, collapse spaces, make unique | `"Amt ($) "` → `Amt ($)`; a second `Date` → `Date 2` |
| 4 | Make a safe field key per column | `Amt ($)` → `amt`; keys never start with `$` and never contain `.` |
| 5 | Fill blank headers | `Column 7` |
| 6 | Convert empty markers to null | `""`, `-`, `N/A`, `n/a`, `null`, `#N/A` |
| 7 | Detect the type of each column from its values (number, date, boolean, text) | 95% or more of non-empty cells must match, otherwise keep text |
| 8 | Convert numbers | `"1,200.50"` → 1200.5; `"$40"` → 40; `"12%"` → 0.12 |
| 9 | Convert dates | Excel serial `45231` → 2023-11-01; `"01/11/2023"` → asks for day/month order once if it is ambiguous |
| 10 | Convert booleans | `Yes/No`, `Y/N`, `TRUE/FALSE` |
| 11 | Remove exact duplicate rows | Counted and shown, not hidden |

The function returns `{ columns, rows, changes }`. Each change has a plain message, for example "Changed 1,204 values in Amount from text to numbers".

- If `changes` is empty, the preview says "This file is already clean" and only asks for confirmation.
- The user can change a column type or name in the preview before storing. This is the only manual edit.
- Rules 1, 3, 7 and 9 use the plan when there is one. The other rules always run in code.
- `scripts/check-standardise.mjs` tests the code with a fixed plan, and also with no plan (the rule-only path). It never calls the AI.

### 3.6 Nothing is stored before the user confirms (changed 2026-11-12: no staging)

1. The first upload call returns the preview and the format plan for each sheet. Nothing is written.
2. "Store" sends the file again with the plans. The same code with the same plan gives the same rows, so the stored data matches the preview. The AI is not called again.
3. The rows go to a temporary collection. Then the temporary collection is renamed over the final collection (`dropTarget`). A sheet with the same name replaces its table in one step.
4. "Discard" only clears the browser state.

This design needs no staging collections, no cleanup job and no `uploads` record. The cost is a second file upload of up to 10 MB.

Undo by upload (an `_upload` field on each row) moves to Phase 5, together with "Add data".

### 3.7 Context questions

After the first store, the app asks two fixed questions:

1. "What is this data? Tell us where it comes from, what period it covers, and what the columns mean."
2. "What do you want to learn or do with this data?"

The app also asks one question for each column with an unclear name, for example "What does `qty_b` mean?". The columns come from the standardise result, so this needs no AI call.

The answers are stored on the workspace record as `context`, `goals` and `columnNotes`. The user can edit them later from the workspace page.

- Later: AI-written follow-up questions from the schema and samples. Add this if the fixed questions do not give the chat enough context.

### 3.8 Workspace chat uses the same agent

The chat loop in `route.ts` stays. It gets a context object instead of the fixed `df-dev` values:

```ts
type Ctx = { db: Db; scopes: Record<string, Document[]>; system: string; tools: object[] };
```

| Part | df-dev chat | Workspace chat |
|---|---|---|
| Database | `df-dev` | `workspace.dbName` |
| Allowed collections | The keys of `SCOPES` in guard.ts | The workspace's sheets. Staging collections are excluded |
| Scope stages | Patient-data projections | `{ $project: { _upload: 0 } }` |
| Tools | `aggregate`, `export_csv`, `kpis` | `aggregate`, `export_csv` |
| System prompt | Medical referral prompt and `df-dev-schema.md` | A generic analyst prompt, the workspace context and goals, and a schema built from the stored columns |

The built schema lists, for each sheet: the row count, and each column with its key, label, type, null count, 3 sample values, min/max for numbers and dates, and the user's note.

Guard change: `parsePipeline(collection, pipeline, scopes = SCOPES)`. The read-only checks and the `"db":` block do not change.

The same `/api/chat` endpoint takes an optional `workspaceId`:

- With no `workspaceId`, the request is a df-dev chat and needs `super_admin`.
- With a `workspaceId`, the request needs the owner or a `super_admin`.

### 3.9 Add more data

"Add data" opens the same upload flow on an existing workspace. The review step compares the new sheet with the stored collection:

| Result | What the user sees |
|---|---|
| Same columns | "Add 812 rows to Orders" (default) or "Replace Orders" |
| New columns | The new columns are listed. Old rows get null for them |
| Missing columns | The missing columns are listed. New rows get null for them |
| Type conflict | The column is shown in red. The user picks the type before storing |
| New sheet | It becomes a new collection |

The data panel lists every upload with an "Undo" button. Undo deletes the rows with that `_upload` id.

Duplicate detection across uploads is not in scope. Add it when users ask for it, with a key column the user picks.

### 3.10 Privacy

Workspace data goes only to NVIDIA (section 3.11). The format model sees up to 40 sample rows. The chat model sees query results. The NVIDIA free API tier is for trials, so check its data terms before you upload real customer data. Show one line on the upload screen: "Sample rows, questions and query results are sent to NVIDIA's AI service. Do not upload passwords or patient data."

### 3.11 NVIDIA only for workspace data (decided 2026-11-12)

Workspace data goes only to NVIDIA (`integrate.api.nvidia.com`). There are two model lists, so formatting and analysis use different models:

| Env var | Job | Rule |
|---|---|---|
| `FORMAT_MODELS` | Make the format plan at upload (section 3.5) | Small, fast model with reliable JSON. No tools |
| `WORKSPACE_MODELS` | Workspace chat and analysis | Strong tool-calling model. `nvidia:` entries only |
| `LLM_MODELS` | df-dev chat (no change) | Can still fall back to OpenRouter |

`parseModels` refuses a model in `FORMAT_MODELS` or `WORKSPACE_MODELS` that does not start with `nvidia:`. Thus a config mistake cannot send workspace data to another provider.

### 3.12 Model test results (2026-11-12)

The test used the account's NVIDIA API key, which can use 84 models. Each model got a messy sheet and had to return a format plan.

- **Easy sheet:** title rows, a totals row, `$1,200.50`, `10%`, `Y/N`, `N/A`, day-first dates.
- **Hard sheet:** a two-row header, US dates, zip codes with leading zeros, phone numbers, a subtotal row in the middle, a footnote row.

The score counts the header row, the dropped rows, each column type and the date order. A dropped data row costs 2 points.

| Model | Easy | Hard | Time | Result |
|---|---|---|---|---|
| `nvidia/nemotron-3.5-bolt-e4b` | 13/13 ×2 | 14/14 ×10 | 2–7 s | **Format model** |
| `nvidia/nemotron-3-ultra-550b-a55b` | 13/13, once empty | 14/14 | 29–70 s | Format fallback. Main chat model today |
| `stepfun-ai/step-5-preview` | 13/13 ×2 | Timeout | 24–49 s | Not used |
| `mistralai/mistral-large-4-1t-a52b` | 13/13 ×2 | Timeout | ~93 s | Too slow |
| `minimaxai/minimax-m3.1-flash` | 13/13 once, network error once | Not run | ~67 s | Chat fallback only |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | Empty content ×2 | Not run | 42–67 s | Reasoning used up the token budget |
| `deepseek-ai/deepseek-v4.1-flash`, `z-ai/glm-5.3-flash`, `openai/gpt-oss-20b` | Timeout (120 s) | Not run | | Not usable on the free tier today |
| `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-nano-3-30b-a3b`, `moonshotai/kimi-k2.6`, `google/gemma-4-31b-it` | HTTP 404 | | | Listed, but not available to this account |

Settings for `.env`:

```sh
FORMAT_MODELS=nvidia:nvidia/nemotron-3.5-bolt-e4b,nvidia:nvidia/nemotron-3-ultra-550b-a55b
WORKSPACE_MODELS=nvidia:nvidia/nemotron-3-ultra-550b-a55b,nvidia:minimaxai/minimax-m3.1-flash,nvidia:nvidia/nemotron-3.5-lightning-30b-a3b,nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b
```

- `WORKSPACE_MODELS` is today's `DEFAULT_MODELS` list without the OpenRouter entry. Those NVIDIA models already passed the tool-call test on 2026-10-26 ([model.ts:12](../app/api/chat/model.ts#L12)).
- The format call sends `temperature: 0`. Make `label` and `description` required in the schema. When they were optional, the model left the descriptions empty and kept the raw labels.
- `complete()` in model.ts sends `tools` and a fixed body. It gets one more option: extra body fields (`response_format`, `temperature`), with no tools. The fallback and cooldown logic stays the same.
- The test script is in the session scratchpad. Move it to `scripts/bench-format.mjs` if you want to run it again when NVIDIA changes its catalog.

## 4. Data model

App database (`prompt-kpi`):

```ts
// users: unique index on email
{ email, name, role, hash, mustChangePassword: boolean, disabled: boolean, createdBy, createdAt }

// workspaces: unique index on slug
{ name, slug, dbName, ownerEmail, status: "empty" | "ready",
  context?: string, goals?: string, columnNotes?: Record<string, string>,
  tables: { collection, sheet, rows, columns: { key, label, type, nulls, samples, min?, max? }[] }[],
  createdAt, updatedAt }

// uploads
{ workspaceId, fileName, by, at, status: "staged" | "stored" | "discarded" | "undone",
  sheets: { sheet, collection, staging, rows, mode: "new" | "append" | "replace", columns, changes: string[], preview: object[] }[] }
```

Workspace database (`ws_<slug>`): one collection per sheet. Each row has `_upload`.

## 5. Files

| File | Change |
|---|---|
| `app/db.ts` | New. Moves the cached `MongoClient` out of route.ts. Exports `appDb()` and `mongo` |
| `app/auth.ts` | Bootstrap users plus database users. `currentUser()` becomes a database read. Adds `requireRole()` |
| `app/users/page.tsx`, `app/users/actions.ts` | "Add user" form, disable button, temporary password shown once |
| `app/password/page.tsx` | Set a new password at first sign-in |
| `app/page.tsx` | Redirect to `/workspaces` for roles other than `super_admin` |
| `app/workspaces/page.tsx`, `actions.ts` | Workspace list and "New workspace" |
| `app/workspaces/[id]/page.tsx` | Chat and data panel, or the upload screen when the workspace is empty |
| `app/workspaces/[id]/upload/page.tsx` | Upload, review and store flow, also used for "Add data" |
| `app/workspaces/[id]/context/page.tsx` | Context questions |
| `app/workspaces/standardise.ts` | `planFormat(rows)`: one call to `FORMAT_MODELS`, returns a plan or null. `standardise(rows, plan \| null)`: pure function that applies the plan (section 3.5) |
| `app/api/chat/model.ts` | `complete()` takes extra body fields and no tools. `parseModels` takes an `nvidiaOnly` flag (section 3.11) |
| `app/api/workspaces/[id]/uploads/route.ts` | `POST` multipart file: parse, plan, standardise, stage, return the preview |
| `app/api/workspaces/[id]/uploads/[uploadId]/route.ts` | `POST {action: "store" \| "discard" \| "undo", mode, edits}` |
| `app/api/chat/route.ts` | Extract `Ctx`. Add the `workspaceId` path and the role checks |
| `app/api/chat/guard.ts` | `scopes` parameter |
| `scripts/check-standardise.mjs` | New check: messy sheet in, expected columns, rows and changes out |
| `scripts/check-guard.mjs`, `check-auth.mjs` | Add workspace scope cases and database-user cases |

The upload uses a route handler, not a Server Action. Server Actions have a 1 MB body limit by default (`serverActions.bodySizeLimit`).

Do not copy the chat UI. Move the chat parts of `app/page.tsx` (message list, `Reply`, input, stream reader) into `app/Chat.tsx` with a `workspaceId` prop. The df-dev page and the workspace page both use it.

## 6. Screens

The screens use the existing tokens (`paper`, `surface`, `line`, `ink`, `muted`, `primary`, `tertiary`), DM Sans for text and Newsreader for headings. No new fonts or colours.

### 6.1 Workspaces list (`/workspaces`)

```
┌──────────────────────────────────────────────────────────┐
│ Logo                                   Users   Ashok ▾   │
├──────────────────────────────────────────────────────────┤
│  Workspaces                              [+ New workspace]│
│                                                          │
│  ┌──────────────────────┐ ┌──────────────────────┐       │
│  │ Sales 2026           │ │ Clinic survey        │       │
│  │ 3 sheets · 18,204 rows│ │ Needs data           │       │
│  │ Updated 2 days ago   │ │ Upload a file →      │       │
│  └──────────────────────┘ └──────────────────────┘       │
└──────────────────────────────────────────────────────────┘
```

Empty state: "Create a workspace, then upload an Excel or CSV file to ask questions about it."

### 6.2 Upload flow (`/workspaces/[id]/upload`)

This is a real sequence, so it shows step labels: **Upload → Review → Store → Context**.

The signature element is the **column ledger** in the Review step. Each column header shows what the standardise step did to it. The user sees the cleanup, not only the result.

```
 Upload ── Review ── Store ── Context

 orders.xlsx · sheet "Orders" · 1,204 rows          [Discard]  [Store 1,204 rows]

 We made 4 changes                         ▸ show all
 · Removed 2 title rows above the table
 · Changed Amount from text to numbers (1,204 values)
 · Read Order date as dates (day/month)   [switch to month/day]
 · Removed 3 duplicate rows

 ┌────────────────┬──────────────┬───────────────┬──────────┐
 │ Order date  ✎  │ Customer  ✎  │ Amount     ✎  │ Paid  ✎  │
 │ date           │ text         │ number        │ yes/no   │
 │ was "Ord Dt"   │              │ was text      │ was Y/N  │
 ├────────────────┼──────────────┼───────────────┼──────────┤
 │ 2026-01-04     │ Acme         │     1,200.50  │ Yes      │
 │ …first 50 rows                                          │
 └─────────────────────────────────────────────────────────┘
```

- The ✎ button opens a small menu to rename the column or change its type.
- Numbers use tabular figures and align right.
- The table scrolls inside its own box on small screens. The page does not scroll sideways.
- With no changes, the change box reads "This file is already clean."
- A file with several sheets shows one tab for each sheet. Each sheet has a checkbox to include or skip it.
- The Store button shows a spinner and is disabled while it runs. Errors appear next to the button with the fix, for example "Amount has 12 values that are not numbers. Change the type to text, or fix the file."

### 6.3 Context (`/workspaces/[id]/context`)

This is one page with large text fields: the two fixed questions, then the column questions. It has a "Skip for now" link and a "Save and start chatting" button.

### 6.4 Workspace (`/workspaces/[id]`)

```
┌────────────────────────────────────────┬─────────────────┐
│ Sales 2026                              │ Data            │
│                                         │ Orders  1,204   │
│   (existing chat UI, same Reply,        │ Returns   88    │
│    CSV download, follow-up buttons)     │                 │
│                                         │ Uploads         │
│                                         │ orders.xlsx  ↶  │
│                                         │ [+ Add data]    │
│ [ Ask about this data…            ↑ ]   │ Edit context    │
└────────────────────────────────────────┴─────────────────┘
```

On a phone, the data panel moves into a "Data" button that opens a sheet.

The empty-chat suggestions come from the user's goals and the column names. They do not come from the df-dev `SUGGESTIONS`.

### 6.5 Users (`/users`)

The existing list gets an "Add user" button. The form has name, email and role, and shows the temporary password once with a "Copy" button. Each row gets a "Disable" button, with a confirmation dialog.

## 7. Build order

Each phase works by itself and can ship by itself.

| Phase | Scope | Done when |
|---|---|---|
| 0 | df-dev for `super_admin` only: `/` redirect and `/api/chat` role check | A member cannot open the df-dev chat or call its API |
| 1 | Users in the database, add user, disable user, first-login password | A super admin adds a member, and the member signs in and sets a password |
| 2 | `app/db.ts`, workspaces list and create (max 2), upload, format plan, standardise, review, store | The hard test sheet from section 3.12 becomes a clean collection in `ws_<slug>`, the rule-only path also works with the AI switched off, and `check-standardise` passes |
| 3 | Context questions | The answers are stored and editable |
| 4 | `Chat.tsx` extract, `Ctx` in route.ts, guard scopes, workspace chat | A member gets correct answers about the uploaded data and cannot read `df-dev` or another workspace |
| 5 | Add data (append, replace, new columns) and undo upload | A second file adds rows, and undo removes them |
| Later | Caching of repeated questions, workspace sharing, AI column-name suggestions, charts, scheduled re-uploads | |

## 8. Security checks

- Every workspace route and API calls `requireWorkspace(id)`: the owner, or a `super_admin`. A wrong id gives 404, not 403, so the response does not show which ids exist.
- The workspace chat uses the same guard: read-only, no `"db":`, and lookups only into that workspace's collections.
- Header keys never start with `$` and never contain `.`. This prevents operator injection through column names.
- CSV export keeps the existing formula-injection guard (`cell()` in guard.ts).
- Cell text is data, not instructions. The workspace system prompt repeats this rule.
- Upload limits (section 3.4) are checked before parsing, by size, and after parsing, by rows and columns.
- Admins cannot create `super_admin` or `admin` users. The server action checks this, not only the form.

## 9. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Database per workspace or collection per workspace? | Database per workspace, max 2 workspaces per user (decided 2026-11-12) |
| 2 | Can `admin` users add users? | Yes, `member` users only (decided 2026-11-12) |
| 3 | Can super admins open every workspace? | Yes, for support (default, not yet confirmed) |
| 4 | AI provider for workspace data | NVIDIA only, with a separate format model (decided 2026-11-12, section 3.11) |
