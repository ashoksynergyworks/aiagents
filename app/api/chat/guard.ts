import { BSON, type Document } from "mongodb";

export const COLLECTIONS = ["appointments", "users", "pcps", "pcpgroups", "providers", "specialists", "specialistgroups"];
export const SECRETS = ["password", "previousPasswords", "otp", "twoFactorAuthCode", "sessionInfo", "socketId", "secureCode"];

// Pipelines come from the model, which also reads user text and DB records, so treat them as hostile.
// Checks run on the *parsed* pipeline re-serialized: a JSON escape like "$out" can't slip past.
export function parsePipeline(pipeline: unknown): Document[] {
  const stages = BSON.EJSON.parse(typeof pipeline === "string" ? pipeline : JSON.stringify(pipeline));
  if (!Array.isArray(stages)) throw new Error("pipeline must be an array of stages");
  const canon = JSON.stringify(stages);
  // $out/$merge are the only aggregation stages that write; the rest run server-side JS or inspect the server
  if (/"\$(out|merge|where|function|accumulator|currentOp|listSessions)"/.test(canon)) throw new Error("Not allowed: this assistant is read-only");
  if (/"db"\s*:/.test(canon)) throw new Error("Cross-database lookups are not allowed");
  for (const [, c] of canon.matchAll(/"(?:from|coll|\$unionWith)"\s*:\s*"([^"]+)"/g))
    if (!COLLECTIONS.includes(c)) throw new Error(`Lookup into "${c}" is not allowed`);
  // ponytail: name denylist; $objectToArray over $$ROOT could still surface a secret, use a view without them if this leaves localhost
  if (new RegExp(`\\b(${SECRETS.join("|")})\\b`).test(canon)) throw new Error("That field is not available");
  return stages;
}

export const strip = (k: string, v: unknown) => (SECRETS.includes(k) ? undefined : v);

function cell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(cell).join("; ");
  const s = typeof v === "string" ? v : (v as { _bsontype?: string })._bsontype === "ObjectId" ? String(v) : BSON.EJSON.stringify(v, strip, undefined, { relaxed: true });
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // DB text must not run as a spreadsheet formula
}

const quote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

const FOLLOW_UPS = /^[\s*_#]*follow\W?up questions[\s*_:]*$/i; // \W: models write "-", " " or a non-breaking hyphen (U+2011)
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

// The reply ends with a "Follow-up questions" label and bullets; they go to the UI as buttons, not text.
// Only the bullets right under the last such label are taken; anything after them stays in the reply.
export function splitFollowUps(text: string): { reply: string; followUps: string[] } {
  const lines = text.split("\n");
  const i = lines.findLastIndex((l) => FOLLOW_UPS.test(l));
  let j = i + 1;
  while (i >= 0 && j < lines.length && (BULLET.test(lines[j]) || !lines[j].trim())) j++;
  const followUps = lines.slice(i + 1, j).map((l) => l.replace(BULLET, "").replaceAll("**", "").trim()).filter(Boolean);
  if (i < 0 || !followUps.length) return { reply: text, followUps: [] };
  return { reply: [...lines.slice(0, i), ...lines.slice(j)].join("\n").trim(), followUps: followUps.slice(0, 4) };
}

// RFC 4180 CSV; columns are the union of top-level keys, so the pipeline's $project decides the layout
export function toCsv(rows: Document[]): string {
  const cols = [...new Set(rows.flatMap(Object.keys))].filter((k) => !SECRETS.includes(k));
  return [cols.map(quote), ...rows.map((r) => cols.map((c) => quote(cell(r[c]))))].map((r) => r.join(",")).join("\r\n");
}
