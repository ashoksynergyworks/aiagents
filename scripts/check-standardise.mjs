import assert from "node:assert/strict";
const { standardise, toNumber, toDate, slug } = await import("../app/workspaces/standardise.ts");

// the hard sheet from the model test (docs/workspaces-plan.md 3.12): two-row header, subtotal, footnote, codes
const visits = [
  ["Q1 2026 Patient Visits by Office", "", "", "", "", "", "", ""],
  ["", "Office", "", "Visit", "", "", "", ""],
  ["Visit ID", "Name", "Zip", "Date", "Fee", "Phone", "Insured", "Status"],
  ["V-01", "North Clinic", "02134", "01/13/2026", "120", "(617) 555-0101", "TRUE", "Completed"],
  ["V-02", "North Clinic", "02134", "02/03/2026", "95.5", "(617) 555-0101", "FALSE", "No show"],
  ["V-03", "Bay Office", "00501", "02/27/2026", "210", "631-555-0199", "TRUE", "Completed"],
  ["Subtotal Jan-Feb", "", "", "", "425.5", "", "", ""],
  ["V-04", "Bay Office", "00501", "03/04/2026", "", "631-555-0199", "TRUE", "Cancelled"],
  ["V-05", "West Side", "90210", "03/15/2026", "180", "310-555-0142", "FALSE", "Completed"],
  ["V-05", "West Side", "90210", "03/15/2026", "180", "310-555-0142", "FALSE", "Completed"], // duplicate
  ["* Fees exclude tax. Source: billing export.", "", "", "", "", "", "", ""],
];
// the plan nemotron-3.5-bolt-e4b returned for this sheet (indexes shift by 0: no blank rows/cols here)
const aiPlan = {
  headerRow: 2,
  dropRows: [6, 10],
  columns: [
    { index: 0, label: "Visit ID", type: "text" },
    { index: 1, label: "Office name", type: "text" },
    { index: 2, label: "Zip", type: "text" },
    { index: 3, label: "Visit date", type: "date", dateOrder: "MDY" },
    { index: 4, label: "Fee", type: "number", unit: "USD" },
    { index: 5, label: "Phone", type: "text" },
    { index: 6, label: "Insured", type: "boolean" },
    { index: 7, label: "Status", type: "text" },
  ],
};

for (const [name, plan] of [["ai plan", aiPlan], ["rules only", null]]) {
  const r = standardise(visits, plan);
  assert.equal(r.rows.length, 5, name); // 7 data rows - subtotal... (V-01..V-05 + dup) -> 5 unique
  const v1 = r.rows[0];
  const [, , zip, date, fee, phone, insured] = r.columns.map((c) => c.key);
  assert.equal(v1[zip], "02134", `${name}: zip keeps leading zero`);
  assert.equal(v1[date].toISOString(), "2026-01-13T00:00:00.000Z", `${name}: US date`);
  assert.equal(v1[fee], 120, name);
  assert.equal(v1[phone], "(617) 555-0101", `${name}: phone stays text`);
  assert.equal(v1[insured], true, name);
  assert.equal(r.rows[3][fee], null, `${name}: empty fee is null`);
  assert.ok(r.changes.some((c) => c.startsWith("Removed 1 duplicate")), name);
  assert.ok(r.changes.some((c) => c.startsWith("Removed 2 total")), `${name}: subtotal + footnote: ${r.changes}`);
}
assert.equal(standardise(visits, aiPlan).columns[1].label, "Office name");

// the easy sheet: title rows, $ and %, N/A, day-first dates, TOTAL row; blank column C is dropped
const orders = [
  ["ACME Order Report", null, null, null, null],
  ["Ord #", "Ord Dt", null, " Amt ($) ", "Paid?"],
  ["A-1", "13/01/2026", null, "$1,200.50", "Y"],
  ["A-2", "02/01/2026", null, "N/A", "n"],
  ["A-3", "25/01/2026", null, "(40)", "Yes"],
  ["TOTAL", null, null, "$1,160.50", null],
];
const o = standardise(orders, null);
assert.deepEqual(o.columns.map((c) => [c.key, c.type]), [["ord", "text"], ["ord_dt", "date"], ["amt", "number"], ["paid", "boolean"]]);
assert.equal(o.rows.length, 3);
assert.equal(o.rows[1].ord_dt.toISOString().slice(0, 10), "2026-01-02", "DMY inferred from 13/01 and 25/01");
assert.deepEqual(o.rows.map((r) => r.amt), [1200.5, null, -40]);
assert.ok(o.changes.includes("Skipped 1 row above the column names"));

// a wrong plan can't corrupt data: "number" for a text column falls back to text
const bad = standardise(orders, { headerRow: 1, columns: [{ index: 0, label: "Order", type: "number" }] });
assert.equal(bad.columns[0].type, "text");
assert.equal(bad.rows[0].order, "A-1");
// keys come from code: no $ or . even when the plan's label has them
const evil = standardise(orders, { headerRow: 1, columns: [{ index: 0, label: "$where.x", type: "text" }] });
assert.equal(evil.columns[0].key, "where_x");

// an already clean sheet (native numbers, Dates, booleans) has no changes
const cleanSheet = [["Name", "When", "Amount", "Ok"], ["A", new Date(Date.UTC(2026, 0, 2)), 5, true], ["B", new Date(Date.UTC(2026, 0, 3)), 7, false]];
assert.deepEqual(standardise(cleanSheet, null).changes, []);

assert.equal(toNumber("0.5"), 0.5);
assert.equal(toNumber("007"), undefined);
assert.equal(toNumber("1,2"), undefined);
assert.equal(toDate("31/02/2026", "DMY"), undefined);
assert.equal(toDate(45231, "MDY").toISOString().slice(0, 10), "2023-11-01");
assert.equal(slug("  Amt ($) "), "amt");
assert.throws(() => standardise([], null), /empty/);
console.log("standardise ok: ai plan + rules path, codes, US/EU dates, totals, duplicates, placeholders, bad plan, safe keys, clean file");
