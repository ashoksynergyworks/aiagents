# Referral Reports (POC)

AI agent that answers reporting questions from the `df-dev` MongoDB (referrals/appointments, PCPs, specialists, providers, users) using an NVIDIA-hosted LLM with tool calling.

1. MongoDB running at `MONGODB_URI` (see `.env`, default `mongodb://localhost:27017/df-dev`)
2. Put your key from https://build.nvidia.com in `.env` as `NVIDIA_API_KEY` (optional: `NVIDIA_MODEL`, default `nvidia/nemotron-3-super-120b-a12b`)
3. `npm run dev` → http://localhost:3000

Agent: `app/api/chat/route.ts`, two read-only tools over 7 collections: `aggregate` (answers, max 50 rows) and `export_csv` (full result as a CSV download, max 10,000 rows). Model falls back to `z-ai/glm-5.3` if the primary fails. Pipeline guard and CSV escaping: `app/api/chat/guard.ts`, checked by `npm test`. UI: `app/page.tsx`. Schema reference (also the agent's system prompt): `docs/df-dev-schema.md`.

`npm run seed` still loads the old dummy doctor data, into `ai_agent` only (it wipes that DB's collections).
