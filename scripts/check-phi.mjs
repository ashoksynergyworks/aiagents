// Leak test on a real database: attack pipelines, scoped by the guard, must not return patient data. Run: npm run test:phi
import assert from "node:assert/strict";
import { BSON, MongoClient } from "mongodb";
import { CANCEL_REASONS, parsePipeline } from "../app/api/chat/guard.ts";

const client = new MongoClient(process.env.MONGODB_URI || "mongodb://localhost:27017/df-dev", { serverSelectionTimeoutMS: 8000 });
const db = client.db("df-dev");
const NAMES = "patientAddress|appointmentComments|appointmentNotes|reasonToCancel|referralAttachments|providerNotes|insuranceCard|policyNumber|medicalCondition|lastMetalImplantDate|bookedByIp|patientVideoLink|requestDescription|requestStatusHistory|referralPhysicianName|email|contact|dob|address|patient_ref_id|password|patientName|mobile|callerNumber|doctorName|smsBody|faxFileUrl|internalNotes|leadHistory|sendToken|chatRoomId";
// Hidden only in that collection (staff first names are fine in users, patientId in appointments)
const MORE = { loginlogs: "|ip", requesteddocuments: "|firstName|lastName|notes|Notes", appointmentfeedbacks: "|patientId|message|anonymous", patientanalytics: "|patientId", bookappointmentsms: "", examprepsms: "|token", efaxleads: "" };
// field names as keys, or as "k" values when $objectToArray turns them into data (staff named "Contact" are fine)
const hidden = (more = "") => new RegExp(`"(${NAMES}${more})":|"k":"(${NAMES}${more})"`);
const FILE = /\.(pdf|png|jpe?g|docx?)\b/i;

const attacks = [
  ["appointments", [{ $replaceWith: "$$ROOT" }]],
  ["appointments", [{ $project: { kv: { $objectToArray: "$$ROOT" } } }]],
  ["appointments", [{ $project: { x: { $getField: { $concat: ["patient", "Address"] } } } }, { $match: { x: { $ne: null } } }]],
  ["appointments", [{ $limit: 500 }, { $lookup: { from: "users", localField: "createdBy", foreignField: "_id", as: "u" } }, { $unwind: "$u" }, { $replaceWith: "$u" }]],
  ["appointments", [{ $facet: { a: [{ $limit: 200 }, { $lookup: { from: "appointments", localField: "_id", foreignField: "_id", as: "x" } }] } }]],
  ["appointments", [{ $unwind: "$appointmentHistory" }, { $replaceWith: "$appointmentHistory" }]],
  ["users", [{ $replaceWith: "$$ROOT" }]],
  ["pcps", [{ $unionWith: { coll: "users", pipeline: [{ $match: { patient_ref_id: { $ne: null } } }] } }, { $match: { pcpName: { $exists: false } } }]],
  ["appointments", [{ $lookup: { from: "efaxleads", localField: "_id", foreignField: "appointmentId", as: "l" } }, { $unwind: "$l" }, { $replaceWith: "$l" }]],
  ...Object.keys(MORE).flatMap((c) => [[c, [{ $replaceWith: "$$ROOT" }]], [c, [{ $project: { kv: { $objectToArray: "$$ROOT" } } }]]]),
];

try {
  const patientLogins = (await db.collection("users").distinct("_id", { $or: [{ patient_ref_id: { $ne: null } }, { role: "patient" }] })).map(String);
  assert.ok(patientLogins.length, "df-dev should have patient logins to test against");
  for (const [coll, p] of attacks) {
    let rows;
    try {
      rows = await db.collection(coll).aggregate([...parsePipeline(coll, p), { $limit: 5000 }]).toArray();
    } catch (e) {
      if (e instanceof assert.AssertionError) throw e;
      continue; // the server or guard refusing a pipeline is also a pass
    }
    const s = BSON.EJSON.stringify(rows);
    const HIDDEN = hidden(MORE[coll]);
    assert.ok(!HIDDEN.test(s), `${coll} ${JSON.stringify(p)} leaked ${s.match(HIDDEN)?.slice(1).find(Boolean)}`);
    assert.ok(!FILE.test(s), `${coll} ${JSON.stringify(p)} leaked a file name`);
    assert.ok(!patientLogins.some((id) => s.includes(id)), `${coll} ${JSON.stringify(p)} leaked a patient login`);
  }
  const reasons = await db.collection("appointments").aggregate(parsePipeline("appointments", [{ $group: { _id: "$cancelReason" } }])).toArray();
  for (const { _id } of reasons) assert.ok(_id === null || _id === "Others" || CANCEL_REASONS.includes(_id), `cancelReason leaked free text`);
  const staff = await db.collection("users").countDocuments();
  const visible = (await db.collection("users").aggregate(parsePipeline("users", [{ $count: "n" }])).toArray())[0].n;
  console.log(`phi ok: ${attacks.length} attacks, ${patientLogins.length} patient logins hidden (${visible} of ${staff} users visible), cancel reasons ${reasons.map((r) => r._id ?? "none").join(" / ")}`);
} finally {
  await client.close();
}
