import type { Request, Response } from "express";
import mongoose from "mongoose";
import { CounterPayment } from "../models/counterPayment.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { operationsBranchIds } from "../middleware/operationsBranchAccess.middleware.js";

/**
 * Counter sales: what each branch took from, and paid back to, walk-in customers.
 *
 * Deliberately not part of the credit ledger. Individual shipments are settled in
 * full before booking and never touch a credit account, so their money lives in
 * `CounterPayment` and is reported here instead — keeping the credit ledger's
 * balances meaning exactly what they meant before individual shipments existed.
 */
export async function listCounterSales(request: Request, response: Response): Promise<Response> {
  const filters: Record<string, unknown> = {};

  // Operations sees its own branches; admin sees everything.
  const allowedBranchIds = operationsBranchIds(request);
  if (allowedBranchIds !== null) {
    filters.branchId = {
      $in: allowedBranchIds
        .filter((branchId) => mongoose.Types.ObjectId.isValid(branchId))
        .map((branchId) => new mongoose.Types.ObjectId(branchId))
    };
  }

  const requestedBranch = typeof request.query.branchId === "string" ? request.query.branchId : "";
  if (mongoose.Types.ObjectId.isValid(requestedBranch)) {
    const requested = new mongoose.Types.ObjectId(requestedBranch);
    // Narrowing an already-scoped list must never widen it.
    if (allowedBranchIds !== null && !allowedBranchIds.includes(requestedBranch)) {
      return response.status(403).json({ success: false, message: "This branch is not assigned to your login." });
    }
    filters.branchId = requested;
  }

  const from = typeof request.query.from === "string" ? new Date(request.query.from) : null;
  const to = typeof request.query.to === "string" ? new Date(request.query.to) : null;
  const range: Record<string, Date> = {};
  if (from && !Number.isNaN(from.getTime())) range.$gte = from;
  if (to && !Number.isNaN(to.getTime())) range.$lte = to;
  if (Object.keys(range).length) filters.recordedAt = range;

  const direction = typeof request.query.direction === "string" ? request.query.direction : "";
  if (direction === "COLLECTED" || direction === "REFUNDED") filters.direction = direction;

  const payments = await CounterPayment.find(filters)
    .populate("branchId", "name code")
    .populate("recordedBy", "name email")
    .sort({ recordedAt: -1 })
    .limit(500)
    .lean()
    .exec();

  // The customer's name lives on the draft, and the tracking number on the booked
  // shipment; both are looked up in one pass rather than per row.
  const draftIds = payments.map((payment) => payment.shipmentDraftId);
  const [drafts, shipments] = await Promise.all([
    ShipmentDraft.find({ _id: { $in: draftIds } })
      .select("consignorAddress.contactName consignorAddress.mobileNumber")
      .lean()
      .exec(),
    DpdShipment.find({ shipmentDraftId: { $in: draftIds } })
      .select("shipmentDraftId bookingSnapshot.tracking.swiftlineTrackingNumber")
      .lean()
      .exec()
  ]);

  const draftById = new Map(drafts.map((draft) => [String(draft._id), draft]));
  const trackingByDraftId = new Map(shipments.map((shipment) => [
    String(shipment.shipmentDraftId),
    (shipment.bookingSnapshot as { tracking?: { swiftlineTrackingNumber?: string } })?.tracking?.swiftlineTrackingNumber ?? ""
  ]));

  const totals = payments.reduce(
    (running, payment) => {
      if (payment.direction === "COLLECTED") running.collectedMinor += payment.amountMinor;
      else running.refundedMinor += payment.amountMinor;
      return running;
    },
    { collectedMinor: 0, refundedMinor: 0 }
  );

  return response.status(200).json({
    success: true,
    payments: payments.map((payment) => {
      const draft = draftById.get(String(payment.shipmentDraftId));
      const branch = payment.branchId as unknown as { _id: mongoose.Types.ObjectId; name?: string; code?: string } | null;
      const recorder = payment.recordedBy as unknown as { name?: string; email?: string } | null;

      return {
        id: String(payment._id),
        shipmentDraftId: String(payment.shipmentDraftId),
        trackingNumber: trackingByDraftId.get(String(payment.shipmentDraftId)) ?? "",
        customerName: draft?.consignorAddress?.contactName ?? "",
        customerMobile: draft?.consignorAddress?.mobileNumber ?? "",
        branch: branch ? { id: String(branch._id), name: branch.name ?? "", code: branch.code ?? "" } : null,
        direction: payment.direction,
        amountMinor: payment.amountMinor,
        method: payment.method,
        reference: payment.reference,
        note: payment.note,
        recordedBy: recorder?.name || recorder?.email || "",
        recordedAt: payment.recordedAt
      };
    }),
    totals: {
      ...totals,
      netMinor: totals.collectedMinor - totals.refundedMinor
    }
  });
}
