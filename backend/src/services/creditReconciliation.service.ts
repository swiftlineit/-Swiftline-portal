import mongoose from "mongoose";
import { BalanceReservation } from "../models/balanceReservation.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";
import { ShipmentEvent } from "../models/shipmentEvent.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { chargeFinalizingStatuses } from "./shipmentInvoice.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// Long enough to clear the widest billing cycle plus its close, so a shipment
// that is simply waiting for month end is never reported.
const UNBILLED_ALERT_DAYS = 45;

export type CreditReconciliationIssue = {
  businessAccountId: string;
  creditAccountId: string;
  issues: string[];
};

// Read-only integrity check for one credit account. It asserts the invariants
// that every money path is meant to preserve, so drift (from a bug or legacy
// data) is surfaced for a human to resolve with the write-off/adjust tools.
export async function reconcileCreditAccount(businessAccountId: mongoose.Types.ObjectId): Promise<CreditReconciliationIssue | null> {
  const account = await BusinessCreditAccount.findOne({ businessAccountId }).lean().exec();
  if (!account) return null;

  const issues: string[] = [];

  // 1. No balance may ever go negative.
  const nonNegativeFields: [string, number][] = [
    ["reservedCreditMinor", account.reservedCreditMinor],
    ["unbilledCreditMinor", account.unbilledCreditMinor],
    ["invoicedOutstandingMinor", account.invoicedOutstandingMinor],
    ["customerAdvanceBalanceMinor", account.customerAdvanceBalanceMinor],
    ["reservedAdvanceMinor", account.reservedAdvanceMinor]
  ];
  for (const [field, value] of nonNegativeFields) {
    if (value < 0) issues.push(`${field} is negative (${value}).`);
  }

  // 2. Invoiced outstanding must equal the sum of outstanding statement balances.
  const statements = await CreditBillingStatement.find({ businessAccountId })
    .select("outstandingAmountMinor")
    .lean()
    .exec();
  const statementOutstandingMinor = statements.reduce((total, statement) => total + statement.outstandingAmountMinor, 0);
  if (statementOutstandingMinor !== account.invoicedOutstandingMinor) {
    issues.push(`invoicedOutstandingMinor (${account.invoicedOutstandingMinor}) != sum of statement outstanding (${statementOutstandingMinor}).`);
  }

  // 3. Reserved balances must equal the sum of open reservations.
  const openReservations = await BalanceReservation.find({
    businessAccountId,
    status: { $in: ["ACTIVE", "CONSUMING", "REVIEW_REQUIRED"] }
  }).select("creditAmountMinor advanceAmountMinor").lean().exec();
  const reservedCreditMinor = openReservations.reduce((total, reservation) => total + reservation.creditAmountMinor, 0);
  const reservedAdvanceMinor = openReservations.reduce((total, reservation) => total + reservation.advanceAmountMinor, 0);
  if (reservedCreditMinor !== account.reservedCreditMinor) {
    issues.push(`reservedCreditMinor (${account.reservedCreditMinor}) != sum of open reservations (${reservedCreditMinor}).`);
  }
  if (reservedAdvanceMinor !== account.reservedAdvanceMinor) {
    issues.push(`reservedAdvanceMinor (${account.reservedAdvanceMinor}) != sum of open reservations (${reservedAdvanceMinor}).`);
  }

  // 4. A parcel collected long ago should be carrying a charge-finalized date,
  // which is what puts its invoice on a statement. One without a stamp is
  // revenue that will never be billed, and because a closed period cannot be
  // reopened it stays unbilled silently- so it is surfaced here rather than
  // waiting for someone to notice the shortfall.
  const staleSettledBefore = new Date(Date.now() - UNBILLED_ALERT_DAYS * DAY_MS);
  const unstampedDraftIds = await ShipmentInvoice.distinct("shipmentDraftId", {
    businessAccountId,
    chargeFinalizedAt: null,
    billingStatementId: null,
    status: "ISSUED",
    paymentStatus: { $ne: "VOID" },
    creditOutstandingMinor: { $gt: 0 }
  });
  if (unstampedDraftIds.length) {
    const staleSettlements = await ShipmentEvent.countDocuments({
      shipmentDraftId: { $in: unstampedDraftIds },
      status: { $in: [...chargeFinalizingStatuses] },
      eventAt: { $lt: staleSettledBefore }
    });
    if (staleSettlements > 0) {
      issues.push(
        `${staleSettlements} invoice(s) have no chargeFinalizedAt despite being collected more than `
        + `${UNBILLED_ALERT_DAYS} days ago, so they will never reach a billing statement.`
      );
    }
  }

  // 5. The invoices waiting to be billed must fit inside the unbilled balance.
  //
  // Closing a cycle moves the statement total from unbilledCreditMinor to
  // invoicedOutstandingMinor, and refuses to do so if the balance is short. A
  // shortfall therefore does not fail loudly once- it fails on every close from
  // then on, so the account silently stops being billed at all. Surfaced here
  // because the close itself reports only "balances changed, try again".
  const billableInvoices = await ShipmentInvoice.find({
    businessAccountId,
    chargeFinalizedAt: { $ne: null },
    billingStatementId: null,
    status: "ISSUED",
    paymentStatus: { $ne: "VOID" },
    creditOutstandingMinor: { $gt: 0 }
  }).select("creditOutstandingMinor").lean().exec();
  const billableMinor = billableInvoices.reduce((total, invoice) => total + invoice.creditOutstandingMinor, 0);
  if (billableMinor > account.unbilledCreditMinor) {
    issues.push(
      `invoices ready to bill (${billableMinor}) exceed unbilledCreditMinor (${account.unbilledCreditMinor}) `
      + `by ${billableMinor - account.unbilledCreditMinor}, so closing a cycle will keep failing.`
    );
  }

  if (!issues.length) return null;
  return { businessAccountId: String(businessAccountId), creditAccountId: String(account._id), issues };
}

// Reconcile every credit account that has ever held a balance and return the ones
// with drift. Read-only- it never corrects anything.
export async function reconcileAllCreditAccounts() {
  const accounts = await BusinessCreditAccount.find({
    status: { $nin: ["NOT_REQUESTED", "REJECTED"] }
  }).select("businessAccountId").lean().exec();

  const drifted: CreditReconciliationIssue[] = [];
  for (const account of accounts) {
    const result = await reconcileCreditAccount(account.businessAccountId);
    if (result) drifted.push(result);
  }

  return { scanned: accounts.length, drifted };
}
