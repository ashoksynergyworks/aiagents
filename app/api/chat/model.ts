// NVIDIA's OpenAI-compatible endpoint can return HTTP 200 with an unusable completion.
// Validate the whole turn before executing any tool call so a bad primary response can fall back.
export const TOOL_NAMES = ["aggregate", "export_csv"] as const;
type ToolName = (typeof TOOL_NAMES)[number];
const MAX_TOOL_CALLS = 8; // avoid an unbounded number of database queries in one step

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
      if (fn?.name !== TOOL_NAMES[0] && fn?.name !== TOOL_NAMES[1]) throw new InvalidCompletion("unknown tool name");
      if (typeof fn.arguments !== "string") throw new InvalidCompletion("invalid tool arguments");
      let args: unknown;
      try {
        args = JSON.parse(fn.arguments);
      } catch {
        throw new InvalidCompletion("invalid tool arguments JSON");
      }
      const parsed = record(args);
      if (!parsed || typeof parsed.collection !== "string" || !parsed.collection.trim() ||
          !(Array.isArray(parsed.pipeline) || typeof parsed.pipeline === "string") ||
          (fn.name === TOOL_NAMES[1] && (typeof parsed.filename !== "string" || !parsed.filename.trim())))
        throw new InvalidCompletion("missing or invalid tool arguments");
      return { id: call.id, type: "function", function: { name: fn.name, arguments: fn.arguments } };
    });
  }
  if (choice.finish_reason === "tool_calls" && !tool_calls?.length) throw new InvalidCompletion("missing tool calls");
  if (!tool_calls?.length && !content.trim()) throw new InvalidCompletion("empty answer");
  return { msg: { content, ...(tool_calls?.length && { tool_calls }) }, finish: choice.finish_reason, usage: record(response?.usage) };
}

export async function complete(messages: object[], tools: object[], models: readonly string[], from: number, tag: string, fetcher: typeof fetch = fetch) {
  const errors: string[] = [];
  for (let i = from; i < models.length; i++) {
    const t = Date.now();
    try {
      const res = await fetcher("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, "Content-Type": "application/json" },
        // Reasoning models use part of the token budget for thinking.
        body: JSON.stringify({ model: models[i], messages, tools, temperature: 0.2, max_tokens: 4096 }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new InvalidCompletion(`HTTP ${res.status}`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new InvalidCompletion("invalid JSON response");
      }
      const { msg, finish, usage } = parseCompletion(body);
      console.log(tag, "[ai]", models[i], `${Date.now() - t}ms`, `tokens in=${usage?.prompt_tokens} out=${usage?.completion_tokens}`, `finish=${finish}`, `tool_calls=${msg.tool_calls?.length ?? 0}`);
      return { msg, model: i };
    } catch (e) {
      if (e instanceof ContentFilteredError) throw e;
      // Provider error bodies can echo request contents: only report status or our own validation errors.
      const reason = e instanceof InvalidCompletion ? e.message : e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "network error";
      errors.push(`${models[i]}: ${reason}`);
      console.warn(tag, "[ai] failed", `${Date.now() - t}ms`, errors.at(-1));
    }
  }
  throw new Error(`NVIDIA API failed for every model. ${errors.join(" | ")}`);
}
