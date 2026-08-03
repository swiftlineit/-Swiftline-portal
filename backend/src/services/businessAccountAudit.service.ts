/**
 * Audit trail for business account creation and amendment.
 *
 * The log records what changed, not the data itself. Identity numbers are noted
 * as "[changed]" without their values: an audit trail that copies every Aadhaar,
 * PAN, GSTIN and SSN into a second, longer-lived collection is a bigger
 * liability than the gap it closes.
 */
import mongoose from "mongoose";
import { AuditLog, type AuditAction } from "../models/auditLog.model.js";
import type { IBusinessAccount } from "../models/businessAccount.model.js";

export type FieldChange = { from: unknown; to: unknown };

// Values never written to the log, only ever flagged as changed.
const redactedPaths = new Set([
  "company.registrationId",
  "company.registrationIdEncrypted",
  "company.gstin",
  "contact.mobileNumber"
]);

const REDACTED = "[changed]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Flattens two snapshots into the set of leaf paths whose values differ.
 *
 * Arrays are compared whole rather than per index: "operatingCountries changed
 * from [India] to [India, Nepal]" is what a reviewer wants, not three entries
 * about shifting positions.
 */
export function diffSnapshots(
  before: unknown,
  after: unknown,
  path = "",
  changes: Record<string, FieldChange> = {}
): Record<string, FieldChange> {
  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      diffSnapshots(before[key], after[key], path ? `${path}.${key}` : key, changes);
    }

    return changes;
  }

  const normalize = (value: unknown) => value instanceof Date ? value.toISOString() : value;
  const from = normalize(before);
  const to = normalize(after);

  if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) return changes;

  changes[path] = redactedPaths.has(path)
    ? { from: REDACTED, to: REDACTED }
    : { from: from ?? null, to: to ?? null };

  return changes;
}

// The parts of an account worth diffing. Everything else (timestamps, KYC
// review state, derived status) has its own audit action already.
export function toAuditSnapshot(account: Pick<IBusinessAccount, "contact" | "company">) {
  return JSON.parse(JSON.stringify({ contact: account.contact, company: account.company })) as Record<string, unknown>;
}

export async function recordBusinessAccountAudit(
  action: AuditAction,
  account: Pick<IBusinessAccount, "_id" | "accountId" | "status">,
  userId: mongoose.Types.ObjectId,
  changes?: Record<string, FieldChange>
) {
  try {
    await AuditLog.create({
      action,
      entityType: "BUSINESS_ACCOUNT",
      entityId: account._id,
      performedBy: userId,
      performedAt: new Date(),
      metadata: {
        accountId: account.accountId,
        status: account.status,
        ...(changes && Object.keys(changes).length ? { changes } : {})
      }
    });
  } catch (error) {
    // An audit write must never fail the operation it is recording; the account
    // save has already happened by this point.
    console.error("Business account audit log write failed:", error);
  }
}
