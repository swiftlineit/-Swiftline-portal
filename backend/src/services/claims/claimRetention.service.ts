import mongoose from "mongoose";
import { AuditLog } from "../../models/auditLog.model.js";
import { Claim } from "../../models/claim.model.js";
import { ClaimDocument } from "../../models/claimDocument.model.js";
import { ClaimEvent } from "../../models/claimEvent.model.js";
import { deleteObject } from "../storage/storage.service.js";

/**
 * Legal hold and the eight-year retention rule.
 *
 * Two separate things that interact: retention says when a claim's evidence may
 * be destroyed, legal hold says it may not be destroyed regardless. Hold always
 * wins — a retention job that could delete something under litigation would be
 * worse than one that never ran.
 */

export class ClaimRetentionError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "ClaimRetentionError";
  }
}

/**
 * Places or lifts a legal hold.
 *
 * Both directions require a reason. Lifting one is the more dangerous action —
 * it re-exposes the claim to deletion — so it is recorded just as carefully as
 * placing it.
 */
export async function setClaimLegalHold(input: {
  claimId: string;
  actorUserId: string;
  hold: boolean;
  reason: string;
}) {
  const claim = await Claim.findById(input.claimId).exec();
  if (!claim) throw new ClaimRetentionError("Claim not found.", 404);

  if (!input.reason.trim()) {
    throw new ClaimRetentionError(
      input.hold ? "Give a reason for the legal hold." : "Give a reason for lifting the hold."
    );
  }
  if (claim.legalHold === input.hold) {
    throw new ClaimRetentionError(
      input.hold ? "This claim is already under legal hold." : "This claim is not under legal hold.",
      409
    );
  }

  claim.legalHold = input.hold;
  claim.legalHoldReason = input.hold ? input.reason : "";
  await claim.save();

  // Documents carry their own flag so the purge can check a single row without
  // loading the claim behind it.
  await ClaimDocument.updateMany({ claimId: claim._id }, { $set: { legalHold: input.hold } });

  await ClaimEvent.create({
    claimId: claim._id,
    type: input.hold ? "LEGAL_HOLD_ADDED" : "LEGAL_HOLD_REMOVED",
    actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
    actorKind: "STAFF",
    // Internal: a client does not need to be told their claim is under
    // litigation hold, and saying so could itself be prejudicial.
    visibility: "INTERNAL",
    reason: input.reason
  });

  await AuditLog.create({
    action: "CLAIM_LEGAL_HOLD_CHANGED",
    entityType: "CLAIM",
    entityId: claim._id,
    performedBy: new mongoose.Types.ObjectId(input.actorUserId),
    performedAt: new Date(),
    metadata: { hold: input.hold, reason: input.reason }
  });

  return claim;
}

export interface PurgeResult {
  examined: number;
  purgedClaims: number;
  purgedDocuments: number;
  skippedUnderHold: number;
}

/**
 * Destroys the stored evidence of claims whose retention period has expired.
 *
 * Deletes the *objects*, not the claim records. The claim, its timeline, and its
 * decisions stay readable forever — what expires is the right to keep loss
 * photographs and bank proofs, not the record that a claim happened. A file row
 * survives with `deletedAt` set so the timeline still references something real.
 *
 * `dryRun` is the default. A job that destroys eight-year-old evidence should
 * not be a single flag away from running by accident.
 */
export async function purgeExpiredClaimDocuments(
  options: { dryRun?: boolean; now?: Date } = {}
): Promise<PurgeResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? true;

  const expired = await Claim.find({
    retainUntil: { $ne: null, $lte: now },
    status: { $in: ["CLOSED", "WITHDRAWN"] }
  })
    .select("_id legalHold claimNumber")
    .lean()
    .exec();

  const result: PurgeResult = {
    examined: expired.length,
    purgedClaims: 0,
    purgedDocuments: 0,
    skippedUnderHold: 0
  };

  for (const claim of expired) {
    // Checked per claim rather than filtered in the query, so the count of what
    // was protected is reportable rather than invisible.
    if (claim.legalHold) {
      result.skippedUnderHold += 1;
      continue;
    }

    const documents = await ClaimDocument.find({ claimId: claim._id, deletedAt: null })
      .select("storageKey legalHold")
      .exec();

    for (const document of documents) {
      if (document.legalHold) {
        result.skippedUnderHold += 1;
        continue;
      }
      if (!dryRun) {
        await deleteObject(document.storageKey);
        document.deletedAt = now;
        await document.save();
      }
      result.purgedDocuments += 1;
    }

    result.purgedClaims += 1;
  }

  return result;
}
