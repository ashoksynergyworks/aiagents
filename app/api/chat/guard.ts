import { BSON, type Document } from "mongodb";

export const COLLECTIONS = ["appointments", "users", "pcps", "pcpgroups", "providers", "specialists", "specialistgroups", "specialties", "defaultappointmenttypes"];
export const SECRETS = ["password", "previousPasswords", "otp", "twoFactorAuthCode", "sessionInfo", "socketId", "secureCode"];

// Office portal pick list; any other reason was typed under "Others" and is free text
export const CANCEL_REASONS = ["We do not take the insurance selected", "Patient already had the exam done at other facilities", "Patient requested another provider"];
// Fixed history event names; other entityName values can embed a document's file name, so they read "Other"
const HISTORY_EVENTS = ["Reviewed", "DATE_ADDED", "REVIEWED_AND_DATE_ADDED", "workInProgress", "Canceled", "NoShow", "Complete", "Rescheduled",
  "Rescheduled With speaking with Patient", "Rescheduled - Urgent Request With speaking with Patient", "AUTO_ACCEPTED", "currentStatus",
  "appointmentStatus", "appointmentSubStatus", "OpenRequestInfo", "Responded", "Close", "CALL_ATTEMPT_COUNT", "PATIENT_SPOKEN_EDIT",
  "HIGH_RISK_PATIENT_EDITED", "FAX_SENT_COUNT", "FAX_STATUS_UPDATE", "appointmentCommentsAdded", "appointmentNotesAdded", "referralDocumentUploaded"];

const keep = (fields: string) => Object.fromEntries(fields.split(/\s+/).filter(Boolean).map((f) => [f, 1]));
const list = (v: string) => ({ $cond: [{ $isArray: v }, v, []] });

// Patient data never reaches the model: these stages run before any model-written stage, on the collection and on every
// $lookup / $unionWith source at any depth, so $$ROOT, $objectToArray or $getField only ever see allowlisted fields.
// Hidden: patient names, contact details, addresses, free text, documents, insurance numbers, clinical details, patient logins.
// ponytail: only the two collections that hold patient data are scoped; add a collection here if it ever gains patient fields
const SCOPES: Record<string, Document[]> = {
  appointments: [{ $project: {
    ...keep(`appointmentId patientId pcpId pcpGroupId specialistId specialistGroupId providerId appointmentTypeId insuranceId medicalCenterId
      linkedAppointmentId transactionId bodyPart examType eFaxLeadId createdBy createdByPatient createdBySpecialistId createdBySpecialistGroupId
      originalCreatorId originalCreatorRole lastChangedBy lastChangedByRole lastCanceledBy lastRescheduledBy lastNoShowBy updatedBy
      currentStatus appointmentSubStatus handledStatus appointmentStatusAuthor callOwnership isPatientSpokenTo urgentStatus providerNotesUploadStatus
      appointmentType visitType createdAt updatedAt appointmentDate appointmentStartDateTime appointmentEndDateTime appointmentDuration timeZone
      providerNotesUploadDate lastDocumentDownloadedTime patientLanguageSelected businessName
      isReferralRequired isReferralUploaded isReferralUploadLater isProviderNotesRequired isProviderNotesIncluded isProviderNotesDownloaded
      isInfoRequested isRequestInfoClosed isRequestInfoShownToPCPs isRequestInfoShownToSpecialists isHighRiskPatient isUrgentAppointment
      isImmediateAppointment isNewPatient isFollowUp isTransportation transportationProvideBy isWheelChairRequired isProcedure isPatientSeen
      isPaymentCompleted isRatingGiven isUploadedFromCSV isPatientSubmittedAppointment isMriSaturdayAppointment isMriExpediteAppointment
      isDeveloperAppointment isTeleHealth isTeleAppointment rideProcessed reminderSent isOtherInsurance isDocumentExpired
      price discount followUpCount completedFollowUpCount remainingFollowUpCount faxSentCount smsSentCount callCount patientCallCount
      handledHistory.handledStatus handledHistory.handledBy handledHistory.handledAt
      subStatusForRequestInfo.requestType subStatusForRequestInfo.requestStatus subStatusForRequestInfo.requestedBy subStatusForRequestInfo.requestedAt`),
    cancelReason: { $cond: [{ $in: ["$reasonToCancel", CANCEL_REASONS] }, "$reasonToCancel", { $cond: [{ $gt: ["$reasonToCancel", ""] }, "Others", null] }] },
    appointmentHistory: { $map: { input: list("$appointmentHistory"), as: "h", in: {
      updatedAt: "$$h.updatedAt",
      updatedBy: "$$h.updatedBy",
      updatedEntity: { $map: { input: list("$$h.updatedEntity"), as: "e", in: { entityName: { $cond: [{ $in: ["$$e.entityName", HISTORY_EVENTS] }, "$$e.entityName", "Other"] } } } },
    } } },
  } }],
  users: [
    { $match: { patient_ref_id: null, role: { $ne: "patient" } } }, // staff only: patient logins carry patient_ref_id
    { $project: keep(`fullName firstName lastName role userType uniqueId pcpId pcpGroupId specialistId specialistGroupId specialistsInSpecialistGroupUsers
      pcpsInPcpGroupUsers isDeleted isBlocked blockType isActive isAdminVerified isEmailVerified isTwoFactorAuthEnabled isPasswordSet isTempPassword
      isUnsubscribed lastLoginAt invalidAttempts timeZoneId chatStatus createdAt updatedAt`) },
  ],
};

function scope(collection: unknown, stages: Document[]): Document[] {
  if (typeof collection !== "string" || !COLLECTIONS.includes(collection)) throw new Error(`Lookup into "${JSON.stringify(collection)}" is not allowed`);
  if (!Array.isArray(stages)) throw new Error("pipeline must be an array of stages");
  return [...(SCOPES[collection] ?? []), ...stages.map(scopeStage)];
}

// Stages only nest inside $lookup, $unionWith and $facet, so these three cover every source at any depth.
function scopeStage(stage: Document): Document {
  if ("$graphLookup" in stage) throw new Error("$graphLookup is not available; use $lookup");
  if ("$lookup" in stage) {
    const { from, pipeline = [], ...rest } = stage.$lookup;
    // without "from" the pipeline starts with $documents and reads no collection, but its own lookups still get scoped
    if (from === undefined) return { $lookup: { ...rest, pipeline: (pipeline as Document[]).map(scopeStage) } };
    return { $lookup: { ...rest, from, pipeline: scope(from, pipeline) } };
  }
  if ("$unionWith" in stage) {
    const u = typeof stage.$unionWith === "string" ? { coll: stage.$unionWith } : stage.$unionWith;
    return { $unionWith: { ...u, pipeline: scope(u.coll, u.pipeline ?? []) } };
  }
  if ("$facet" in stage) return { $facet: Object.fromEntries(Object.entries(stage.$facet).map(([k, p]) => [k, (p as Document[]).map(scopeStage)])) };
  return stage;
}

// Pipelines come from the model, which also reads user text and DB records, so treat them as hostile.
// Checks run on the *parsed* pipeline re-serialized: a JSON escape like "$out" can't slip past.
export function parsePipeline(collection: string, pipeline: unknown): Document[] {
  const stages = BSON.EJSON.parse(typeof pipeline === "string" ? pipeline : JSON.stringify(pipeline));
  if (!Array.isArray(stages)) throw new Error("pipeline must be an array of stages");
  const canon = JSON.stringify(stages);
  // $out/$merge are the only aggregation stages that write; the rest run server-side JS or inspect the server
  if (/"\$(out|merge|where|function|accumulator|currentOp|listSessions)"/.test(canon)) throw new Error("Not allowed: this assistant is read-only");
  if (/"db"\s*:/.test(canon)) throw new Error("Cross-database lookups are not allowed");
  return scope(collection, stages);
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
