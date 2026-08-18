/**
 * What has happened on this account, in the customer's own words.
 *
 * Built from the audit log, which records far more than a customer should
 * read: carrier request failures, address validation calls, manifest scan
 * internals. Those are Swiftline's diagnostics. This exposes a curated set of
 * actions that mean something to the person paying the invoice, and nothing
 * else- an allowlist rather than a denylist, so a new internal action added
 * later cannot leak into a customer's view by default.
 *
 * Scoping is by entity, not by actor. A feed of "things my team did" would
 * miss the entry the brief actually asks for- Operations updating a shipment
 *- because that row is performed by Swiftline staff against the customer's
 * shipment. The audit log carries no business account, so the account's own
 * entity ids are gathered first and the log is asked about those.
 */
import mongoose from "mongoose";
import { AuditLog, type AuditAction } from "../models/auditLog.model.js";
import { Claim } from "../models/claim.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { PickupRequest } from "../models/pickupRequest.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { SupportTicket } from "../models/supportTicket.model.js";
import { User } from "../models/user.model.js";

/**
 * Actions a customer may see, and how each reads.
 *
 * Phrased as the completed event rather than the enum. "Shipment created" is
 * what happened; SHIPMENT_DRAFT_CREATED is how it is stored.
 */
const clientVisibleActions = {
  SHIPMENT_DRAFT_CREATED: "created shipment",
  SHIPMENT_IMPORT_DRAFTS_CREATED: "imported shipments",
  SHIPMENT_KYC_DOCUMENT_UPLOADED: "uploaded KYC documents for shipment",
  SHIPMENT_HELD: "put shipment on hold",
  SHIPMENT_RELEASED: "released shipment from hold",
  SHIPMENT_STATUS_UPDATED: "updated shipment",
  SHIPMENT_AMENDMENT_REQUESTED: "requested an amendment to shipment",
  SHIPMENT_AMENDMENT_APPLIED: "applied an amendment to shipment",
  SHIPMENT_AMENDMENT_REJECTED: "rejected an amendment to shipment",
  SHIPMENT_CANCELLATION_REQUESTED: "requested cancellation of shipment",
  SHIPMENT_CANCELLATION_COMPLETED: "cancelled shipment",
  SHIPMENT_CANCELLATION_REJECTED: "declined cancellation of shipment",
  SHIPMENT_INVOICE_GENERATED: "generated the invoice for shipment",
  SHIPMENT_INVOICE_DOWNLOADED: "downloaded the invoice for shipment",
  CUSTOMS_INVOICE_DOWNLOADED: "downloaded the customs invoice for shipment",
  SHIPMENT_MANIFEST_GENERATED: "generated a manifest",
  SHIPMENT_MANIFEST_DOWNLOADED: "downloaded a manifest",
  LABEL_DOWNLOADED: "downloaded a label",
  CLAIM_CREATED: "started claim",
  CLAIM_SUBMITTED: "submitted claim",
  CLAIM_WITHDRAWN: "withdrew claim",
  CLAIM_DOCUMENT_UPLOADED: "uploaded a claim document",
  CLAIM_DECISION_ISSUED: "issued a decision on claim",
  CLAIM_SETTLEMENT_ACCEPTED: "accepted the settlement for claim",
  CLAIM_PAYMENT_RECORDED: "recorded a claim payment",
  CLAIM_CLOSED: "closed claim",
  SUPPORT_TICKET_CREATED: "raised support ticket",
  SUPPORT_TICKET_REPLIED: "replied to support ticket",
  SUPPORT_TICKET_UPDATED: "updated support ticket",
  PICKUP_REQUEST_CREATED: "requested a pickup",
  PICKUP_REQUEST_UPDATED: "updated a pickup",
  PICKUP_COMPLETED: "completed a pickup",
  POD_DISPUTED: "reported an issue with a proof of delivery",
  CREDIT_PAYMENT_SUBMITTED: "submitted a payment",
  CREDIT_PAYMENT_VERIFIED: "verified a payment",
  SECURITY_DEPOSIT_RECEIVED: "recorded a security deposit",
  CREDIT_BILLING_STATEMENT_ISSUED: "issued a billing statement",
  CREDIT_BILLING_STATEMENT_DOWNLOADED: "downloaded a billing statement",
  CREDIT_LIMIT_UPDATED: "updated the credit limit",
  ADDRESS_BOOK_ENTRY_CREATED: "added an address",
  ADDRESS_BOOK_ENTRY_UPDATED: "updated an address",
  ADDRESS_BOOK_ENTRY_DELETED: "deleted an address",
  ADDRESS_BOOK_ENTRIES_IMPORTED: "imported addresses",
  BUSINESS_ACCOUNT_PROFILE_UPDATED: "updated the account profile"
} satisfies Partial<Record<AuditAction, string>>;

/** Typed so the query keeps the enum rather than widening to string. */
const clientVisibleActionKeys = Object.keys(clientVisibleActions) as AuditAction[];

export type ClientActivityEntry = {
  id: string;
  action: string;
  /** "created shipment", already phrased for a reader. */
  description: string;
  /** The AWB, claim number or ticket number the action was about. */
  reference: string;
  actorName: string;
  /** Whether it was somebody on the account or Swiftline. */
  actorSide: "ACCOUNT" | "SWIFTLINE";
  performedAt: Date;
};

export async function listClientActivity(input: {
  businessAccountId: mongoose.Types.ObjectId;
  branchIds?: mongoose.Types.ObjectId[];
  limit: number;
}): Promise<ClientActivityEntry[]> {
  const scope = {
    businessAccountId: input.businessAccountId,
    ...(input.branchIds?.length ? { branchId: { $in: input.branchIds } } : {})
  };

  // Ids first, because the audit log has no account of its own to filter on.
  const [drafts, claims, tickets, pickups] = await Promise.all([
    ShipmentDraft.find(scope).select("_id").limit(2000).lean().exec(),
    Claim.find({ businessAccountId: input.businessAccountId }).select("_id claimNumber").lean().exec(),
    SupportTicket.find({ businessAccountId: input.businessAccountId }).select("_id ticketNumber").lean().exec(),
    PickupRequest.find(scope).select("_id requestNumber").lean().exec()
  ]);

  const draftIds = drafts.map((draft) => draft._id);
  const entityIds = [
    ...draftIds,
    ...claims.map((claim) => claim._id),
    ...tickets.map((ticket) => ticket._id),
    ...pickups.map((pickup) => pickup._id),
    input.businessAccountId
  ];
  if (!entityIds.length) return [];

  const entries = await AuditLog.find({
    entityId: { $in: entityIds },
    action: { $in: clientVisibleActionKeys }
  })
    .sort({ performedAt: -1 })
    .limit(input.limit)
    .lean()
    .exec();
  if (!entries.length) return [];

  // References resolved in bulk: a feed that looked each one up per row would
  // issue a query per line to print a tracking number.
  const [bookings, actors] = await Promise.all([
    DpdShipment.find({ shipmentDraftId: { $in: draftIds } })
      .select("shipmentDraftId swiftlineTrackingNumber")
      .lean()
      .exec(),
    User.find({ _id: { $in: entries.map((entry) => entry.performedBy) } })
      .select("firstName lastName name email role")
      .lean()
      .exec()
  ]);

  const awbByDraft = new Map(bookings.map((booking) => [String(booking.shipmentDraftId), booking.swiftlineTrackingNumber ?? ""]));
  const claimNumberById = new Map(claims.map((claim) => [String(claim._id), claim.claimNumber ?? ""]));
  const ticketNumberById = new Map(tickets.map((ticket) => [String(ticket._id), ticket.ticketNumber]));
  const pickupNumberById = new Map(pickups.map((pickup) => [String(pickup._id), pickup.requestNumber]));
  const actorById = new Map(actors.map((actor) => [String(actor._id), actor]));

  return entries.map((entry) => {
    const entityId = String(entry.entityId);
    const actor = actorById.get(String(entry.performedBy));
    const isStaff = Boolean(actor && actor.role !== "client");
    const properName = actor
      ? [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.name || ""
      : "";
    /**
     * A named person where one is recorded, otherwise the team.
     *
     * Staff never fall back to an email address. A customer has no business
     * with Swiftline's internal addresses, and a feed reading
     * "someone@swiftline.com updated your shipment" is both a small leak and
     * worse to read than "Swiftline Operations".
     */
    const actorName = properName || (isStaff ? "Swiftline Operations" : actor?.email || "Account user");

    return {
      id: String(entry._id),
      action: entry.action,
      description: (clientVisibleActions as Record<string, string>)[entry.action] ?? entry.action.replaceAll("_", " ").toLowerCase(),
      reference: awbByDraft.get(entityId)
        || claimNumberById.get(entityId)
        || ticketNumberById.get(entityId)
        || pickupNumberById.get(entityId)
        || "",
      actorName,
      // Staff and customer actions read differently, so the feed says which.
      actorSide: actor && actor.role !== "client" ? "SWIFTLINE" : "ACCOUNT",
      performedAt: entry.performedAt
    };
  });
}
