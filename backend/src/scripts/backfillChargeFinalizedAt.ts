// Stamps chargeFinalizedAt on invoices booked before the field existed.
//
// The billing cycle used to decide which shipments belonged on a statement by
// looking for final charge verifications dated inside the period. Verification
// was mandatory, so every credit shipment had one. It is now an optional
// correction, and the signal moved to ShipmentInvoice.chargeFinalizedAt- set
// when the parcel is collected, when the hub receives it, or when its weight is
// corrected, whichever comes first.
//
// Invoices that already reached a statement need nothing: they carry a
// billingStatementId and the cycle skips them. What matters here is the unbilled
// backlog, which has no stamp and would otherwise never be billed at all.
//
// Every stamp is written as the run date rather than the shipment's real
// scan-in date. A historical date would land these invoices in billing periods
// that are already closed, and closeCreditBillingCycle refuses to write a second
// statement for a period it has already issued- so they would be skipped
// forever, which is the exact failure this field exists to prevent. Dating them
// to now puts them on the next statement.
//
// Dry run by default; pass --apply to write. Safe to re-run: an invoice that
// already carries a stamp is never re-dated.
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ShipmentChargeVerification } from "../models/shipmentChargeVerification.model.js";
import { ShipmentEvent } from "../models/shipmentEvent.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { chargeFinalizingStatuses } from "../services/shipmentInvoice.service.js";

const apply = process.argv.includes("--apply");

function formatMinor(amountMinor: number) {
  return `INR ${(amountMinor / 100).toFixed(2)}`;
}

async function backfillChargeFinalizedAt() {
  await connectDatabase();
  const summary = {
    candidates: 0,
    stampedFromVerification: 0,
    stampedFromCollection: 0,
    skippedNotCollected: 0,
    updated: 0,
    totalOutstanding: ""
  };

  try {
    const invoices = await ShipmentInvoice.find({
      chargeFinalizedAt: null,
      billingStatementId: null,
      status: "ISSUED",
      paymentStatus: { $ne: "VOID" },
      creditOutstandingMinor: { $gt: 0 }
    })
      .select("shipmentDraftId invoiceNumber creditOutstandingMinor")
      .lean()
      .exec();

    summary.candidates = invoices.length;
    if (!invoices.length) {
      console.log("No unbilled invoices are missing a charge-finalized date.", summary);
      return;
    }

    const draftIds = invoices.map((invoice) => invoice.shipmentDraftId);
    // A verification is the more precise signal where one exists: it is the
    // moment the amount was actually settled, and it always predates the stamp
    // this script would otherwise write.
    //
    // Otherwise any charge-finalizing status will do. Collection is what the
    // live path now stamps on, so the backlog is matched on the same rule- an
    // invoice left behind here is one the running system would already have
    // billed.
    const [verifications, settlingEvents] = await Promise.all([
      ShipmentChargeVerification.find({ shipmentDraftId: { $in: draftIds } })
        .select("shipmentDraftId verifiedAt")
        .lean()
        .exec(),
      ShipmentEvent.find({
        shipmentDraftId: { $in: draftIds },
        status: { $in: [...chargeFinalizingStatuses] }
      })
        .select("shipmentDraftId")
        .lean()
        .exec()
    ]);

    const verifiedDraftIds = new Set(verifications.map((item) => String(item.shipmentDraftId)));
    const settledDraftIds = new Set(settlingEvents.map((item) => String(item.shipmentDraftId)));
    const finalizedAt = new Date();
    let outstandingMinor = 0;

    for (const invoice of invoices) {
      const draftId = String(invoice.shipmentDraftId);
      const verified = verifiedDraftIds.has(draftId);

      // Booked but never collected. Its charge has not settled yet, and the live
      // code path will stamp it the moment the parcel is picked up.
      if (!verified && !settledDraftIds.has(draftId)) {
        summary.skippedNotCollected += 1;
        continue;
      }

      if (verified) summary.stampedFromVerification += 1;
      else summary.stampedFromCollection += 1;
      outstandingMinor += invoice.creditOutstandingMinor;

      if (!apply) continue;
      await ShipmentInvoice.updateOne(
        { _id: invoice._id, chargeFinalizedAt: null },
        { $set: { chargeFinalizedAt: finalizedAt } },
        { runValidators: true }
      ).exec();
      summary.updated += 1;
    }

    summary.totalOutstanding = formatMinor(outstandingMinor);
    console.log(
      apply ? "Charge-finalized backfill applied." : "Charge-finalized backfill (dry run).",
      summary
    );
    console.log(
      `These invoices will be billed on the next statement close, worth ${summary.totalOutstanding} in total.`
    );
    if (!apply) console.log("Re-run with --apply to write these changes.");
  } finally {
    await mongoose.disconnect();
  }
}

backfillChargeFinalizedAt().catch((error) => {
  console.error("Charge-finalized backfill failed.", error);
  process.exitCode = 1;
});
