// Self-check for the kpis tool's argument checks and report maths (no database). Run: npm test
import assert from "node:assert/strict";
import { kpiQuery, kpiReport } from "../app/api/chat/kpis.ts";

for (const bad of [{}, { from: "2026-10-01" }, { from: "2026-10-05", to: "2026-10-01" }, { from: "2026-10-01", to: "2026-10-05", by: "zip" }, { from: "2026-10-01", to: "2026-10-05", compareFrom: "2026-09-01" }])
  assert.throws(() => kpiQuery(bad), `should reject ${JSON.stringify(bad)}`);

// the default comparison is the equal-length period just before; New York days are matched as strings
const periods = (a) => JSON.stringify(kpiQuery(a).pipeline[2]);
const prev = periods({ from: "2026-10-01", to: "2026-10-29" });
assert.ok(prev.includes('"2026-09-02"') && prev.includes('"2026-09-30"'), prev);
assert.ok(periods({ from: "2026-10-01", to: "2026-10-29", compareFrom: "2026-09-01", compareTo: "2026-09-29" }).includes("2026-09-29"));
assert.ok(!periods({ from: "2026-01-01", to: "2026-09-30", by: "month" }).includes('"prev"'));

const c = (requests, o = {}) => ({ requests, pending: 0, actedOn: requests, confirmed: 0, completed: 0, cancelled: 0, rescheduled: 0, noShows: 0, daysToAction: 1, ...o });
const out = {
  total: [{ _id: "cur", ...c(150, { cancelled: 30, noShows: 30, confirmed: 75, actedOn: 120 }) }, { _id: "prev", ...c(100, { cancelled: 10 }) }],
  rows: [
    { _id: { key: "a", period: "cur" }, name: "Clinic A ", ...c(100, { cancelled: 25, noShows: 30, confirmed: 40, actedOn: 60, daysToAction: 6 }) },
    { _id: { key: "a", period: "prev" }, name: "Clinic A ", ...c(80, { cancelled: 8 }) },
    { _id: { key: "b", period: "cur" }, name: "Clinic B", ...c(40, { noShows: 2, confirmed: 30 }) },
    { _id: { key: "c", period: "cur" }, name: "Clinic C", ...c(30, { confirmed: 25 }) },
    { _id: { key: "d", period: "cur" }, name: "Tiny", ...c(5, { cancelled: 5 }) },
    { _id: { key: "e", period: "prev" }, name: "Dormant", ...c(20) },
  ],
};
const r = kpiReport(out, { from: "2026-10-01", to: "2026-10-29", by: "office", min: 20, prev: { from: "2026-09-02", to: "2026-09-30" } });
assert.equal(r.total.Requests, 150);
assert.equal(r.total["Requests change %"], 50);
assert.equal(r.total["Cancellation %"], 20);
assert.equal(r.total["Cancellation % change"], 10);
assert.deepEqual(r.rows.map((x) => x.Name), ["Clinic A", "Clinic B", "Clinic C", "Tiny", "Dormant"]); // ranked rows first, by Requests
const a = r.rows[0];
assert.equal(a.id, "a");
assert.equal(a["Share of requests %"], 66.7); // 100 of 150
assert.equal(a["No-show %"], 30);
assert.equal(r.median["No-show %"], 5); // median of 30, 5, 0
assert.equal(a.Flags, "Cancellation high; Acted-on low; Median days to first action slow; No-show above median; Scheduling below median");
assert.equal(r.rows[1].Flags, "ok");
assert.equal(r.rows[3].Flags, "fewer than 20 referrals"); // 100% cancelled, but too few to flag
assert.equal(r.rows[4].Requests, 0); // stopped referring: still listed, with the previous count
assert.equal(r.rows[4]["Previous requests"], 20);
assert.equal(kpiReport(out, { from: "x", to: "y", by: "office", min: 20, prev: null, sort: "No-show %", ascending: true }).rows[0].Name, "Clinic C");
assert.deepEqual(kpiReport(out, { from: "x", to: "y", by: "office", min: 20, prev: null, match: "clinic b" }).rows.map((x) => x.Name), ["Clinic B"]);

console.log("kpis ok: argument checks, comparison periods, rates, changes, median, flags, sorting, name match");
