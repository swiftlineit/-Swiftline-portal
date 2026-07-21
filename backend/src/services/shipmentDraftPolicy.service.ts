import mongoose from "mongoose";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import {
  ShipmentDraft,
  type IShipmentDraft,
  type ShipmentDraftBookingState
} from "../models/shipmentDraft.model.js";

const clientShipmentEditorRoles = new Set(["account_owner", "account_admin", "operations"]);
export class ShipmentDraftPolicyError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "ShipmentDraftPolicyError";
  }
}

export async function resolveDraftBookingState(
  draft: Pick<IShipmentDraft, "_id" | "bookingState">
): Promise<ShipmentDraftBookingState> {
  if (draft.bookingState && draft.bookingState !== "EDITABLE") return draft.bookingState;

  // Legacy development records predate bookingState. Carrier state remains the
  // authoritative fallback so old booked drafts become read-only immediately.
  const carrierBooking = await DpdShipment.findOne({ shipmentDraftId: draft._id })
    .select("status")
    .lean()
    .exec();

  if (!carrierBooking || carrierBooking.status === "DPD_REJECTED") return "EDITABLE";
  if (["DPD_STATUS_UNKNOWN", "DPD_CREATED"].includes(carrierBooking.status)) return "REVIEW_REQUIRED";
  if (carrierBooking.status === "DPD_CREATING") return "BOOKING";
  return carrierBooking.status === "LABEL_RECEIVED" ? "BOOKED" : "EDITABLE";
}

function getBookingStateMessage(bookingState: ShipmentDraftBookingState) {
  if (bookingState === "BOOKING") {
    return "This shipment is currently being booked. Wait for the booking result before trying again.";
  }
  if (bookingState === "REVIEW_REQUIRED") {
    return "This shipment is awaiting booking reconciliation and cannot be edited. Contact Swiftline Operations.";
  }
  return "This shipment has already been booked. Submit an amendment to request changes.";
}

export async function assertShipmentDraftEditable(draft: IShipmentDraft) {
  const bookingState = await resolveDraftBookingState(draft);
  if (bookingState === "EDITABLE") return;

  throw new ShipmentDraftPolicyError(getBookingStateMessage(bookingState), 409);
}

export async function beginShipmentDraftBooking(input: {
  draft: IShipmentDraft;
  bookingAttemptId: string;
}) {
  const currentState = await resolveDraftBookingState(input.draft);
  if (currentState !== "EDITABLE") {
    throw new ShipmentDraftPolicyError(getBookingStateMessage(currentState), 409);
  }

  const lockedDraft = await ShipmentDraft.findOneAndUpdate(
    { _id: input.draft._id, bookingState: "EDITABLE", updatedAt: input.draft.updatedAt },
    {
      $set: {
        bookingState: "BOOKING",
        bookingAttemptId: input.bookingAttemptId,
        lockedAt: new Date()
      }
    },
    { returnDocument: "after", runValidators: true }
  ).exec();

  if (lockedDraft) return lockedDraft;

  const concurrentDraft = await ShipmentDraft.findById(input.draft._id).exec();
  const concurrentState = concurrentDraft
    ? await resolveDraftBookingState(concurrentDraft)
    : "REVIEW_REQUIRED";
  if (concurrentState === "EDITABLE") {
    throw new ShipmentDraftPolicyError(
      "Shipment details changed while booking started. Review the latest values and try again.",
      409
    );
  }
  throw new ShipmentDraftPolicyError(getBookingStateMessage(concurrentState), 409);
}

export async function transitionShipmentDraftBooking(input: {
  shipmentDraftId: mongoose.Types.ObjectId;
  bookingAttemptId: string;
  bookingState: ShipmentDraftBookingState;
}) {
  const update = input.bookingState === "EDITABLE"
    ? {
      $set: { bookingState: "EDITABLE", bookingAttemptId: "", lockedAt: null }
    }
    : {
      $set: { bookingState: input.bookingState }
    };

  return ShipmentDraft.findOneAndUpdate(
    { _id: input.shipmentDraftId, bookingAttemptId: input.bookingAttemptId },
    update,
    { returnDocument: "after", runValidators: true }
  ).exec();
}

export async function clientCanAccessShipmentDraft(input: {
  userId: string | mongoose.Types.ObjectId;
  draft: Pick<IShipmentDraft, "businessAccountId" | "branchId">;
  requireEditPermission?: boolean;
}) {
  const membership = await BusinessAccountMember.findOne({
    user: input.userId,
    businessAccount: input.draft.businessAccountId,
    status: "active"
  })
    .select("role assignedBranches")
    .lean()
    .exec();
  if (!membership) return false;
  if (input.requireEditPermission && !clientShipmentEditorRoles.has(membership.role)) return false;

  const explicitBranchIds = membership.assignedBranches.map(String);
  if (explicitBranchIds.length) return explicitBranchIds.includes(String(input.draft.branchId));

  const account = await BusinessAccount.findById(input.draft.businessAccountId)
    .select("assignedBranch")
    .lean()
    .exec();
  return Boolean(account?.assignedBranch && String(account.assignedBranch) === String(input.draft.branchId));
}

export async function assertShipmentDraftMutationAllowed(input: {
  draft: IShipmentDraft;
  userId: string | mongoose.Types.ObjectId;
  portalRole: string;
}) {
  if (input.portalRole !== "admin") {
    const allowed = input.portalRole === "client" && await clientCanAccessShipmentDraft({
      userId: input.userId,
      draft: input.draft,
      requireEditPermission: true
    });
    if (!allowed) {
      throw new ShipmentDraftPolicyError("You do not have permission to modify this shipment draft.", 403);
    }
  }

  await assertShipmentDraftEditable(input.draft);
}

export async function syncLegacyDraftBookingState(draft: IShipmentDraft) {
  const bookingState = await resolveDraftBookingState(draft);
  if (draft.bookingState === bookingState) return bookingState;

  draft.bookingState = bookingState;
  if (bookingState !== "EDITABLE" && !draft.lockedAt) draft.lockedAt = draft.updatedAt ?? new Date();
  await draft.save();
  return bookingState;
}

export async function findEditableDraftByInvoiceUpload(invoiceUploadId: mongoose.Types.ObjectId) {
  const draft = await ShipmentDraft.findOne({ invoiceUploadId }).exec();
  if (!draft) return null;
  return await resolveDraftBookingState(draft) === "EDITABLE" ? draft : null;
}
