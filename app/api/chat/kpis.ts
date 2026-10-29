import type { Document } from "mongodb";

// Referral KPIs computed in code, so every model reports the same numbers with the definitions in
// docs/df-dev-schema.md ("Metric definitions"). The model picks the arguments and writes the narrative.

const TZ = "America/New_York";
const DAY = 86_400_000;
const ROWS = 25;
export const KPI_BY = ["none", "office", "group", "pcp", "specialty", "channel", "month"] as const;
type By = (typeof KPI_BY)[number];

const has = (f: string) => ({ $ne: [{ $ifNull: [f, null] }, null] });
const is = (...s: string[]) => ({ $in: ["$currentStatus", s] });
const count = (cond: Document) => ({ $sum: { $cond: [cond, 1, 0] } });
const CONFIRMED = { $or: [is("DATE_ADDED", "SCHEDULED", "RESCHEDULED", "COMPLETED", "NOSHOW", "RESCHEDULE_NOSHOW"), { $and: [is("REVIEWED"), has("$appointmentStartDateTime")] }] };
const PENDING = { $or: [is("SUBMITTED", "HOLD", "WORK_IN_PROGRESS"), { $and: [is("REVIEWED"), { $not: [has("$appointmentStartDateTime")] }] }] };
// first office action: the events the backend's average-response job uses, plus review-with-date and tele auto-accept
const ACTIONS = ["Reviewed", "DATE_ADDED", "REVIEWED_AND_DATE_ADDED", "workInProgress", "Canceled", "NoShow", "Complete", "Rescheduled", "AUTO_ACCEPTED"];
// Response time only counts referrals the office received: bookings its own staff created are dated in the same
// minute (114 such in df-dev), which pulled the median to 0. Patient self-bookings still need the office, so they count.
// ponytail: decided by appointment type; compare the creator's org with the office if staff ever book for other offices
const OFFICE_CREATED = { $and: [{ $in: ["$appointmentType", ["SPECIALIST_INITIATED", "REQUEST_DOCUMENT"]] }, { $ne: ["$isPatientSubmittedAppointment", true] }] };

const group = (_id: unknown) => ({
  _id,
  requests: { $sum: 1 },
  pending: count(PENDING),
  actedOn: count({ $ne: ["$currentStatus", "SUBMITTED"] }),
  confirmed: count(CONFIRMED),
  completed: count(is("COMPLETED")),
  cancelled: count(is("CANCELED")),
  rescheduled: count(is("RESCHEDULED")),
  noShows: count(is("NOSHOW", "RESCHEDULE_NOSHOW")),
  // ponytail: $median needs MongoDB 7.0+ (df-dev runs 8.0)
  daysToAction: { $median: { input: "$daysToAction", method: "approximate" } },
});

// per breakdown: stages that set "key", and [collection, name field] when the key is an id to look up
const KEYS: Record<By, [Document[], [string, string]?]> = {
  none: [[{ $set: { key: "All referrals" } }]],
  office: [[{ $set: { key: "$specialistId" } }], ["specialists", "specialistName"]],
  // an office in two groups puts both ids on its appointments, so both groups count them
  group: [[{ $unwind: "$specialistGroupId" }, { $set: { key: "$specialistGroupId" } }], ["specialistgroups", "specialistGroupName"]],
  pcp: [[{ $set: { key: "$pcpId" } }], ["pcps", "pcpName"]],
  month: [[{ $set: { key: { $substrCP: ["$day", 0, 7] } } }]],
  specialty: [[
    { $lookup: { from: "providers", localField: "providerId", foreignField: "_id", pipeline: [{ $project: { specialty: 1 } }], as: "p" } },
    { $unwind: { path: "$p", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$p.specialty", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "specialties", localField: "p.specialty", foreignField: "_id", pipeline: [{ $project: { specialtyName: 1 } }], as: "s" } },
    // free text: "cardiologist", "Cardiologist" and "Cardiologist " are one specialty
    { $set: { key: { $toLower: { $trim: { input: { $ifNull: [{ $first: "$s.specialtyName" }, "no specialty"] } } } } } },
  ]],
  channel: [[
    { $lookup: { from: "defaultappointmenttypes", localField: "appointmentTypeId", foreignField: "_id", pipeline: [{ $project: { appointmentType: 1 } }], as: "t" } },
    { $set: { label: { $ifNull: [{ $first: "$t.appointmentType" }, "$appointmentType"] } } },
    // no eFax branch: eFaxLeadId[] lists faxes sent out for the referral, and referrals created from an eFax lead carry no marker
    { $set: { key: { $switch: { branches: [
      { case: { $eq: ["$isUploadedFromCSV", true] }, then: "CSV import" },
      { case: { $or: [{ $eq: ["$isPatientSubmittedAppointment", true] }, has("$createdByPatient")] }, then: { $concat: ["Patient self-booked: ", "$label"] } },
    ], default: "$label" } } } },
  ]],
};

type Counts = { requests: number; pending: number; actedOn: number; confirmed: number; completed: number; cancelled: number; rescheduled: number; noShows: number; daysToAction: number | null };
const ZERO: Counts = { requests: 0, pending: 0, actedOn: 0, confirmed: 0, completed: 0, cancelled: 0, rescheduled: 0, noShows: 0, daysToAction: null };
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
const pct = (n: number, d: number) => (d ? r1((n / d) * 100) : null);
const RATES = ["Acted-on %", "Scheduling %", "Cancellation %", "Reschedule %", "No-show %", "Typical days to respond"] as const;
type Rate = (typeof RATES)[number];

function metrics(c: Counts) {
  return {
    Requests: c.requests, Pending: c.pending, "Acted on": c.actedOn, Confirmed: c.confirmed, Completed: c.completed, Cancelled: c.cancelled, Rescheduled: c.rescheduled, "No-shows": c.noShows,
    "Acted-on %": pct(c.actedOn, c.requests), "Scheduling %": pct(c.confirmed, c.requests), "Cancellation %": pct(c.cancelled, c.requests),
    "Reschedule %": pct(c.rescheduled, c.requests), "No-show %": pct(c.noShows, c.requests), "Typical days to respond": r1(c.daysToAction),
  };
}
type Metrics = ReturnType<typeof metrics>;

// Office dashboard colours (workflows-officepanel.md WF-18). It has none for no-shows or scheduling, so those
// are flagged against the median of the other rows.
// ponytail: the 5- and 10-point median gaps are a judgement call; tune them if admins find the flags noisy or quiet
function flags(m: Metrics, median: Partial<Record<Rate, number | null>>) {
  const out: string[] = [];
  const v = (k: Rate) => m[k];
  const band = (k: Rate, bad: (x: number) => string | null) => { const x = v(k); const f = x == null ? null : bad(x); if (f) out.push(`${k.replace(" %", "")} ${f}`); };
  band("Cancellation %", (x) => (x > 20 ? "high" : x >= 10 ? "watch" : null));
  band("Reschedule %", (x) => (x > 20 ? "high" : x >= 10 ? "watch" : null));
  band("Acted-on %", (x) => (x < 70 ? "low" : x <= 90 ? "watch" : null));
  band("Typical days to respond", (x) => (x > 5 ? "slow" : x >= 2 ? "watch" : null));
  const md = (k: Rate) => median[k];
  if (v("No-show %") != null && md("No-show %") != null && v("No-show %")! - md("No-show %")! >= 5) out.push("No-shows above the typical office");
  if (v("Scheduling %") != null && md("Scheduling %") != null && md("Scheduling %")! - v("Scheduling %")! >= 10) out.push("Scheduling below the typical office");
  return out.join("; ") || "ok";
}

const median = (xs: number[]) => {
  const s = xs.toSorted((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : r1((s[s.length / 2 - 1] + s[s.length / 2]) / 2)) : null;
};

export type KpiArgs = { from: string; to: string; by?: By; compareFrom?: string; compareTo?: string; minReferrals?: number; match?: string; sort?: string; ascending?: boolean };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

// Validates the model's arguments and returns the pipeline (run on scoped appointments) and the function that turns its output into the report.
export function kpiQuery(raw: unknown) {
  const a = (raw ?? {}) as KpiArgs;
  const by: By = a.by ?? "none";
  if (!DATE.test(a.from) || !DATE.test(a.to) || a.from > a.to) throw new Error('from and to must be "YYYY-MM-DD" with from <= to');
  if (!KPI_BY.includes(by)) throw new Error(`by must be one of: ${KPI_BY.join(", ")}`);
  if ((a.compareFrom || a.compareTo) && !(DATE.test(a.compareFrom ?? "") && DATE.test(a.compareTo ?? "") && a.compareFrom! <= a.compareTo!))
    throw new Error('compareFrom and compareTo must both be "YYYY-MM-DD" with compareFrom <= compareTo');
  const min = Number.isInteger(a.minReferrals) && a.minReferrals! > 0 ? a.minReferrals! : 20;
  const t = (s: string) => Date.parse(`${s}T00:00:00Z`);
  // default comparison: the equal-length period just before; none for a monthly series
  const len = (t(a.to) - t(a.from)) / DAY + 1;
  const prev = by === "month" ? null : a.compareFrom ? { from: a.compareFrom, to: a.compareTo! } : { from: iso(t(a.from) - len * DAY), to: iso(t(a.from) - DAY) };
  const first = prev && prev.from < a.from ? prev.from : a.from;
  const last = prev && prev.to > a.to ? prev.to : a.to;
  const inside = (p: { from: string; to: string }) => ({ $and: [{ $gte: ["$day", p.from] }, { $lte: ["$day", p.to] }] });
  const [keyStages, lookup] = KEYS[by];

  const pipeline = [
    // coarse UTC bounds with a day of slack each side, then the exact New York calendar day
    { $match: { createdAt: { $gte: { $date: new Date(t(first) - DAY).toISOString() }, $lt: { $date: new Date(t(last) + 2 * DAY).toISOString() } }, isDeveloperAppointment: { $ne: true }, currentStatus: { $ne: "MOBILE_UNVERIFIED" } } },
    { $set: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: TZ } } } },
    { $set: { period: { $switch: { branches: [{ case: inside(a), then: "cur" }, ...(prev ? [{ case: inside(prev), then: "prev" }] : [])], default: null } } } },
    { $match: { period: { $ne: null } } },
    { $set: { daysToAction: { $let: {
      vars: { at: { $min: { $map: { input: { $filter: { input: "$appointmentHistory", as: "h", cond: { $gt: [{ $size: { $setIntersection: ["$$h.updatedEntity.entityName", ACTIONS] } }, 0] } } }, as: "h", in: "$$h.updatedAt" } } } },
      in: { $cond: [{ $or: [OFFICE_CREATED, { $eq: [{ $ifNull: ["$$at", null] }, null] }] }, null, { $divide: [{ $subtract: ["$$at", "$createdAt"] }, DAY] }] },
    } } } },
    { $facet: {
      total: [{ $group: group("$period") }],
      rows: [
        ...keyStages,
        { $group: group({ key: "$key", period: "$period" }) },
        ...(lookup
          ? [{ $lookup: { from: lookup[0], localField: "_id.key", foreignField: "_id", pipeline: [{ $project: { _id: 0, n: `$${lookup[1]}` } }], as: "nm" } }, { $set: { name: { $first: "$nm.n" } } }, { $unset: "nm" }]
          : [{ $set: { name: "$_id.key" } }]),
      ],
    } },
  ];
  return { pipeline, finish: (out: Document) => kpiReport(out, { ...a, by, min, prev }) };
}

type Opts = KpiArgs & { by: By; min: number; prev: { from: string; to: string } | null };

export function kpiReport(out: Document, o: Opts) {
  const total = (p: string) => (out.total as Document[]).find((g) => g._id === p) as Counts | undefined;
  type Entry = { name: string; id: unknown; cur?: Counts; prev?: Counts };
  const entries = new Map<string, Entry>();
  for (const g of out.rows as Document[]) {
    const k = String(g._id.key);
    const e: Entry = entries.get(k) ?? { name: String(g.name ?? g._id.key ?? "(none)").trim() || "(none)", id: g._id.key };
    e[g._id.period as "cur" | "prev"] = g as Counts;
    entries.set(k, e);
  }
  const all = [...entries.values()].map((e) => ({ e, m: metrics(e.cur ?? ZERO), p: o.prev ? metrics(e.prev ?? ZERO) : null }));
  const ranked = all.filter((r) => r.m.Requests >= o.min);
  const med = Object.fromEntries(RATES.map((k) => [k, median(ranked.map((r) => r.m[k]).filter((x): x is number => x != null))])) as Record<Rate, number | null>;
  const row = (name: string, id: unknown, m: Metrics, p: Metrics | null, ranks: boolean) => ({
    Name: name,
    ...(KEYS[o.by][1] && id != null && { id: String(id) }), // for follow-up queries on that office, group or PCP
    ...m,
    ...(p && {
      "Previous requests": p.Requests,
      "Requests change %": p.Requests ? r1(((m.Requests - p.Requests) / p.Requests) * 100) : null,
      ...Object.fromEntries(RATES.map((k) => [`${k} change`, m[k] != null && p[k] != null ? r1(m[k]! - p[k]!) : null])),
    }),
    Flags: ranks ? flags(m, med) : `fewer than ${o.min} referrals`,
  });

  const sortKey = (o.sort && o.sort in metrics(ZERO) ? o.sort : "Requests") as keyof Metrics;
  const needle = o.match?.trim().toLowerCase();
  const rows = all
    .filter((r) => !needle || r.e.name.toLowerCase().includes(needle))
    // rows below the minimum go last when ranking by a rate: their rates are noise
    .toSorted((x, y) => Number(y.m.Requests >= o.min) - Number(x.m.Requests >= o.min) || ((Number(y.m[sortKey]) || 0) - (Number(x.m[sortKey]) || 0)) * (o.ascending ? -1 : 1) || y.m.Requests - x.m.Requests);
  const cur = total("cur") ?? ZERO;
  const totalPrev = total("prev");
  return {
    period: `${o.from} to ${o.to}`,
    comparedWith: o.prev ? `${o.prev.from} to ${o.prev.to}` : null,
    by: o.by,
    definitions: `Each referral sent in the period, counted by where it stands today (New York dates); test bookings left out. Rates are % of Requests; "change" is the gap between the two percentages, so write both (e.g. "from 42% to 83%"), in days for days to first action. Days to first action covers referrals the office received, not bookings its own staff created. Flags use the office dashboard thresholds and need ${o.min}+ referrals; the median is over rows with ${o.min}+ referrals.${o.by === "group" ? " Offices in two groups count in both." : o.by === "specialty" ? " Doctors with two specialties count in both." : ""}`,
    total: row("All referrals", null, metrics(cur), o.prev ? metrics(totalPrev ?? ZERO) : null, cur.requests >= o.min),
    ...(o.by !== "none" && {
      median: med,
      rowsShown: `${Math.min(rows.length, ROWS)} of ${rows.length}`,
      // the share is computed here so the model never divides in its head (concentration questions)
      rows: rows.slice(0, ROWS).map((r) => ({ ...row(r.e.name, r.e.id, r.m, r.p, r.m.Requests >= o.min), "Share of requests %": pct(r.m.Requests, cur.requests) })),
    }),
  };
}
