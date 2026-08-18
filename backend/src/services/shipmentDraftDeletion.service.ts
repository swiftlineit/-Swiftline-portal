import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { ShipmentDraft, type IShipmentDraft } from "../models/shipmentDraft.model.js";
import {
  ShipmentDraftPolicyError,
  assertShipmentDraftDeletable,
  canModifyShipmentDraft
} from "./shipmentDraftPolicy.service.js";

/**
 * How long a deleted draft stays restorable from the UI. The undo action on the
 * delete toast is the only route back, so this only has to outlast the toast-
 * it exists to stop a stale tab resurrecting a draft days later.
 */
export const shipmentDraftRestoreWindowMs = 15 * 60 * 1000;

async function writeDeletionAudit(
  action: "SHIPMENT_DRAFT_DELETED" | "SHIPMENT_DRAFT_RESTORED",
  draft: IShipmentDraft,
  userId: mongoose.Types.ObjectId
) {
  await AuditLog.create({
    action,
    entityType: "SHIPMENT_DRAFT",
    entityId: draft._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: {
      businessAccountId: draft.businessAccountId,
      branchId: draft.branchId,
      creationSource: draft.creationSource,
      shipmentImportEntryId: draft.shipmentImportEntryId,
      customerType: draft.customerType,
      consigneeName: draft.consigneeEnteredAddress?.contactName ?? "",
      parcelCount: draft.parcelList?.length ?? 0
    }
  });
}

/**
 * Soft-deletes an unbooked draft.
 *
 * Nothing is destroyed: KYC files, the linked import entry and the audit trail
 * stay put. The draft simply stops being live.
 */
export async function deleteShipmentDraft(input: {
  draft: IShipmentDraft;
  userId: mongoose.Types.ObjectId;
  portalRole: string;
}) {
  await assertShipmentDraftDeletable({
    draft: input.draft,
    userId: input.userId,
    portalRole: input.portalRole
  });

  // Conditional on the draft still being live so two concurrent deletes cannot
  // both report success and write two audit rows.
  const deleted = await ShipmentDraft.findOneAndUpdate(
    { _id: input.draft._id, deletedAt: null },
    { $set: { deletedAt: new Date(), deletedBy: input.userId } },
    { returnDocument: "after" }
  ).exec();

  if (!deleted) {
    throw new ShipmentDraftPolicyError("This shipment draft has already been deleted.", 409);
  }

  await writeDeletionAudit("SHIPMENT_DRAFT_DELETED", deleted, input.userId);
  return deleted;
}

/**
 * Undo for the delete above, backing the toast action.
 *
 * An imported draft cannot be restored if the same import entry already has a
 * newer live draft.
 */
export async function restoreShipmentDraft(input: {
  draftId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  portalRole: string;
}) {
  const draft = await ShipmentDraft.findById(input.draftId).exec();
  if (!draft || !draft.deletedAt) {
    throw new ShipmentDraftPolicyError("Shipment draft not found.", 404);
  }

  // Same rule as every other mutation; only the wording differs, because a
  // restore is refused for reasons a caller reads differently from an edit.
  if (!await canModifyShipmentDraft({ draft, userId: input.userId, portalRole: input.portalRole })) {
    throw new ShipmentDraftPolicyError("You do not have permission to restore this shipment draft.", 403);
  }

  if (Date.now() - draft.deletedAt.getTime() > shipmentDraftRestoreWindowMs) {
    throw new ShipmentDraftPolicyError(
      "This shipment draft can no longer be restored. Start a new draft instead.",
      409
    );
  }

  const replacement = draft.shipmentImportEntryId
    ? await ShipmentDraft.countDocuments({
        shipmentImportEntryId: draft.shipmentImportEntryId,
        deletedAt: null
      }).exec()
    : 0;
  if (replacement) {
    throw new ShipmentDraftPolicyError(
      "This imported row already has a newer shipment draft, so the deleted one cannot be restored.",
      409
    );
  }

  const restored = await ShipmentDraft.findOneAndUpdate(
    { _id: draft._id, deletedAt: { $ne: null } },
    { $set: { deletedAt: null, deletedBy: null } },
    { returnDocument: "after" }
  ).exec();

  if (!restored) {
    throw new ShipmentDraftPolicyError("This shipment draft has already been restored.", 409);
  }

  await writeDeletionAudit("SHIPMENT_DRAFT_RESTORED", restored, input.userId);
  return restored;
}
