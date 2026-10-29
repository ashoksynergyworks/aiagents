# Stream report answers live as the model writes them

Written against: `94ff37b` (main, clean)

## Evidence chain

- Surface: the conversation view in `app/page.tsx` (`Home`, the `messages.length > 0` branch) and its API, `POST /api/chat` in `app/api/chat/route.ts`.
- Problem: the answer appears all at once after the whole agent loop finishes. `route.ts` runs up to 10 model steps with database tools in between, then returns a single `Response.json(...)` (`done()`). `complete()` in `app/api/chat/model.ts` calls the provider without `stream` and reads `res.json()`. Meanwhile the client shows only one fixed line, `<Mark running /> Running queries. Reports can take up to a minute.` (`page.tsx`, `loading === activeId`), for up to a minute, and nothing says which step is running.
- Design evidence:
  - `Mark` with `running` (`page.tsx`) is the product's "query in flight" indicator. Its comment says: "the arc runs while a query is in flight". It already respects `motion-reduce`.
  - Tokens live in `app/globals.css` (`--color-*`, `--animate-rise`, `--animate-travel`). There is no other loading or progress pattern.
  - `Reply` (`page.tsx`) parses pipe tables and insight labels (`LABEL`) line by line, so it can render text that is still arriving.
  - Follow-ups are cut out of the reply on the server (`splitFollowUps`, `app/api/chat/guard.ts:105`) and shown as `CHIP` buttons.
- Owner: `app/page.tsx` (UI), `app/api/chat/route.ts` (agent loop and response), `app/api/chat/model.ts` (provider calls and fallback).
- Scope and affected surfaces: the conversation view only. The empty state, the sidebar, the DB status check (`GET /api/chat`) and the CSV download are unchanged.
- Uncertainty: the streaming tool-call support of each configured provider (NVIDIA NIM, OpenRouter, Ollama) is only proven by a live run. The non-SSE fallback branch below covers providers that ignore `stream: true`.

## Design decision

Stream real model tokens from the provider, through the route, to the page. Text appears as it is generated. Before any text exists, the existing `Mark running` row shows the current step in plain words.

Wire format: NDJSON, one JSON object per line. It needs no library, and a client can parse it with `TextDecoderStream` and a line split.

| Event | Sent when | Client does |
| --- | --- | --- |
| `{"type":"status","text":"Calculating referral KPIs"}` | before each tool call, and after a tool batch | sets the label on the status row |
| `{"type":"delta","text":"…"}` | for each content token of the current model turn | appends the text to the streaming answer |
| `{"type":"reset"}` | the turn that streamed text turned out to call tools, or the model failed mid-answer and a fallback model takes over | drops the streamed text and shows the status row again |
| `{"type":"done","reply","followUps","used","files","fallback?"}` | the loop finished | replaces the text with `reply` (authoritative) and shows the files, the meta row and the follow-up chips |
| `{"type":"error","error":"…"}` | a failure after streaming started | the same rollback as today's error path |

Errors found before the stream starts (no models: 500, a bad body: 400) stay plain JSON with their status codes. The client's `!res.ok` path keeps handling them.

Keep these when the answer is done:

- Final rendering is byte-for-byte what users see today. During streaming only:
  - the follow-up section is hidden, because it becomes chips at `done` and must not show as text first;
  - the row that is still being written is left out of the numeric-column alignment check, so columns don't flip between left and right aligned with each token.
- Autoscroll follows the stream only while the reader is near the bottom.
- A Stop control replaces Send while this chat's request is running. Reports take up to a minute, and today `loading` blocks sending anywhere for that whole time.

## Reuse

- `Mark` with `running` for the in-flight row, including after text starts (shown below the streaming text, with no label). Add no spinner, caret or new keyframe.
- The existing status row `<p role="status" className="flex items-center gap-3 text-sm text-muted">` (`page.tsx`). Only its label becomes dynamic.
- The Send button's classes for Stop: same element, same size, same `bg-primary`.
- `ICONS` / `Icon` for the stop glyph. Add one path, `stop: "M7 7h10v10H7z"`.
- `animate-rise` on the assistant `<article>` (it already exists). The streaming and final states must be the same `<article>` element so it doesn't remount and animate twice.
- `parseCompletion()` (`model.ts`): rebuild the streamed turn into the shape it already validates, so every existing fallback rule still applies.
- Exemplar for the stream shape: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` § Streaming ("You can also use the underlying Web APIs directly"). Don't add the `ai` SDK.

No new primitive is needed.

## Changes

1. `app/api/chat/model.ts`: stream from the provider and keep the fallback.
   - Change:
     - Add a last parameter to `complete()`: `hooks: { onDelta?: (text: string) => void; onReset?: () => void; signal?: AbortSignal } = {}`. Existing callers and tests pass positional args and stay valid.
     - Add `stream: true` to the request body.
     - Use `signal: AbortSignal.any([AbortSignal.timeout(m.timeout), ...(hooks.signal ? [hooks.signal] : [])])`.
     - Read the body:
       - If `res.headers.get("content-type")` includes `text/event-stream`, use a new local `readSse(res, onDelta)`.
       - Otherwise use `res.json()` as today. This keeps providers that ignore `stream` and keeps every `Response.json` stub in `scripts/check-model.mjs` working.
     - What `readSse` does:
       - Buffers partial lines across chunks.
       - Handles `data: …` lines. It ignores `:` comment and keep-alive lines (OpenRouter sends `: OPENROUTER PROCESSING`) and stops at `data: [DONE]`.
       - Accumulates `delta.content`, `delta.refusal` and `finish_reason`. It takes `usage` from any chunk that has one.
       - Merges `delta.tool_calls[]` by `index`: it keeps the first `id`, `type` and `function.name`, and concatenates `function.arguments`.
       - Throws `InvalidCompletion("stream error")` on a chunk that has an `error` object.
       - Returns `{ choices: [{ finish_reason, message: { content, refusal?, tool_calls? } }], usage }` for `parseCompletion()`.
       - Calls `onDelta` for content only while no tool-call delta has been seen in this attempt. It records in a local `emitted` flag whether it sent any text.
     - After `parseCompletion()`, if the turn has `tool_calls` and text was emitted, call `hooks.onReset?.()`.
     - In `catch`:
       - If `hooks.signal?.aborted`, rethrow at once. Don't set a cooldown and don't try other models; a user's Stop is not a model failure.
       - Otherwise, if text was emitted, call `hooks.onReset?.()` before the next model. `ContentFilteredError` is still rethrown before any of this.
     - Don't send `stream_options`. Some OpenAI-compatible servers reject unknown params. Add `// ponytail: usage only when the provider sends it in-stream`.
   - Preserve:
     - Whole-turn validation before any tool runs (the file's header comment).
     - Cooldown, the 429 retry, wrap-around order, sanitized error strings.
     - Content filter is never routed around.
   - Verify: `npm test` passes unchanged, plus the new cases in step 4.

2. `app/api/chat/route.ts` (`POST`): return a stream.
   - Change:
     - Keep the two early JSON returns (no models, bad `messages`) as they are.
     - Then return `new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" } })`.
       - `stream` is a `ReadableStream` whose `start(controller)` runs the existing loop.
       - Its `cancel()` calls `ac.abort()` on a local `AbortController`.
       - `const signal = AbortSignal.any([req.signal, ac.signal])`.
       - `send = (e: object) => { if (!signal.aborted) controller.enqueue(new TextEncoder().encode(JSON.stringify(e) + "\n")) }`.
       - The loop ends with `controller.close()` in `finally`.
     - Pass `{ onDelta: (text) => send({ type: "delta", text }), onReset: () => send({ type: "reset" }), signal }` to `complete()`.
     - At the top of each step and before each tool call: if `signal.aborted`, log `tag, "aborted by client"` and return. If `complete()` throws while `signal.aborted`, do the same, with no error event.
     - Status events, in plain words. Collection names already appear to users in the "Queried …" footer.
       - Before each tool call, send one of:
         - `kpis`: "Calculating referral KPIs"
         - `export_csv`: "Building the CSV"
         - `aggregate`: `Looking up ${args.collection}`
       - After a tool batch, before the next `complete()`: "Reading the results".
     - `done(reply)`: send `{ type: "done", ...splitFollowUps(reply), used, files, fallback? }` instead of `Response.json`. Send its "No database query succeeded…" branch as `{ type: "error", error }`.
     - The `complete()` failure path becomes `send({ type: "error", error: out.message })`. The 422 and 502 status codes go away once streaming. The message text stays the same, and the client only ever read `.error`.
     - Keep every `console.*` line and the `tag`.
   - Preserve:
     - `GET` and the system prompt.
     - The tools, the guard, the `MAX_CHARS` truncation and the CSV build.
     - The loop limit of 10 steps and its "too many lookups" reply. That reply goes out as a `done` with no deltas.
   - Verify: `curl -N -X POST localhost:3000/api/chat -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"How many PCPs are in Miami?"}]}'` prints `status` lines, then many `delta` lines over time, then one `done` line.

3. `app/page.tsx`: render the stream.
   - Change:
     - Types:
       - Add `streaming?: boolean; stopped?: boolean` to `Msg`.
       - Add `stop: "M7 7h10v10H7z"` to `ICONS`.
     - State:
       - `const [status, setStatus] = useState("")`.
       - `const abortRef = useRef<AbortController>(null)`.
       - `const stick = useRef(true)`.
     - `send()`:
       - Create an `AbortController`, store it in `abortRef`, and pass its `signal` to `fetch`. Set `stick.current = true` and `setStatus("")`.
       - On `!res.ok`, throw `(await res.json().catch(() => ({}))).error ?? "Request failed"`.
       - Otherwise read `res.body!.pipeThrough(new TextDecoderStream()).getReader()`. Buffer the text and split on `"\n"`, keeping the last partial line for the next read. Handle each line as below.

       | Event | Handling |
       | --- | --- |
       | `status` | `setStatus(e.text)` |
       | `delta` | `text += e.text`, then `put([...next, { role: "assistant", content: text, streaming: true }])` |
       | `reset` | `text = ""`, then `put(next)` |
       | `error` | `throw new Error(e.error)` |
       | `done` | keep it as `final` |

       - After the loop, if there is no `final`, throw "The connection dropped before the report finished. Try again."
       - Otherwise call `put([...next, { role: "assistant", content: final.reply, used, files, fallback, followUps }])` with the same fields as today, and keep the `[chat] ←` log.
       - In `catch`, for an `AbortError`:
         - If `text` is non-empty, `put([...next, { role: "assistant", content: text, stopped: true }])`.
         - Otherwise roll back exactly as the error path does (restore `prev`, put the question back in the input), but don't call `setError`.
       - All other errors keep the current rollback and alert. The partial text is dropped, which also covers a content-filter block mid-answer.
       - In `finally`, also clear `abortRef.current`.
     - Composer button:
       - `const busy = !!loading && loading === activeId`.
       - Use the same `<button>` with these props:
         - `type`: `busy ? "button" : "submit"`
         - `aria-label`: `busy ? "Stop" : "Send"`
         - `onClick`: `busy ? () => abortRef.current?.abort() : undefined`
         - `disabled`: `busy ? false : !!loading || !input.trim()`
         - icon: `busy ? "stop" : "send"`
       - Keep the classes unchanged.
     - Assistant `<article>`:
       - Add `aria-busy={m.streaming || undefined}` so screen readers in the `role="log" aria-live="polite"` region read the answer once it is complete, not token by token.
       - Pass `streaming={m.streaming}` to `Reply`.
       - Render the files, the meta row and the follow-ups only when `!m.streaming`. In the meta row, add `{m.stopped && <span>· Stopped</span>}` after the existing spans.
     - Status row: keep the element and show it while `loading === activeId`.
       - If the last message is `streaming`, it shows only `<Mark running className="size-7" />` (it sits below the text).
       - Otherwise it shows the Mark plus `{status || "Running queries"}. Reports can take up to a minute.` The default keeps today's copy until the first status arrives.
     - `Reply({ text, streaming })`:
       - When a `LABEL` line matches follow-up questions and `streaming` is true, `break`. The chips replace that section at `done`.
       - For column alignment, use `const settled = streaming ? body.slice(0, -1) : body` in place of `body` inside the `num` computation. The row still being written doesn't vote.
       - Wrap with `memo` so earlier answers aren't re-parsed on each token. Add `// ponytail: memo only; batch deltas per animation frame if long chats still stutter`.
     - Autoscroll:
       - Add `onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}` to the `role="log"` `<main>`.
       - Gate the existing effect: `if (stick.current) endRef.current?.scrollIntoView({ block: "end" })`. Add `status` to its deps.
       - Set `stick.current = true` in the recents `onClick`, so opening a chat starts at its end.
   - Preserve:
     - All copy, tokens and classes not named above.
     - The empty state, the sidebar, the DB check and the CSV download.
     - The rollback-on-error behaviour and `put()`.
     - Follow-up chips only on the last message.
   - Verify: the walkthrough under Validation.

4. `scripts/check-model.mjs`: one streaming block, appended before the final `console.log`.
   - Change: add an SSE stub helper:

     ```js
     const sse = (...chunks) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + ": keep-alive\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
     ```

     Pass `{ onDelta, onReset, signal }` as the 8th `complete()` argument. Assert:
     - (a) Streamed content arrives as deltas and returns the joined text.
     - (b) Tool-call fragments split across chunks (`arguments` in two pieces) come back equal to `toolCall()`.
     - (c) A primary model that streams `"Par"` and ends with `finish_reason: "length"` calls `onReset` once, then the backup's deltas follow. `attempted` is `["primary", "backup"]`.
     - (d) An already-aborted `signal` rejects and leaves `cooldown` empty.
   - Preserve: every existing assertion.
   - Verify: `npm test` prints the existing three "ok" lines.

## Scope

- Inherit: every assistant answer in the conversation view, including CSV reports, the "what needs attention" briefing and follow-up sends.
- Verify:
  - Recents switching while a request runs: the status row and Stop show only in the chat that is loading.
  - The mobile header and composer at 375px.
  - Copy reply on a finished and on a stopped answer.
- Exclude:
  - Markdown beyond what `Reply` already parses.
  - Persisting chats.
  - Resuming a dropped stream.
  - Showing tool arguments or pipelines.
  - Cancelling an in-flight Mongo query. It still ends within `maxTimeMS: 15_000`, and the loop stops after it.
  - Vercel `maxDuration`. Total duration is unchanged by streaming.

## Validation

- Product: in `npm run dev`, ask "Top 10 specialist groups by referrals in the last 90 days".
  - The status label changes (for example "Calculating referral KPIs", then "Reading the results").
  - The answer then writes itself in, with the running Mark below it.
  - At the end the "Queried …" line and follow-up chips appear, and the text above doesn't move.
- Interface (drive with `agent-browser` per the user's global instructions; take screenshots mid-stream and at done):
  - Table rows stream in without numeric columns jumping between left and right aligned.
  - The "Follow-up questions" heading never appears as text.
  - Scroll up mid-stream and the view stays put; scroll back to the bottom and it follows again.
  - Stop mid-answer:
    - the partial text stays, with "· Stopped";
    - the composer works at once;
    - the terminal logs `aborted by client` and no further `[ai]` lines for that tag.
  - Stop before any text: the question returns to the composer and no alert shows.
  - The CSV prompt from `SUGGESTIONS` shows the download card at done.
  - The DB-down case still shows the alert and rolls back.
  - Reduced motion: the Mark arc is static.
  - At 375px wide, no horizontal scroll.
- System:
  - In DevTools Network, `/api/chat` is `application/x-ndjson` and the response grows over time.
  - No new dependency in `package.json`.
  - No new spinner or caret component; the in-flight state is still `Mark running`.
- Repository:
  - `npm test` → three "ok" lines, including the new streaming assertions.
  - `npm run lint` → no errors.
  - `npx tsc --noEmit` → no errors.

## Stop conditions

- Stop if the primary model now always falls back after the change (`[ai] failed … stream error` or `invalid tool call` in logs). That means its tool-call stream format differs; report the raw chunk shape instead of loosening `parseCompletion()`.
- Stop if Stop doesn't produce `aborted by client` on the server. Neither `cancel()` nor `req.signal` fired in this Next version; report it rather than adding polling.
- Stop if `next dev` or `next start` delivers the whole body at once (buffered, for example by compression). Report it with the response headers.
- Stop if keeping final rendering identical would need changes to `splitFollowUps()` or the system prompt.

## Design documentation

- After acceptance and validation, update `README.md`:
  - The "Agent:" paragraph: `POST /api/chat` streams NDJSON events (`status`, `delta`, `reset`, `done`, `error`); `done` carries `reply`, `followUps`, `used`, `files` and `fallback`.
  - "Models and fallback": a model that fails mid-answer is retried on the next model after a `reset`, and a user's Stop never puts a model in cooldown.
