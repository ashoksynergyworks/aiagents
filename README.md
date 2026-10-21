# Referral Reports (POC)

AI agent that answers reporting questions from the `df-dev` MongoDB (referrals/appointments, PCPs, specialists, providers, users) using an NVIDIA-hosted LLM with tool calling.

1. MongoDB running at `MONGODB_URI` (default `mongodb://localhost:27017/df-dev`; the database name is pinned to `df-dev`)
2. Put your key from https://build.nvidia.com in `.env` as `NVIDIA_API_KEY`. Optional: `NVIDIA_MODEL` (default `nvidia/nemotron-3-super-120b-a12b`) and `NVIDIA_FALLBACK_MODEL` (default `z-ai/glm-5.3`).
3. `npm run dev` → http://localhost:3000

Agent: `app/api/chat/route.ts`, two read-only tools over 7 collections: `aggregate` (answers, max 50 rows) and `export_csv` (full result as a CSV download, max 10,000 rows). A model call switches to the fallback on HTTP/network/timeout errors or unusable responses (bad JSON, missing/empty answer, truncated output, invalid tool calls); subsequent turns in that request stay on the fallback. A content-filter block is **not** retried on another model. Both models use the same NVIDIA endpoint and key: the fallback cannot fix an invalid key or a provider outage, and it is not a replacement for MongoDB. Database/query errors are returned to the agent to correct; if tool calls fail and none succeed, it returns an error instead of an unverified report. If both models fail, the API returns a 502 with sanitized failure reasons.

Pipeline guard and CSV escaping: `app/api/chat/guard.ts`; model fallback checks: `app/api/chat/model.ts`. Run `npm test` without a database or API key. UI: `app/page.tsx`. Schema reference (also the agent's system prompt): `docs/df-dev-schema.md`.

