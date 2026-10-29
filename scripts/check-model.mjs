// Self-check for model routing and fallback without API keys, network access, or MongoDB.
import assert from "node:assert/strict";
import { complete, ContentFilteredError, cooldown, DEFAULT_MODELS, parseModels } from "../app/api/chat/model.ts";

// Provider and model split on the first colon; hosted providers need a key, one with its own base URL may run without.
const env = { NVIDIA_API_KEY: "nv-key", OPENROUTER_API_KEY: "or-key", OLLAMA_BASE_URL: "http://localhost:11434/v1/", OLLAMA_TIMEOUT_MS: "180000" };
const parsed = parseModels("nvidia:primary, openrouter:x/backup:free, ollama:qwen3:32b, nvidia:primary, mystery:m, no-provider, nvidia:", env);
assert.deepEqual(
  parsed.map((m) => [m.id, m.name, m.url, m.key, m.timeout]),
  [
    ["nvidia:primary", "primary", "https://integrate.api.nvidia.com/v1/chat/completions", "nv-key", 60000],
    ["openrouter:x/backup:free", "x/backup:free", "https://openrouter.ai/api/v1/chat/completions", "or-key", 60000],
    ["ollama:qwen3:32b", "qwen3:32b", "http://localhost:11434/v1/chat/completions", undefined, 180000],
  ],
);
assert.deepEqual(parseModels("openrouter:a", {}), [], "hosted provider without a key is skipped");
assert.equal(parseModels(DEFAULT_MODELS, { NVIDIA_API_KEY: "k", OPENROUTER_API_KEY: "k" }).length, 5);

const models = parseModels("nvidia:primary,openrouter:backup", env);
const names = models.map((m) => m.name);
const known = [...models, ...parsed];
const tools = [{ type: "function", function: { name: "aggregate", parameters: { type: "object" } } }];
const answer = (content, finish_reason = "stop", more = {}) =>
  Response.json({ choices: [{ finish_reason, message: { content, ...more } }] });
const toolCall = (args = '{"collection":"pcps","pipeline":[]}', name = "aggregate") => ({ id: "call-1", type: "function", function: { name, arguments: args } });

function stub(...responses) {
  cooldown.clear(); // each case starts like a fresh server
  const attempted = [];
  const fetcher = async (url, init) => {
    assert.ok(init.signal);
    const body = JSON.parse(init.body);
    assert.deepEqual(body.tools, tools);
    // each model goes to its own provider's URL with that provider's key, and no header without one
    const m = known.find((x) => x.name === body.model);
    assert.equal(url, m.url);
    assert.equal(init.headers.Authorization, m.key && `Bearer ${m.key}`);
    attempted.push(body.model);
    const response = responses[attempted.length - 1];
    if (response instanceof Error) throw response;
    assert.ok(response, `unexpected request to ${body.model}`);
    return response;
  };
  return { attempted, fetcher };
}

async function run(mock, from = 0, list = models) {
  return complete([{ role: "user", content: "a report" }], tools, list, from, "[test]", mock.fetcher, 0);
}

let mock = stub(answer("Answer"), answer("unused"));
assert.equal((await run(mock)).msg.content, "Answer");
assert.deepEqual(mock.attempted, ["primary"]);

const failures = [
  [new Response("private provider error", { status: 429 }), "HTTP error"],
  [new Error("private network error"), "network error"],
  [new Response("not JSON"), "malformed JSON"],
  [Response.json({ choices: [] }), "missing choice"],
  [answer(""), "empty answer"],
  [answer("partial output", "length"), "truncated answer"],
  [answer(null, "tool_calls"), "missing tool call"],
  [answer("partial", "unknown_reason"), "unexpected finish reason"],
  [answer(null, "tool_calls", { tool_calls: [toolCall("{")] }), "invalid arguments JSON"],
  [answer(null, "tool_calls", { tool_calls: [toolCall("[]")] }), "arguments must be an object"],
  [answer(null, "tool_calls", { tool_calls: [toolCall("{}")] }), "missing collection and pipeline"],
  [answer(null, "tool_calls", { tool_calls: [toolCall('{"collection":"pcps","pipeline":{}}')] }), "invalid pipeline type"],
  [answer(null, "tool_calls", { tool_calls: [toolCall('{"collection":"pcps","pipeline":[]}', "export_csv")] }), "missing CSV filename"],
  [answer(null, "tool_calls", { tool_calls: [toolCall("{}", "unknown_tool")] }), "unknown tool"],
  [answer(null, "tool_calls", { tool_calls: [{ ...toolCall(), id: "" }] }), "missing tool call id"],
  [answer(null, "tool_calls", { tool_calls: [toolCall(), toolCall()] }), "duplicate call id"],
  [answer(null, "tool_calls", { tool_calls: Array.from({ length: 9 }, (_, i) => ({ ...toolCall(), id: `call-${i}` })) }), "too many tool calls"],
];
for (const [bad, description] of failures) {
  mock = stub(bad, answer("Backup answer"));
  const result = await run(mock);
  assert.equal(result.msg.content, "Backup answer", description);
  assert.equal(result.model, 1, description);
  assert.deepEqual(mock.attempted, names, description);
}

// A valid tool turn is returned intact; after switching, later steps stay on the backup.
mock = stub(answer(null, "tool_calls", { tool_calls: [toolCall('{"collection":"pcps","pipeline":[]}')] }));
const toolResult = await run(mock);
assert.equal(toolResult.msg.content, "");
assert.deepEqual(toolResult.msg.tool_calls, [toolCall('{"collection":"pcps","pipeline":[]}')]);
assert.deepEqual(mock.attempted, ["primary"]);
mock = stub(answer("Backup tool result"));
assert.equal((await run(mock, 1)).model, 1);
assert.deepEqual(mock.attempted, ["backup"]);

// Fallback wraps around: a request that moved to the last model can still continue on the first.
mock = stub(new Error("down"), answer("wrapped"));
const wrapped = await run(mock, 1);
assert.equal(wrapped.msg.content, "wrapped");
assert.equal(wrapped.model, 0);
assert.deepEqual(mock.attempted, ["backup", "primary"]);

// A failed model is skipped by the next request; when every model is cooling down, all are tried anyway.
mock = stub(new Response("", { status: 503 }), answer("first"), answer("second"));
await run(mock);
assert.equal((await run(mock)).msg.content, "second");
assert.deepEqual(mock.attempted, ["primary", "backup", "backup"]);
mock = stub(new Error("down"), new Error("down"), answer("recovered"));
await assert.rejects(run(mock));
assert.equal((await run(mock)).msg.content, "recovered");
assert.deepEqual(mock.attempted, ["primary", "backup", "primary"]);

// After every model failed, rate-limited ones get one more try; other failures do not (see the HTTP 500 case below).
mock = stub(new Response("", { status: 429 }), new Error("down"), answer("after wait"));
assert.equal((await run(mock)).msg.content, "after wait");
assert.deepEqual(mock.attempted, ["primary", "backup", "primary"]);

// A local provider without a key gets no Authorization header (checked in the stub).
mock = stub(answer("local"));
assert.equal((await run(mock, 0, parsed.filter((m) => !m.key))).msg.content, "local");
assert.deepEqual(mock.attempted, ["qwen3:32b"]);

// Do not route around the provider's safety filter or repeat the same failed model.
mock = stub(answer(null, "content_filter"), answer("should not run"));
await assert.rejects(run(mock), ContentFilteredError);
assert.deepEqual(mock.attempted, ["primary"]);
mock = stub(answer("", "stop", { refusal: "Policy refusal" }), answer("should not run"));
await assert.rejects(run(mock), ContentFilteredError);
assert.deepEqual(mock.attempted, ["primary"]);
mock = stub(new Response("private provider error", { status: 500 }), new Error("private network error"));
await assert.rejects(run(mock), (e) => {
  assert.match(e.message, /primary: HTTP 500.*backup: network error/);
  assert.doesNotMatch(e.message, /private/);
  return true;
});
assert.deepEqual(mock.attempted, names);

console.log(
  `model fallback ok: provider parsing, ${failures.length} failure modes, valid tool turns, sticky + wrap-around fallback, cooldown, 429 retry, keyless local provider, content filter, sanitized errors`,
);
