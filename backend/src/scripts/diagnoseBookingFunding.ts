/**
 * Why a booking is refused for funding, for one business account.
 *
 * STRICTLY READ-ONLY. It connects, reads, prints, disconnects.
 *
 * Two things make that guarantee real rather than a comment:
 *
 * - `autoIndex` and `autoCreate` are switched off before a single model is
 *   loaded. Mongoose otherwise issues createIndexes/createCollection the moment
 *   a model compiles against a live connection, which is a write to production
 *   even though no application code asked for one. The models are therefore
 *   imported dynamically, after the flags are set- a static import would run
 *   first and compile them with the defaults still in place.
 * - The only service call is `buildShipmentCostEstimate`, which is what the
 *   booking form already calls on every keystroke. It prices and previews; it
 *   reserves nothing and persists nothing.
 *
 * Usage, from portal/backend:
 *
 *   npx tsx src/scripts/diagnoseBookingFunding.ts "Desire"
 *   npx tsx src/scripts/diagnoseBookingFunding.ts "Desire" <shipmentDraftId>
 *
 * Reads MONGODB_URI from the environment, so it can be pointed at a database
 * without editing .env.
 */
import dns from "node:dns";
import mongoose from "mongoose";

// Atlas SRV lookups fail on some local resolvers; harmless elsewhere.
try {
  dns.setServers(["8.8.8.8"]);
} catch {
  // keep the platform resolver
}

const rupees = (minor: number) => `INR ${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const stamp = (value?: Date | null) => (value ? value.toISOString() : "not set");
const head = (title: string) => console.log(`\n${title}\n${"-".repeat(title.length)}`);
const row = (label: string, value: string) => console.log(`  ${label.padEnd(30)} ${value}`);

async function run() {
  const search = process.argv[2] ?? "";
  const draftIdArg = process.argv[3] ?? "";
  if (!search) {
    throw new Error("Pass part of the company name, for example: npx tsx src/scripts/diagnoseBookingFunding.ts Desire");
  }

  // Must happen before any model module is evaluated.
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  mongoose.set("strictQuery", false);

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set.");
  await mongoose.connect(uri, { family: 4 });

  const now = new Date();

  try {
    const [
      { BalanceReservation },
      { BusinessAccount },
      { BusinessAccountMember },
      { BusinessCreditAccount },
      { CreditBillingStatement },
      { ShipmentDraft },
      { User },
      { getCreditBalances, isCreditWindowOpen },
      { getCreditRestrictionState },
      { buildShipmentCostEstimate }
    ] = await Promise.all([
      import("../models/balanceReservation.model.js"),
      import("../models/businessAccount.model.js"),
      import("../models/businessAccountMember.model.js"),
      import("../models/businessCreditAccount.model.js"),
      import("../models/creditBillingStatement.model.js"),
      import("../models/shipmentDraft.model.js"),
      import("../models/user.model.js"),
      import("../services/creditAccount.service.js"),
      import("../services/creditOverdue.service.js"),
      import("../services/shipmentCostEstimate.service.js")
    ]);

    console.log(`\ndatabase: ${mongoose.connection.name}   host: ${mongoose.connection.host}   checked: ${now.toISOString()}`);

    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const accounts = await BusinessAccount.find({ "company.companyName": { $regex: escaped, $options: "i" } })
      .select("company.companyName status assignedBranch")
      .lean()
      .exec();

    if (!accounts.length) throw new Error(`No business account matches "${search}".`);
    if (accounts.length > 1) {
      console.log("\nSeveral accounts match; re-run with a more specific name:");
      accounts.forEach((entry) => console.log(`  ${String(entry._id)}  ${entry.company?.companyName} (${entry.status})`));
      return;
    }

    const account = accounts[0]!;
    const businessAccountId = account._id as mongoose.Types.ObjectId;

    head("Business account");
    row("company", account.company?.companyName ?? "(unnamed)");
    row("id", String(businessAccountId));
    row("status", account.status);
    row("assigned branch", account.assignedBranch ? String(account.assignedBranch) : "none");

    // --- the credit account the booking guard actually reads -----------------
    const credit = await BusinessCreditAccount.findOne({ businessAccountId }).exec();
    if (!credit) {
      head("Credit account");
      console.log("  NONE. Every business booking is refused: there is no account to draw on.");
      return;
    }

    const balances = getCreditBalances(credit, now);
    const windowOpen = isCreditWindowOpen(credit, now);

    head("Credit account (stored)");
    row("status", credit.status);
    row("currency", credit.currency);
    row("valid from", stamp(credit.validFrom));
    row("valid until", stamp(credit.validUntil));
    row("approved limit", rupees(credit.approvedCreditLimitMinor));
    row("reserved credit", rupees(credit.reservedCreditMinor));
    row("unbilled credit", rupees(credit.unbilledCreditMinor));
    row("invoiced outstanding", rupees(credit.invoicedOutstandingMinor));
    row("customer advance balance", rupees(credit.customerAdvanceBalanceMinor));
    row("reserved advance", rupees(credit.reservedAdvanceMinor));

    head("Credit account (what booking sees)");
    row("credit window open", windowOpen ? "yes" : `NO -> available credit is forced to ${rupees(0)}`);
    if (!windowOpen) {
      const why = credit.status !== "ACTIVE"
        ? `status is ${credit.status}, not ACTIVE`
        : credit.validFrom && credit.validFrom > now
          ? `validFrom ${stamp(credit.validFrom)} is in the future`
          : `validUntil ${stamp(credit.validUntil)} has passed`;
      row("reason", why);
    }
    row("available advance", rupees(balances.availableAdvanceMinor));
    row("available credit", rupees(balances.availableCreditMinor));
    row("total booking capacity", rupees(balances.availableBookingCapacityMinor));
    row("owed (unbilled+invoiced)", rupees(balances.totalOwedMinor));

    // --- overdue restriction, recomputed live exactly as booking does --------
    const restriction = await getCreditRestrictionState({
      businessAccountId,
      gracePeriodDays: credit.gracePeriodDays,
      maxOverdueDays: credit.maxOverdueDays,
      now
    });
    const overdueStatements = await CreditBillingStatement.find({
      businessAccountId,
      outstandingAmountMinor: { $gt: 0 },
      dueAt: { $lt: now }
    })
      .select("dueAt status outstandingAmountMinor")
      .sort({ dueAt: 1 })
      .lean()
      .exec();

    head("Overdue restriction");
    row("level", restriction.level);
    row("past-due statements", String(overdueStatements.length));
    overdueStatements.forEach((statement) => {
      row("  due", `${stamp(statement.dueAt)}  ${statement.status}  ${rupees(statement.outstandingAmountMinor)}`);
    });

    // --- holds: the usual reason money is "there" but not available ----------
    const reservations = await BalanceReservation.find({ businessAccountId })
      .select("status amountMinor advanceAmountMinor creditAmountMinor expiresAt shipmentDraftId createdAt")
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const live = reservations.filter((entry) => ["ACTIVE", "CONSUMING", "REVIEW_REQUIRED"].includes(entry.status));
    const stale = live.filter((entry) => entry.status === "ACTIVE" && entry.expiresAt < now);
    const heldAdvance = live.reduce((sum, entry) => sum + entry.advanceAmountMinor, 0);
    const heldCredit = live.reduce((sum, entry) => sum + entry.creditAmountMinor, 0);

    head("Booking holds");
    row("reservations (all time)", String(reservations.length));
    row("still holding funds", String(live.length));
    row("of those, past TTL", stale.length
      ? `${stale.length}  <- job:credit:expire-reservations has not swept these`
      : "0");
    row("held advance (sum)", rupees(heldAdvance));
    row("held credit (sum)", rupees(heldCredit));
    row("account says reservedAdvance", rupees(credit.reservedAdvanceMinor));
    row("account says reservedCredit", rupees(credit.reservedCreditMinor));
    if (heldAdvance !== credit.reservedAdvanceMinor || heldCredit !== credit.reservedCreditMinor) {
      row("DRIFT", "reserved totals do not match the live reservations - capacity is held with no hold behind it");
    }
    live.forEach((entry) => {
      row(`  ${entry.status}`, `${rupees(entry.amountMinor)}  draft ${String(entry.shipmentDraftId)}  expires ${stamp(entry.expiresAt)}`);
    });

    // --- who may save a draft for this account ------------------------------
    const members = await BusinessAccountMember.find({ businessAccount: businessAccountId })
      .select("user role status assignedBranches")
      .lean()
      .exec();

    head("Members");
    for (const member of members) {
      const user = member.user
        ? await User.findById(member.user).select("email role userStatus").lean().exec()
        : null;
      row(
        user?.email ?? String(member.user ?? "(no user)"),
        `seat=${member.role} seatStatus=${member.status} portalRole=${user?.role ?? "?"} `
        + `login=${user?.userStatus ?? "?"} branches=${(member.assignedBranches ?? []).length || "account default"}`
      );
    }

    // --- replay the exact estimate for one draft ----------------------------
    const drafts = await ShipmentDraft.find({ businessAccountId, deletedAt: null })
      .sort({ updatedAt: -1 })
      .limit(10)
      .exec();

    head("Recent drafts");
    drafts.forEach((draft) => {
      row(
        String(draft._id),
        `${draft.bookingState}  ${draft.consigneeEnteredAddress?.countryCode || "no country"}  `
        + `${draft.serviceType}  boxes=${draft.parcelCount}  updated ${stamp(draft.updatedAt)}`
      );
    });

    const target = draftIdArg
      ? drafts.find((draft) => String(draft._id) === draftIdArg) ?? await ShipmentDraft.findById(draftIdArg).exec()
      : drafts[0] ?? null;

    if (!target) {
      console.log("\nNo draft to price. Pass a draft id as the second argument to replay one.");
      return;
    }

    head(`Funding preview replayed for draft ${String(target._id)}`);
    try {
      const estimate = await buildShipmentCostEstimate({ draft: target });
      row("total payable", rupees(estimate.funding.totalPayableMinor));
      row("missing rate slab", estimate.pricing.missingRate ? "YES - shipment cannot be priced" : "no");
      row("available advance", rupees(estimate.funding.availableAdvanceMinor));
      row("available credit", rupees(estimate.funding.availableCreditMinor));
      row("would take from advance", rupees(estimate.funding.advanceDeductionMinor));
      row("would take from credit", rupees(estimate.funding.creditUsageMinor));
      row("canFund", estimate.funding.canFund ? "yes" : "NO");
      row("message", estimate.funding.message);

      if (!estimate.funding.canFund) {
        const total = estimate.funding.totalPayableMinor;
        const capacity = estimate.funding.availableAdvanceMinor + estimate.funding.availableCreditMinor;

        head("Verdict");
        if (total <= 0) {
          console.log("  The total is zero, so the allocator rejected the amount as invalid and the panel");
          console.log("  reported that as an insufficient-funds message. Nothing is short: the shipment has");
          console.log("  no priceable weight, so there is nothing to charge.");
        } else if (capacity < total) {
          console.log(`  Genuinely short by ${rupees(total - capacity)}: capacity ${rupees(capacity)} against a total of ${rupees(total)}.`);
          if (!windowOpen) console.log("  The whole approved limit is excluded because the credit window is closed (above).");
          if (stale.length) console.log(`  ${stale.length} expired hold(s) are still consuming capacity.`);
        } else {
          console.log("  Capacity covers the total, so the refusal came from the overdue restriction above.");
        }
      }
    } catch (error) {
      row("estimate failed", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      console.log("  A thrown estimate is a pricing problem (usually a missing rate card), not a funding one.");
    }
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error("\nDiagnostic failed.", error);
  process.exitCode = 1;
});
