# Referral Reports (POC)

AI agent that answers reporting questions from the `df-dev` MongoDB (referrals/appointments, PCPs, specialists, providers, users) using LLMs with tool calling, from any OpenAI-compatible provider.

1. MongoDB running at `MONGODB_URI` (default `mongodb://localhost:27017/df-dev`; the database name is pinned to `df-dev`)
2. Put `NVIDIA_API_KEY` (https://build.nvidia.com) and/or `OPENROUTER_API_KEY` (https://openrouter.ai) in `.env`. The default model list (`DEFAULT_MODELS` in `app/api/chat/model.ts`) uses both; models whose provider has no key are skipped. To use other models, see below.
3. `npm run dev` → http://localhost:3000

Agent: `app/api/chat/route.ts`, three read-only tools: `aggregate` (answers, max 50 rows) and `export_csv` (full result as a CSV download, max 10,000 rows) over 19 collections (referrals, orgs, logins, eFax, patient texts, ratings, chat; each through a server-side field allowlist in `guard.ts`), and `kpis` (`app/api/chat/kpis.ts`: referral rates computed in code, with the previous-period change, the median across rows and the office dashboard's threshold flags, by office, group, PCP, specialty, booking channel or month). Database/query errors are returned to the agent to correct; if tool calls fail and none succeed, it returns an error instead of an unverified report.

`POST /api/chat` streams NDJSON, one event per line: `status` (the current step, e.g. "Calculating referral KPIs"), `delta` (answer text as the model writes it), `reset` (drop the streamed text: that turn called tools, or the model failed mid-answer), `done` (`reply`, `followUps`, `used`, `files`, `fallback`) and `error`. Bad requests still get a JSON error with a 4xx/5xx status before the stream starts. The UI's Stop button aborts the request, and the server stops after the step in progress.

Patient data never reaches the model: `guard.ts` puts an allowlist (and, for `users`, a staff-only filter) in front of every pipeline and every `$lookup`/`$unionWith` source, so patient names, contact details, addresses, free text, documents and patient logins are invisible to it, whatever pipeline it writes. `npm run test:phi` runs attack pipelines against the database to check this.

Insights: under a report, the agent adds Key findings, Growth opportunities (Priority, Opportunity, Referrals affected, Recommended action, Watch), a Recommendation and Follow-up questions, in the same model turn, from the same query results. The API returns the follow-ups separately as `followUps[]`, and the UI shows them as buttons. Metric definitions (status buckets for Requests, Confirmed, Lost and so on) live in `docs/df-dev-schema.md`. The database has no website, marketing or patient-feedback data, so the agent says so instead of guessing. This is a POC with no login or per-organisation access: every user sees all organisations. Plan and later phases: `docs/analytics-insights-plan.md`.

## Models and fallback

`LLM_MODELS` is an ordered, comma-separated list of `provider:model` (split on the first colon, so `openrouter:google/gemma-4-31b-it:free` and `ollama:qwen3:32b` work). Any OpenAI-compatible `/chat/completions` endpoint can be a provider: set `<PROVIDER>_BASE_URL`, plus `<PROVIDER>_API_KEY` if it needs auth. `nvidia` and `openrouter` have built-in base URLs and need their key. Optional `<PROVIDER>_TIMEOUT_MS` per attempt (default 60000; raise it for slow local models). Models must support tool calling.

```env
# local Ollama / vLLM / LM Studio: no key needed
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_TIMEOUT_MS=180000
# self-hosted NVIDIA NIM
NIM_BASE_URL=http://nim-host:8000/v1
# AWS Bedrock, OpenAI-compatible endpoint with a Bedrock API key
BEDROCK_BASE_URL=https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1
BEDROCK_API_KEY=...
LLM_MODELS=nim:meta/llama-3.3-70b-instruct,bedrock:openai.gpt-oss-120b-1:0,nvidia:nvidia/nemotron-3-ultra-550b-a55b,ollama:qwen3:32b
```

Each step of a request tries the current model, then the rest of the list (wrapping around), with the whole conversation so far, so queries already run are kept when another model takes over. A step falls back on HTTP/network/timeout errors or unusable responses (bad JSON, missing/empty answer, truncated output, invalid tool calls); later steps stay on the model that worked. A failed model is skipped by later requests for 5 minutes, unless every model is cooling down. If every model fails, rate-limited (HTTP 429) ones get one more try after 5 s, then the stream ends with an `error` event with sanitized failure reasons. A content-filter block is **not** retried on another model. Models are called with `stream: true` (a provider that answers with plain JSON still works); a model that fails mid-answer is followed by a `reset`, then the next model streams its own answer. A user's Stop never puts a model in cooldown.

Free tiers are flaky and change often: NVIDIA lists models an account can't call (HTTP 404), and OpenRouter's free models are limited to 50 requests/day (1,000 after buying $10 of credits) and many are blocked unless free-model training is allowed at https://openrouter.ai/settings/privacy. Free tool-calling models on OpenRouter: `curl -s https://openrouter.ai/api/v1/models | jq -r '.data[] | select(.pricing.prompt=="0" and (.supported_parameters|index("tools"))) | .id'`.

Pipeline guard and CSV escaping: `app/api/chat/guard.ts`; model fallback checks: `app/api/chat/model.ts`. Run `npm test` without a database or API key. UI: `app/page.tsx`. Schema reference (also the agent's system prompt): `docs/df-dev-schema.md`.

