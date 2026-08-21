import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { BalanceReservation } from "../models/balanceReservation.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CancellationFeeInvoice } from "../models/cancellationFeeInvoice.model.js";
import { Claim } from "../models/claim.model.js";
import { CreditBillingAdjustment } from "../models/creditBillingAdjustment.model.js";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { EmailOutbox } from "../models/emailOutbox.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";

/**
 * Reports what the scheduled jobs would do on their first run, without doing it.
 *
 * Read-only: counts and reads only, no writes anywhere. Run this against a
 * database before installing `deploy/jobs` on it.
 *
 * The job worth checking is `close-billing`. It does not only close the current
 * period- it steps back three monthly periods to recover gaps, and each
 * statement is dated to the period it covers rather than to today. On a database
 * carrying unbilled history that produces statements whose due dates are already
 * in the past, and because overdue restrictions are computed live from those due
 * dates, the affected accounts can be blocked from booking the moment the job
 * finishes. On an empty database it does nothing at all. This tells you which
 * situation you are in before you find out the hard way.
 */

const OVERDUE_LOOKBACK_DAYS = 93; // three monthly periods, matching the job

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

function verdict(safe: boolean, safeText: string, unsafeText: string) {
  console.log(`  ${safe ? "SAFE  " : "REVIEW"}                 ${safe ? safeText : unsafeText}`);
}

async function run() {
  await connectDatabase();

  try {
    const now = new Date();
    console.log(`\nPreflight for scheduled jobs`);
    console.log(`database: ${mongoose.connection.name}`);
    console.log(`host:     ${mongoose.connection.host}`);
    console.log(`checked:  ${now.toISOString()}\n`);

    // --- expire-reservations -------------------------------------------------
    const [totalReservations, staleReservations] = await Promise.all([
      BalanceReservation.countDocuments({}).exec(),
      BalanceReservation.countDocuments({ status: "ACTIVE", expiresAt: { $lt: now } }).exec()
    ]);
    console.log("job:credit:expire-reservations");
    line("reservations total", String(totalReservations));
    line("stale + expired", String(staleReservations));
    verdict(
      true,
      "releasing holds only ever returns capacity to the client",
      ""
    );
    if (staleReservations > 0) {
      line("note", `${staleReservations} hold(s) will be released on the first run`);
    }

    // --- email drain ---------------------------------------------------------
    const pendingEmail = await EmailOutbox.countDocuments({ status: "PENDING" }).exec();
    const oldestPending = pendingEmail
      ? await EmailOutbox.findOne({ status: "PENDING" }).sort({ nextAttemptAt: 1 }).select("nextAttemptAt notificationType").lean().exec()
      : null;
    console.log("\njob:email:drain");
    line("queued (PENDING)", String(pendingEmail));
    if (oldestPending) {
      line("oldest queued", `${oldestPending.nextAttemptAt?.toISOString() ?? "unknown"} (${oldestPending.notificationType})`);
    }
    verdict(
      pendingEmail === 0,
      "nothing queued, so nothing will be sent",
      "queued mail will be sent on the first run- check nothing here is stale before enabling"
    );

    // --- close-billing -------------------------------------------------------
    // An unbilled invoice is only *billable* once its charge has settled, which
    // is what chargeFinalizedAt records. Counting every unbilled invoice as
    // billable is what once reported twenty invoices as work waiting when none
    // of them could reach a statement at all- they were blocked, not queued.
    const unbilledInvoiceFilter = {
      status: "ISSUED",
      paymentStatus: { $ne: "VOID" },
      creditOutstandingMinor: { $gt: 0 },
      billingStatementId: null
    } as const;

    const [billableInvoices, awaitingCollection, unbilledFees, pendingAdjustments] = await Promise.all([
      ShipmentInvoice.countDocuments({ ...unbilledInvoiceFilter, chargeFinalizedAt: { $ne: null } }).exec(),
      ShipmentInvoice.countDocuments({ ...unbilledInvoiceFilter, chargeFinalizedAt: null }).exec(),
      CancellationFeeInvoice.countDocuments({
        creditOutstandingMinor: { $gt: 0 },
        billingStatementId: null
      }).exec(),
      CreditBillingAdjustment.countDocuments({ status: "PENDING" }).exec()
    ]);
    const billableTotal = billableInvoices + unbilledFees + pendingAdjustments;

    // Anything settled before this line falls into an earlier period, so its
    // statement would be back-dated and could already be past due. Measured on
    // chargeFinalizedAt because that is the date the billing cycle groups by-
    // issuedAt would answer for a period the invoice never belonged to.
    const backdateCutoff = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    const wouldBackdate = billableInvoices
      ? await ShipmentInvoice.countDocuments({
          ...unbilledInvoiceFilter,
          chargeFinalizedAt: {
            $lt: backdateCutoff,
            $gte: new Date(now.getTime() - OVERDUE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
          }
        }).exec()
      : 0;

    console.log("\njob:credit:close-billing");
    line("billable invoices", String(billableInvoices));
    line("awaiting collection", `${awaitingCollection} (not billable until collected)`);
    line("unbilled cancel fees", String(unbilledFees));
    line("pending adjustments", String(pendingAdjustments));
    line("would be back-dated", String(wouldBackdate));
    verdict(
      billableTotal === 0,
      awaitingCollection > 0
        // Naming the backlog matters: "nothing to bill" alongside a pile of
        // unbilled invoices reads as a fault, when it is the job correctly
        // declining to bill charges that have not settled.
        ? `nothing to bill yet- ${awaitingCollection} invoice(s) are waiting on collection`
        : "nothing to bill, so no statement can be created",
      wouldBackdate > 0
        ? "back-dated statements WILL be created and may block accounts immediately"
        : "statements will be created, dated in the current period"
    );
    if (wouldBackdate > 0) {
      console.log("\n  A back-dated statement is due `paymentTermsDays` after the period it");
      console.log("  covers, not after today. With the default 30-day terms and a 0-day grace");
      console.log("  period, anything older than about a month lands already overdue, and");
      console.log("  overdue accounts are blocked from booking the moment the job finishes.");
      console.log("  Agree the treatment of these invoices with Finance before scheduling.");
    }

    // --- mark-overdue --------------------------------------------------------
    const [pastDue, expiringFacilities] = await Promise.all([
      CreditBillingStatement.countDocuments({
        outstandingAmountMinor: { $gt: 0 },
        dueAt: { $lt: now },
        status: { $in: ["ISSUED", "PARTIALLY_PAID"] }
      }).exec(),
      BusinessCreditAccount.countDocuments({
        status: "ACTIVE",
        validUntil: { $ne: null, $lt: now }
      }).exec()
    ]);
    console.log("\njob:credit:mark-overdue");
    line("statements past due", String(pastDue));
    line("facilities lapsed", String(expiringFacilities));
    verdict(
      pastDue === 0 && expiringFacilities === 0,
      "nothing to flag or expire",
      "the first run will flag these and may send a burst of notifications"
    );

    // --- context -------------------------------------------------------------
    const [shipments, drafts, creditAccounts, claims] = await Promise.all([
      DpdShipment.countDocuments({}).exec(),
      ShipmentDraft.countDocuments({}).exec(),
      BusinessCreditAccount.countDocuments({}).exec(),
      Claim.countDocuments({}).exec()
    ]);
    console.log("\ndatabase contents");
    line("booked shipments", String(shipments));
    line("shipment drafts", String(drafts));
    line("credit accounts", String(creditAccounts));
    line("claims", String(claims));

    const clean = billableTotal === 0 && pendingEmail === 0 && pastDue === 0 && staleReservations === 0;
    console.log(
      clean
        ? "\nVerdict: nothing for any job to act on. Install the full schedule.\n"
        : "\nVerdict: at least one job has work waiting. Read the REVIEW lines above.\n"
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error("Preflight failed.", error);
  process.exitCode = 1;
});
