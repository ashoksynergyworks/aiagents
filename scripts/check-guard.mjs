// Self-check for the agent's pipeline guard and CSV export. Run: npm test
import assert from "node:assert/strict";
import { BSON } from "mongodb";
import { parsePipeline, toCsv } from "../app/api/chat/guard.ts";

const blocked = [
  [{ $out: "x" }],
  [{ $merge: { into: "x" } }],
  '[{"\\u0024out":"x"}]', // JSON escape must not sneak $out past the check
  '[{"\\u0024merge":{"into":"x"}}]',
  [{ $match: { $where: "1" } }],
  [{ $group: { _id: null, x: { $accumulator: {} } } }],
  [{ $lookup: { from: "patients", localField: "patientId", foreignField: "_id", as: "p" } }],
  [{ $lookup: { from: { db: "admin", coll: "system.users" }, as: "x", pipeline: [] } }],
  [{ $unionWith: { coll: "loginlogs" } }],
  [{ $unionWith: "loginlogs" }], // string shorthand
  [{ $project: { x: "$password" } }],
  { $match: {} }, // not an array
];
for (const p of blocked) assert.throws(() => parsePipeline(p), `should block ${JSON.stringify(p)}`);

const allowed = [
  [{ $match: { "address.city": { $regex: "^miami$", $options: "i" } } }, { $group: { _id: "$isDeleted", n: { $sum: 1 } } }],
  [{ $lookup: { from: "pcps", localField: "pcpId", foreignField: "_id", as: "p" } }, { $unionWith: "specialists" }],
  '[{"$match":{"_id":{"$oid":"63c547fda93be66ff86f86b8"},"createdAt":{"$gte":{"$date":"2026-01-01T00:00:00Z"}}}}]',
  [{ $match: { isTempPassword: true, bByPassOTP: false } }],
];
for (const p of allowed) assert.doesNotThrow(() => parsePipeline(p), `should allow ${JSON.stringify(p)}`);

const [stage] = parsePipeline(allowed[2]);
assert.equal(stage.$match._id.constructor.name, "ObjectId");
assert.ok(stage.$match.createdAt.$gte instanceof Date);

const csv = toCsv([
  { Office: 'Smith, "Main" Clinic', Count: -3, password: "hash", Note: "=HYPERLINK(1)", Id: new BSON.ObjectId("63c547fda93be66ff86f86b8") },
  { Office: "Line\nbreak", Count: 7, When: new Date("2026-09-01T00:00:00Z"), Tags: ["a", "b"] },
]);
assert.equal(
  csv,
  [
    "Office,Count,Note,Id,When,Tags",
    '"Smith, ""Main"" Clinic",-3,\'=HYPERLINK(1),63c547fda93be66ff86f86b8,,',
    '"Line\nbreak",7,,,2026-09-01T00:00:00.000Z,a; b',
  ].join("\r\n"),
);

console.log(`guard ok: ${blocked.length} blocked, ${allowed.length} allowed, csv escaping ok`);
