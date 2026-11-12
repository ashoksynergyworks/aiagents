// Turns one sheet (rows of cells) into clean, typed rows. An optional format plan (from the AI, see
// docs/workspaces-plan.md 3.5) says where the header is, which rows to drop and each column's type and name.
// Code checks every value against the plan, so a wrong plan can only make a column text, never corrupt data.
// Pure: no I/O, so scripts/check-standardise.mjs runs it in plain node.

export type Type = "text" | "number" | "date" | "boolean";
export type Order = "DMY" | "MDY" | "YMD";
export type Cell = string | number | boolean | Date | null;
export type PlanColumn = { index: number; label: string; type: Type; dateOrder?: Order; unit?: string; description?: string };
export type Plan = { headerRow: number; dropRows: number[]; columns: PlanColumn[] };
export type Column = { key: string; label: string; source: string; type: Type; unit: string; description: string };
export type Result = { columns: Column[]; rows: Record<string, Cell>[]; changes: string[]; plan: Plan };

export const TYPE_LABEL: Record<Type, string> = { text: "Text", number: "Number", date: "Date", boolean: "Yes/No" };
export const MAX_ROWS = 50_000;
export const MAX_COLS = 200;
const TYPES: Type[] = ["text", "number", "date", "boolean"];
const ORDERS: Order[] = ["DMY", "MDY", "YMD"];
const MIN_SHARE = 0.95; // a typed column needs this share of its non-empty values to convert, otherwise it stays text

const EMPTY = new Set(["", "-", "--", "–", "—", "n/a", "na", "null", "#n/a", "nan"]);
const blank = (v: unknown) => v == null || (typeof v === "string" && !v.trim());
const emptyish = (v: Cell) => v == null || (typeof v === "string" && EMPTY.has(v.trim().toLowerCase()));
const TOTAL = /^\s*(sub\s*-?\s*total|grand\s+total|total)\b/i;

// Drops fully blank rows and columns. The AI sees this grid, so its row and column indexes match.
export function clean(raw: unknown[][]): Cell[][] {
  const rows = raw.map((r) => (Array.isArray(r) ? r : []).map((c): Cell => (c instanceof Date || typeof c === "number" || typeof c === "boolean" ? c : c == null ? null : String(c))));
  let width = 0;
  for (const r of rows) width = Math.max(width, r.length);
  const keep = [...Array(width).keys()].filter((c) => rows.some((r) => !blank(r[c])));
  return rows.map((r) => keep.map((c) => r[c] ?? null)).filter((r) => r.some((c) => !blank(c)));
}

// ---- converters: a value, null for empty, or undefined when the value does not fit the type

export function toNumber(v: Cell): number | null | undefined {
  if (emptyish(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let t = v.trim();
  const neg = /^\(.*\)$/.test(t); // accounting style: (12.50)
  t = t.replace(/^\(|\)$/g, "").replace(/^(usd|eur|gbp|inr|rs\.?)\s*/i, "").replace(/[$€£₹%\s]/g, "");
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return undefined;
  if (/^[-+]?0\d/.test(t)) return undefined; // leading zero: a code (zip, id), not a number
  return neg ? -Number(t) : Number(t);
}

const utc = (y: number, m: number, d: number) => {
  const x = new Date(Date.UTC(y < 100 ? 2000 + y : y, m - 1, d));
  return x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x : undefined; // rejects 31/02
};
const DMY_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T].*)?$/;

export function toDate(v: Cell, order: Order): Date | null | undefined {
  if (emptyish(v)) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  if (typeof v === "number") return v > 0 && v < 2958466 ? new Date(Math.round((v - 25569) * 86_400_000)) : undefined; // Excel serial
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  let m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[ T].*)?$/.exec(t);
  if (m) return utc(+m[1], +m[2], +m[3]);
  m = DMY_RE.exec(t);
  if (m) return order === "DMY" ? utc(+m[3], +m[2], +m[1]) : utc(+m[3], +m[1], +m[2]);
  if (/[a-z]{3}/i.test(t) && /\d/.test(t)) {
    const d = new Date(t); // "Jan 13, 2026", "13 Jan 2026"
    return Number.isNaN(d.getTime()) ? undefined : utc(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return undefined;
}

const TRUE = new Set(["yes", "y", "true", "t"]);
const FALSE = new Set(["no", "n", "false", "f"]);
export function toBoolean(v: Cell): boolean | null | undefined {
  if (emptyish(v)) return null;
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  return TRUE.has(t) ? true : FALSE.has(t) ? false : undefined;
}

const toText = (v: Cell) => (emptyish(v) ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

// Day/month order from values that can be read only one way; undefined when every value fits both
export function inferOrder(values: Cell[]): Order | undefined {
  for (const v of values) {
    const m = typeof v === "string" ? DMY_RE.exec(v.trim()) : null;
    if (m && +m[1] > 12) return "DMY";
    if (m && +m[2] > 12) return "MDY";
  }
}

function convert(v: Cell, type: Type, order: Order) {
  return type === "number" ? toNumber(v) : type === "date" ? toDate(v, order) : type === "boolean" ? toBoolean(v) : toText(v);
}

// ---- the plan without AI: rules only

function ruleType(values: Cell[]): Type {
  const filled = values.filter((v) => !emptyish(v));
  if (!filled.length) return "text";
  const order = inferOrder(filled) ?? "MDY";
  const fits = (t: Type) => filled.filter((v) => convert(v, t, order) !== undefined).length >= filled.length * MIN_SHARE;
  if (filled.every((v) => typeof v !== "number") && fits("boolean")) return "boolean";
  if (fits("number")) return "number";
  if (filled.every((v) => v instanceof Date || typeof v === "string") && fits("date")) return "date";
  return "text";
}

// header (unless given): the first row, among the first 30, with the most text cells
export function rulePlan(grid: Cell[][], header?: number): Plan {
  let headerRow = header ?? 0;
  let best = -1;
  if (header === undefined)
    grid.slice(0, 30).forEach((r, i) => {
      const n = r.filter((c) => typeof c === "string" && c.trim()).length;
      if (n > best) [best, headerRow] = [n, i];
    });
  const width = grid[0]?.length ?? 0;
  const body = grid.slice(headerRow + 1);
  const columns = [...Array(width).keys()].map((index): PlanColumn => {
    const values = body.map((r) => r[index]);
    const type = ruleType(values);
    return { index, label: label(grid[headerRow]?.[index], index), type, ...(type === "date" && { dateOrder: inferOrder(values) ?? "MDY" }) };
  });
  return { headerRow, dropRows: [], columns };
}

const label = (v: Cell | undefined, i: number) => String(v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? "")).replace(/\s+/g, " ").trim().slice(0, 80) || `Column ${i + 1}`;

// Field names are made by code, never taken from the file or the AI: no "$", no ".", unique
export const slug = (s: string, max = 60) =>
  s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max);

function unique(names: string[], sep: string) {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c === 1 ? n : `${n}${sep}${c}`;
  });
}

// Keeps the valid parts of a plan (from the AI, or sent back by the browser) and fills the rest with rules
export function checkPlan(grid: Cell[][], input: unknown): Plan {
  const p = (input && typeof input === "object" ? input : {}) as Partial<Plan>;
  const okHeader = Number.isInteger(p.headerRow) && p.headerRow! >= 0 && p.headerRow! < Math.min(grid.length, 30);
  const rulesAt = rulePlan(grid, okHeader ? p.headerRow : undefined);
  const headerRow = rulesAt.headerRow;
  const byIndex = new Map<number, PlanColumn>();
  for (const c of Array.isArray(p.columns) ? p.columns : []) {
    if (!c || !Number.isInteger(c.index) || byIndex.has(c.index) || !TYPES.includes(c.type)) continue;
    byIndex.set(c.index, c);
  }
  const columns = rulesAt.columns.map((r) => {
    const a = byIndex.get(r.index);
    if (!a) return r;
    return {
      index: r.index,
      label: typeof a.label === "string" && a.label.trim() ? a.label.replace(/\s+/g, " ").trim().slice(0, 80) : r.label,
      type: a.type,
      ...(a.type === "date" && { dateOrder: ORDERS.includes(a.dateOrder!) ? a.dateOrder : "MDY" }),
      unit: typeof a.unit === "string" ? a.unit.slice(0, 20) : "",
      description: typeof a.description === "string" ? a.description.slice(0, 300) : "",
    };
  });
  const dropRows = (Array.isArray(p.dropRows) ? p.dropRows : []).filter((i) => Number.isInteger(i) && i > headerRow && i < grid.length);
  return { headerRow, dropRows: [...new Set(dropRows)], columns };
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const NAMES: Record<Type, string> = { text: "text", number: "numbers", date: "dates", boolean: "yes/no values" };
const ORDER_NAMES: Record<Order, string> = { DMY: "day/month/year", MDY: "month/day/year", YMD: "year/month/day" };

export function standardise(raw: unknown[][], input: unknown): Result {
  const grid = clean(raw);
  if (!grid.length) throw new Error("This sheet is empty.");
  if (grid[0].length > MAX_COLS) throw new Error(`This sheet has ${grid[0].length} columns. The limit is ${MAX_COLS}.`);
  const plan = checkPlan(grid, input);
  const changes: string[] = [];
  const h = plan.headerRow;
  if (h > 0) changes.push(`Skipped ${plural(h, "row")} above the column names`);

  const drop = new Set(plan.dropRows);
  // notes under the table: trailing rows with one filled cell (only when the table is 3+ columns wide)
  const filledCells = (r: Cell[]) => r.filter((c) => !emptyish(c)).length;
  let end = grid.length;
  while (grid[0].length >= 3 && end - 1 > h && filledCells(grid[end - 1]) <= 1) end--;
  for (let i = end; i < grid.length; i++) drop.add(i);
  let dropped = 0;
  const body = grid.slice(h + 1).filter((r, i) => {
    const out = drop.has(h + 1 + i) || TOTAL.test(String(r.find((c) => !blank(c)) ?? "")) || r.every(emptyish);
    if (out) dropped++;
    return !out;
  });
  if (dropped) changes.push(`Removed ${plural(dropped, "total, note or empty row")}`);
  if (body.length > MAX_ROWS) throw new Error(`This sheet has ${body.length.toLocaleString("en-US")} rows. The limit is ${MAX_ROWS.toLocaleString("en-US")}.`);

  const labels = unique(plan.columns.map((c) => c.label), " ");
  const keys = unique(labels.map((l, i) => slug(l) || `column_${i + 1}`), "_");
  let markers = 0;
  const columns: Column[] = [];
  const values: Cell[][] = plan.columns.map((c, ci) => {
    const source = label(grid[h][c.index], c.index);
    const col = { key: keys[ci], label: labels[ci], source, type: c.type, unit: c.unit ?? "", description: c.description ?? "" };
    if (col.label !== source) changes.push(`Renamed “${source}” to “${col.label}”`);
    const cells = body.map((r) => r[c.index]);
    const order = inferOrder(cells) ?? c.dateOrder ?? "MDY";
    let out = cells.map((v) => convert(v, col.type, order));
    const filled = cells.filter((v) => !emptyish(v)).length;
    const bad = out.filter((v) => v === undefined).length;
    if (col.type !== "text" && bad > filled * (1 - MIN_SHARE)) {
      changes.push(`Kept ${col.label} as text: ${plural(bad, "value")} of ${filled.toLocaleString("en-US")} are not ${NAMES[col.type]}`);
      col.type = "text";
      col.unit = "";
      out = cells.map(toText);
    } else if (col.type !== "text") {
      const fromText = cells.filter((v) => typeof v === "string" && !emptyish(v)).length;
      if (fromText) changes.push(`Read ${col.label} as ${NAMES[col.type]}${col.type === "date" ? ` (${ORDER_NAMES[order]})` : ""}${col.unit ? ` in ${col.unit}` : ""}`);
      if (bad) changes.push(`Left ${plural(bad, "value")} in ${col.label} blank: they could not be read as ${NAMES[col.type]}`);
    }
    markers += cells.filter((v) => typeof v === "string" && emptyish(v) && v.trim()).length;
    columns.push(col);
    return out.map((v) => (v === undefined ? null : v));
  });
  if (markers) changes.push(`Changed ${plural(markers, "placeholder")} like “N/A” or “-” to blank`);

  const seen = new Set<string>();
  const rows: Record<string, Cell>[] = [];
  for (let r = 0; r < body.length; r++) {
    const row = Object.fromEntries(columns.map((c, ci) => [c.key, values[ci][r]]));
    const sig = JSON.stringify(row);
    if (seen.has(sig)) continue;
    seen.add(sig);
    rows.push(row);
  }
  if (rows.length < body.length) changes.push(`Removed ${plural(body.length - rows.length, "duplicate row")}`);
  return { columns, rows, changes, plan };
}

// Facts per column for the chat's schema (docs/workspaces-plan.md 3.8)
export function profile(columns: Column[], rows: Record<string, Cell>[]) {
  return columns.map((c) => {
    const vals = rows.map((r) => r[c.key]).filter((v) => v != null);
    const samples = [...new Set(vals.slice(0, 200).map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v))))].slice(0, 3);
    const ordered = c.type === "number" || c.type === "date" ? vals.map((v) => +(v as number | Date)).sort((a, b) => a - b) : [];
    const fmt = (n: number) => (c.type === "date" ? new Date(n).toISOString().slice(0, 10) : n);
    return { ...c, nulls: rows.length - vals.length, samples, ...(ordered.length && { min: fmt(ordered[0]), max: fmt(ordered.at(-1)!) }) };
  });
}
