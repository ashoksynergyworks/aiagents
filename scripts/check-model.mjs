// Self-check for NVIDIA completion fallback without an API key, network access, or MongoDB.
import assert from "node:assert/strict";
import { complete, ContentFilteredError } from "../app/api/chat/model.ts";

const models = ["primary", "backup"];
const tools = [{ type: "function", function: { name: "aggregate", parameters: { type: "object" } } }];
const answer = (content, finish_reason = "stop", more = {}) =>
  Response.json({ choices: [{ finish_reason, message: { content, ...more } }] });
const toolCall = (args = '{"collection":"pcps","pipeline":[]}', name = "aggregate") => ({ id: "call-1", type: "function", function: { name, arguments: args } });

function stub(...responses) {
  const attempted = [];
  const fetcher = async (url, init) => {
    assert.equal(url, "https://integrate.api.nvidia.com/v1/chat/completions");
    assert.ok(init.signal);
    const body = JSON.parse(init.body);
    assert.deepEqual(body.tools, tools);
    attempted.push(body.model);
    const response = responses[attempted.length - 1];
    if (response instanceof Error) throw response;
    assert.ok(response, `unexpected request to ${body.model}`);
    return response;
  };
  return { attempted, fetcher };
}

async function run(mock, from = 0) {
  return complete([{ role: "user", content: "a report" }], tools, models, from, "[test]", mock.fetcher);
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
  assert.deepEqual(mock.attempted, models, description);
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
assert.deepEqual(mock.attempted, models);

console.log(`model fallback ok: ${failures.length} failure modes, valid tool turns, sticky fallback, content filter, sanitized errors`);
