// OpenAI-compatible endpoints can return HTTP 200 with an unusable completion.
// Validate the whole turn before executing any tool call so a bad primary response can fall back.
export const TOOL_NAMES = ["aggregate", "export_csv", "kpis"] as const;
type ToolName = (typeof TOOL_NAMES)[number];
const MAX_TOOL_CALLS = 8; // avoid an unbounded number of database queries in one step

// Any OpenAI-compatible /chat/completions endpoint is a provider: hosted APIs, NVIDIA NIM, Ollama, vLLM, Bedrock (/openai/v1).
// LLM_MODELS is an ordered "<provider>:<model>,…" list. A provider needs <PROVIDER>_BASE_URL (built in below) and
// <PROVIDER>_API_KEY, except one given its own base URL, which may run without auth (a local server).
const BASE_URLS: Record<string, string> = { nvidia: "https://integrate.api.nvidia.com/v1", openrouter: "https://openrouter.ai/api/v1" };
// The NVIDIA models made valid tool calls on 2026-10-26 (many catalog models 404 per account or time out on the free tier).
// NVIDIA leads: its free tier allows ~40 req/min vs OpenRouter's 50 req/day. OpenRouter sits third so an
// NVIDIA-wide outage costs two attempts. openrouter/free was dropped on 2026-10-29: it routes to a random free model,
// and in QA those worked out rates in their heads instead of using the query results.
export const DEFAULT_MODELS =
  "nvidia:nvidia/nemotron-3-ultra-550b-a55b,nvidia:minimaxai/minimax-m3.1-flash,openrouter:google/gemma-4-31b-it:free,nvidia:nvidia/nemotron-3.5-lightning-30b-a3b,nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b";

export type Model = { id: string; name: string; url: string; key?: string; timeout: number };

export function parseModels(list: string, env: Record<string, string | undefined>): Model[] {
  const models = new Map<string, Model>(); // keyed by id, so a repeated entry is tried once
  for (const id of list.split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = id.indexOf(":"); // first colon only: "openrouter:x/y:free", "ollama:qwen3:32b"
    const P = id.slice(0, Math.max(i, 0)).toUpperCase().replace(/\W/g, "_");
    const base = env[`${P}_BASE_URL`]?.trim();
    const url = base || BASE_URLS[P.toLowerCase()];
    const key = env[`${P}_API_KEY`]?.trim() || undefined;
    if (i < 1 || i === id.length - 1 || !url || (!key && !base)) {
      console.warn("[ai] skipping model", id, i < 1 ? "(write it as provider:model)" : !url ? `(set ${P}_BASE_URL)` : `(set ${P}_API_KEY)`);
      continue;
    }
    models.set(id, { id, name: id.slice(i + 1), url: `${url.replace(/\/+$/, "")}/chat/completions`, key, timeout: Number(env[`${P}_TIMEOUT_MS`]) || 60_000 });
  }
  return [...models.values()];
}

// A failed model is skipped by later requests for a while instead of costing another timeout each time.
const COOLDOWN_MS = 5 * 60_000;
// ponytail: per server process; move to a shared store if several instances serve the app
const g = globalThis as unknown as { llmCooldown?: Map<string, number> };
export const cooldown = (g.llmCooldown ??= new Map<string, number>()); // model id → when it may be tried again

type ToolCall = { id: string; type: "function"; function: { name: ToolName; arguments: string } };
export type ModelMessage = { content: string; tool_calls?: ToolCall[] };

class InvalidCompletion extends Error {}
export class ContentFilteredError extends Error {}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseCompletion(body: unknown): { msg: ModelMessage; finish: unknown; usage: Record<string, unknown> | null } {
  const response = record(body);
  const choices = response?.choices;
  if (!Array.isArray(choices)) throw new InvalidCompletion("missing choices");
  const choice = record(choices[0]);
  if (!choice) throw new InvalidCompletion("missing choices");
  // A policy block is not an outage: never route a filtered request around the filter.
  if (choice.finish_reason === "content_filter") throw new ContentFilteredError("The model could not answer this request.");
  const message = record(choice.message);
  if (message && typeof message.refusal === "string" && message.refusal.trim())
    throw new ContentFilteredError("The model could not answer this request.");
  if (choice.finish_reason === "length") throw new InvalidCompletion("output token limit reached");
  if (choice.finish_reason != null && choice.finish_reason !== "stop" && choice.finish_reason !== "tool_calls")
    throw new InvalidCompletion("unexpected finish reason");
  if (!message) throw new InvalidCompletion("missing message");
  const content = message.content ?? "";
  if (typeof content !== "string") throw new InvalidCompletion("invalid message content");

  let tool_calls: ToolCall[] | undefined;
  if (message.tool_calls != null) {
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length > MAX_TOOL_CALLS) throw new InvalidCompletion("invalid tool calls");
    const ids = new Set<string>();
    tool_calls = message.tool_calls.map((value: unknown) => {
      const call = record(value);
      const fn = record(call?.function);
      if (!call || typeof call.id !== "string" || !call.id.trim() || ids.has(call.id) || (call.type != null && call.type !== "function"))
        throw new InvalidCompletion("invalid tool call id or type");
      ids.add(call.id);
      if (!fn || !TOOL_NAMES.includes(fn.name as ToolName)) throw new InvalidCompletion("unknown tool name");
      const name = fn.name as ToolName;
      if (typeof fn.arguments !== "string") throw new InvalidCompletion("invalid tool arguments");
      let args: unknown;
      try {
        args = JSON.parse(fn.arguments);
      } catch {
        throw new InvalidCompletion("invalid tool arguments JSON");
      }
      const parsed = record(args);
      // kpis checks its own dates and options (kpis.ts) and returns errors to the model like a query error
      const valid = name === TOOL_NAMES[2]
        ? typeof parsed?.from === "string" && typeof parsed.to === "string"
        : !!parsed && typeof parsed.collection === "string" && !!parsed.collection.trim() &&
          (Array.isArray(parsed.pipeline) || typeof parsed.pipeline === "string") &&
          (name !== TOOL_NAMES[1] || (typeof parsed.filename === "string" && !!parsed.filename.trim()));
      if (!valid) throw new InvalidCompletion("missing or invalid tool arguments");
      return { id: call.id, type: "function", function: { name, arguments: fn.arguments } };
    });
  }
  if (choice.finish_reason === "tool_calls" && !tool_calls?.length) throw new InvalidCompletion("missing tool calls");
  if (!tool_calls?.length && !content.trim()) throw new InvalidCompletion("empty answer");
  return { msg: { content, ...(tool_calls?.length && { tool_calls }) }, finish: choice.finish_reason, usage: record(response?.usage) };
}

// Tries the current model, then the rest of the list wrapping around. Each gets the same messages, so whichever
// model picks the request up continues from the queries already run. Models in cooldown are skipped unless all are.
export async function complete(messages: object[], tools: object[], models: readonly Model[], from: number, tag: string, fetcher: typeof fetch = fetch, retryAfterMs = 5_000) {
  const errors: string[] = [];
  const order = models.map((_, k) => (from + k) % models.length);
  const ready = order.filter((i) => !((cooldown.get(models[i].id) ?? 0) > Date.now()));
  let attempts = ready.length ? ready : order;
  for (let round = 0; round < 2 && attempts.length; round++) {
    // Free tiers mostly fail with short 429 bursts: rate-limited models get one more try before the request fails.
    if (round) {
      console.warn(tag, `[ai] every model failed; retrying ${attempts.length} rate-limited in ${retryAfterMs}ms`);
      await new Promise((r) => setTimeout(r, retryAfterMs));
    }
    const limited: number[] = [];
    for (const i of attempts) {
      const m = models[i];
      const t = Date.now();
      try {
        const res = await fetcher(m.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(m.key && { Authorization: `Bearer ${m.key}` }) },
          // Reasoning models use part of the token budget for thinking.
          body: JSON.stringify({ model: m.name, messages, tools, temperature: 0.2, max_tokens: 4096 }),
          signal: AbortSignal.timeout(m.timeout),
        });
        if (res.status === 429) limited.push(i);
        if (!res.ok) throw new InvalidCompletion(`HTTP ${res.status}`);
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          throw new InvalidCompletion("invalid JSON response");
        }
        const { msg, finish, usage } = parseCompletion(body);
        console.log(tag, "[ai]", m.id, `${Date.now() - t}ms`, `tokens in=${usage?.prompt_tokens} out=${usage?.completion_tokens}`, `finish=${finish}`, `tool_calls=${msg.tool_calls?.length ?? 0}`);
        cooldown.delete(m.id);
        return { msg, model: i };
      } catch (e) {
        if (e instanceof ContentFilteredError) throw e;
        // Provider error bodies can echo request contents: only report status or our own validation errors.
        const reason = e instanceof InvalidCompletion ? e.message : e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "network error";
        errors.push(`${m.id}: ${reason}`);
        cooldown.set(m.id, Date.now() + COOLDOWN_MS);
        console.warn(tag, "[ai] failed", `${Date.now() - t}ms`, errors.at(-1));
      }
    }
    attempts = limited;
  }
  throw new Error(`Every model failed. ${errors.join(" | ")}`);
}
